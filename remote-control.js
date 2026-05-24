// ---------------------------------------------------------------------------
// RemoteDeck — shared phone-remote glue used by every deck in this folder.
//
// Each deck is expected to:
//   1. Load firebase-config.js
//   2. Load firebase-app-compat.js + firebase-firestore-compat.js
//   3. Load this file
//   4. Initialise its own navigation
//   5. Call RemoteDeck.register({ kind, titles, getCurrentIndex, totalSlides,
//                                 next, prev, gotoIndex, [getStageIndex],
//                                 [getStageCount] })
//   6. Call RemoteDeck.autoConnect()
//
// elevatorv2.html ALSO uses RemoteDeck.startSession() — it has its own
// pairing UI (the cover-page round button + overlay) and generates a fresh
// session code on demand.  Other decks just auto-join whatever session
// code is already in the URL.
// ---------------------------------------------------------------------------
(function () {
  const RemoteDeck = {
    _sessionRef: null,
    _connectedCode: null,
    _spec: null,
    _lastCmdMs: 0,
    _stateTimer: null,
    _registerPending: null,

    // Returns the session code from the URL (or null).
    sessionFromURL() {
      return (new URLSearchParams(location.search).get('session') || '').toUpperCase() || null;
    },

    // If ?session= is in URL, connect to it (no UI). Returns the code or null.
    autoConnect() {
      const code = this.sessionFromURL();
      if (code) this.connect(code);
      return code;
    },

    // Force-attach to a session code, updating the URL too.
    startSession(code) {
      if (!code) {
        const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
      }
      const url = new URL(location.href);
      url.searchParams.set('session', code);
      history.replaceState(null, '', url.toString());
      this.connect(code);
      return code;
    },

    connect(code) {
      if (this._connectedCode === code) return;
      const cfg = window.FIREBASE_CONFIG;
      if (!cfg || cfg.apiKey === 'REPLACE_ME') {
        console.warn('[RemoteDeck] No firebase-config.js — remote disabled');
        return;
      }
      this._connectedCode = code;

      // Restore the last-handled cmd timestamp so we don't re-fire a cmd we
      // already acted on (e.g. `openDeck` is still in the doc when the new
      // deck page loads — without this guard the new page would navigate
      // back to itself in a reload loop).
      this._storageKey = 'remoteDeck.lastCmdMs.' + code;
      try {
        this._lastCmdMs = parseInt(localStorage.getItem(this._storageKey) || '0', 10) || 0;
      } catch (e) { this._lastCmdMs = 0; }

      this._whenSDKReady(() => {
        try { firebase.initializeApp(cfg); } catch (e) { /* already init */ }
        const db = firebase.firestore();
        this._sessionRef = db.collection('sessions').doc(code);

        // Listen for commands FROM the phone.
        this._sessionRef.onSnapshot(
          (snap) => this._onSnapshot(snap),
          (err) => console.error('[RemoteDeck] snapshot error', err)
        );

        // If register() was called before SDK was ready, flush it.
        if (this._registerPending) {
          this.register(this._registerPending);
          this._registerPending = null;
        }
      });
    },

    // Each deck calls this once after its nav is wired.
    register(spec) {
      this._spec = spec;
      // If we connect later (SDK not yet loaded), buffer the spec.
      if (!this._sessionRef) {
        this._registerPending = spec;
        return;
      }
      this._writeMeta();
      window.addEventListener('deck:nav', () => this._writeStateDebounced());
    },

    // ---------- internals ----------

    _writeMeta() {
      const s = this._spec;
      if (!s || !this._sessionRef) return;
      const idx = s.getCurrentIndex();
      this._sessionRef.set({
        kind: s.kind,
        titles: s.titles,
        totalSlides: s.totalSlides,
        currentSlide: idx,
        currentTitle: s.titles[idx] || '',
        nextTitle: s.titles[idx + 1] || '',
        currentSlideStages: s.getStageCount ? s.getStageCount() : 1,
        currentStage: s.getStageIndex ? s.getStageIndex() : 0,
        deckUrl: location.pathname.split('/').pop() || 'index.html',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }).catch(err => console.error('[RemoteDeck] meta write', err));
    },

    _writeStateDebounced() {
      clearTimeout(this._stateTimer);
      this._stateTimer = setTimeout(() => this._writeMeta(), 80);
    },

    _onSnapshot(snap) {
      const data = snap.data();
      if (!data) return;
      // Notify pairing UIs (elevator overlay) — useful even before a cmd lands.
      window.dispatchEvent(new CustomEvent('remote:snapshot', { detail: data }));
      if (!data.cmd || !data.cmdAt) return;
      const ms = data.cmdAt.toMillis ? data.cmdAt.toMillis() : 0;
      if (ms <= this._lastCmdMs) return;
      this._lastCmdMs = ms;
      // Persist so a same-tab navigation (openDeck) doesn't re-fire the cmd.
      try { localStorage.setItem(this._storageKey, String(ms)); } catch (e) {}

      const cmd = data.cmd;

      // Cross-deck navigation: any deck can be told to load another URL.
      if (cmd === 'openDeck' && data.openUrl) {
        // Always carry the session forward.
        const u = new URL(data.openUrl, location.href);
        if (!u.searchParams.get('session') && this._connectedCode) {
          u.searchParams.set('session', this._connectedCode);
        }
        const target = u.toString();
        // Same-page guard — don't reload ourselves.
        if (this._samePage(target, location.href)) return;
        location.href = target;
        return;
      }

      const s = this._spec;
      if (!s) return;
      if (cmd === 'next')      s.next();
      else if (cmd === 'prev') s.prev();
      else if (cmd === 'home') s.gotoIndex(0, 0);
      else if (cmd === 'end')  s.gotoIndex(s.totalSlides - 1, 0);
      else if (cmd === 'goto' && typeof data.toIndex === 'number') {
        s.gotoIndex(data.toIndex, typeof data.toStage === 'number' ? data.toStage : 0);
      }
    },

    // Compare two URLs by origin + pathname only (query/hash differences are OK).
    _samePage(a, b) {
      try {
        const ua = new URL(a, location.href);
        const ub = new URL(b, location.href);
        return ua.origin === ub.origin && ua.pathname === ub.pathname;
      } catch (e) { return false; }
    },

    _whenSDKReady(cb, tries = 60) {
      if (window.firebase && window.firebase.firestore) return cb();
      if (tries <= 0) { console.error('[RemoteDeck] Firebase SDK never loaded'); return; }
      setTimeout(() => this._whenSDKReady(cb, tries - 1), 100);
    },
  };

  window.RemoteDeck = RemoteDeck;
})();
