import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getDatabase, ref, onValue, push, set, update, onDisconnect, get, runTransaction,
  type Database
} from 'firebase/database';
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  setPersistence, browserLocalPersistence, type Auth
} from 'firebase/auth';

type InitOpts = { anonymousAuth?: boolean };

export function initFirebase(config: Record<string, any>, opts: InitOpts = {}) {
  const app: FirebaseApp = initializeApp(config);
  const db: Database = getDatabase(app);
  const auth: Auth = getAuth(app);

  let resolveReady!: () => void;
  const authReady = new Promise<void>((res) => (resolveReady = res));

  const finish = () => resolveReady?.();

  if (opts.anonymousAuth) {
    setPersistence(auth, browserLocalPersistence).catch(() => {});
    onAuthStateChanged(auth, () => finish());
    if (!auth.currentUser) {
      signInAnonymously(auth).catch(() => finish());
    } else {
      finish();
    }
  } else {
    finish();
  }

  return { app, db, auth, authReady };
}

export { ref, onValue, push, set, update, onDisconnect, get, runTransaction };
