// ---------------------------------------------------------------------------
// Firebase web-SDK config for the allrides pitch remote.
//
// Paste your project's config object here. From the Firebase console:
//   Project settings  →  General  →  Your apps  →  Web app  →  SDK setup
//
// This file is safe to commit publicly. The Firestore security rules
// (firestore.rules) restrict who can read/write what — the apiKey itself
// is not a secret.
// ---------------------------------------------------------------------------

window.FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDBOEuY-pJ1ab2TodWvg64xA5p_cXLF1r0",
  authDomain:        "allrides-pitch-remote.firebaseapp.com",
  projectId:         "allrides-pitch-remote",
  storageBucket:     "allrides-pitch-remote.firebasestorage.app",
  messagingSenderId: "1074791186760",
  appId:             "1:1074791186760:web:7d9705fca72fd2db9d737d",
};

// Base URL that the phone's QR code points at.
// During local dev this can stay as window.location.origin + path.
// In production set it to your GitHub Pages base, e.g.
//   "https://<username>.github.io/<repo>"
window.REMOTE_BASE_URL = "https://urbanfolksmobility.in/controller";
