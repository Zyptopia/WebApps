// FILE: packages/game-sdk/src/firebase.ts
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getDatabase, ref, onValue, push, set, update,
  onDisconnect, get, runTransaction, type Database
} from 'firebase/database';
import {
  getAuth, signInAnonymously, onAuthStateChanged, type Auth
} from 'firebase/auth';

// Re-export what RoomClient already imports
export { ref, onValue, push, set, update, onDisconnect, get, runTransaction };

type Bits = {
  app: FirebaseApp;
  db: Database;
  auth?: Auth;
  /** Resolves quickly when a user is available; falls back to a short timeout so callers never hang. */
  authReady: () => Promise<void>;
};

let single: Bits | null = null;

export function initFirebase(config: Record<string, any>, opts?: { anonymousAuth?: boolean }): Bits {
  if (single) return single;

  const app = initializeApp(config);
  const db = getDatabase(app);

  // Anonymous auth wanted by default (can be disabled via opts)
  const wantAnon = opts?.anonymousAuth ?? true;

  let auth: Auth | undefined;
  let authReady: () => Promise<void>;

  if (wantAnon) {
    auth = getAuth(app);

    authReady = () =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };

        // If a cached user appears or after sign-in, resolve.
        const unsub = onAuthStateChanged(auth!, (u) => {
          if (u) { unsub(); finish(); }
        });

        // Kick an anonymous sign-in; ignore errors (domain/rules issues will surface on write)
        signInAnonymously(auth!).catch(() => { /* ignore here */ });

        // SAFETY: never hang UI — resolve after 2.5s even if auth didn’t arrive.
        setTimeout(finish, 2500);
      });
  } else {
    authReady = async () => { /* no-op */ };
  }

  single = { app, db, auth, authReady };
  return single!;
}
