// FILE: packages/game-sdk/src/firebase.ts
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getDatabase, ref, onValue, push, set, update,
  onDisconnect, get, runTransaction, type Database
} from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged, type Auth } from 'firebase/auth';

export { ref, onValue, push, set, update, onDisconnect, get, runTransaction };

type Bits = {
  app: FirebaseApp;
  db: Database;
  auth?: Auth;
  authReady: () => Promise<void>;
};

let single: Bits | null = null;

export function initFirebase(config: Record<string, any>, opts?: { anonymousAuth?: boolean }): Bits {
  if (single) return single;

  const app = initializeApp(config);
  const db = getDatabase(app);

  const wantAnon = opts?.anonymousAuth ?? true;
  let auth: Auth | undefined;
  let authReady: () => Promise<void>;

  if (wantAnon) {
    auth = getAuth(app);
    authReady = () =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };

        // Resolve as soon as a user is present
        const unsub = onAuthStateChanged(auth!, (u) => {
          if (u) { unsub(); finish(); }
        });

        // Start anonymous sign-in; ignore errors here (we'll surface on write)
        signInAnonymously(auth!).catch(() => { /* ignore; handler above may still get cached user */ });

        // Safety: never hang callers
        setTimeout(finish, 3000);
      });
  } else {
    authReady = async () => {};
  }

  single = { app, db, auth, authReady };
  return single!;
}
