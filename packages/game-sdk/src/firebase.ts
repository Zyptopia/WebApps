// FILE: packages/game-sdk/src/firebase.ts
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getDatabase, ref, onValue, push, set, update,
  onDisconnect, get, runTransaction, type Database
} from 'firebase/database';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';

// Re-export RTDB helpers so RoomClient imports keep working
export { ref, onValue, push, set, update, onDisconnect, get, runTransaction };

type InitOptions = { anonymousAuth?: boolean };

let _app: FirebaseApp | null = null;
let _db: Database | null = null;
let _auth: Auth | null = null;

function envAnonDefault(): boolean {
  // Vite or undefined environments
  // VITE_ANON_AUTH=0 turns this off; default is on
  try {
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
      // Fire and forget; errors are harmless (e.g., offline)
      signInAnonymously(_auth).catch(() => {});
    }
  }
  return { app: _app!, db: _db!, auth: _auth };
}
