// FILE: packages/game-sdk/src/firebase.ts
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getDatabase, ref, onValue, push, set, update,
  onDisconnect, get, runTransaction, type Database
} from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged, type Auth } from 'firebase/auth';

export { ref, onValue, push, set, update, onDisconnect, get, runTransaction };

type InitOptions = { anonymousAuth?: boolean };

let _app: FirebaseApp | null = null;
let _db: Database | null = null;
let _auth: Auth | null = null;
let _authReadyPromise: Promise<void> | null = null;

function envAnonDefault(): boolean {
  try {
    // Vite env (set to "0" to disable)
    // @ts-ignore
    const v = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ANON_AUTH) ?? '1';
    return String(v) !== '0';
  } catch {
    return true;
  }
}

export function initFirebase(config: Record<string, any>, options?: InitOptions) {
  if (!_app) {
    _app = initializeApp(config);
    _db = getDatabase(_app);

    const wantAnon = options?.anonymousAuth ?? envAnonDefault();
    if (wantAnon) {
      _auth = getAuth(_app);
      // Resolve when we have a user (existing or after sign-in)
      _authReadyPromise = new Promise<void>((resolve) => {
        let resolved = false;
        onAuthStateChanged(_auth!, (u) => {
          if (!resolved && u) { resolved = true; resolve(); }
        });
        // If no user yet, kick anonymous sign-in
        signInAnonymously(_auth!).catch(() => {
          // swallow; onAuthStateChanged may still fire if an older session exists
        });
      });
    } else {
      _authReadyPromise = Promise.resolve();
    }
  }

  return {
    app: _app!,
    db: _db!,
    auth: _auth,
    authReady: () => _authReadyPromise ?? Promise.resolve(),
  };
}
