// ================================
// FILE: apps/hub/src/sdk/ClientContext.tsx (alias + types fixed)
// If you keep this file in your tree, ensure imports resolve and types are explicit.
// ================================

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { RoomClient } from '@sdk/game-sdk';

export type FirebaseConfig = Record<string, any>;

interface ClientCtxValue {
  client: RoomClient;
  room: any | null;
  players: any[];
  readyIds: Set<string>;
  amHost: boolean;
}

const ClientCtx = createContext<ClientCtxValue | null>(null);

export function ClientProvider({
  firebaseConfig,
  children,
}: {
  firebaseConfig: FirebaseConfig;
  children: React.ReactNode;
}) {
  const client = useMemo(() => new RoomClient({ firebaseConfig }), [firebaseConfig]);

  const [room, setRoom] = useState<any | null>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [readyIds, setReadyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    (window as any).rc = client; // for console debugging
    const offRoom = client.onRoomMeta((r: any) => setRoom(r));
    const offPlayers = client.onPlayers((p: any[]) => setPlayers(p));
    const offReady = client.onReady((ids: Set<string>) => setReadyIds(new Set(ids)));
    return () => {
      offRoom();
      offPlayers();
      offReady();
    };
  }, [client]);

  const amHost = !!(room && room.hostId === client.selfId);
  const value: ClientCtxValue = { client, room, players, readyIds, amHost };
  return <ClientCtx.Provider value={value}>{children}</ClientCtx.Provider>;
}

export function useClient() {
  const ctx = useContext(ClientCtx);
  if (!ctx) throw new Error('useClient must be used within <ClientProvider>');
  return ctx;
}
