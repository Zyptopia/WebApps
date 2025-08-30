export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' as const;
export const JOIN_CODE_LEN = 4;
export const MAX_NAME_LEN = 20;
export const CHAT_MAX_LEN = 160;
export const MAX_PLAYERS_DEFAULT = 8;
export const HEARTBEAT_MS = 10000;
export const PRESENCE_TIMEOUT_MS = 45000;

export type RoomStatus = 'lobby' | 'starting' | 'inGame' | 'ended';

export interface Room {
  id: string;
  slug: string;
  version: string;
  joinCode: string;
  private: boolean;
  maxPlayers: number;
  status: RoomStatus;
  hostId: string;
  createdAt: number;
  options?: { slowModeMs?: number; spectators?: boolean; reactions?: boolean };
}

export interface AvatarMeta {
  w?: number;
  h?: number;
  size?: 64;
  palette?: string[];
  bg?: number;
  createdAt?: number;
  hash?: string;
}

export type Avatar =
  | { kind: 'doodle'; meta: AvatarMeta; rle: string }
  | { kind: 'preset'; id: string };

export type PlayerRole = 'host' | 'player' | 'spectator';

export interface Player {
  id: string;
  name: string;
  role: PlayerRole;
  avatar?: Avatar;
  mutedUntil?: number;
  lastSeen: number;
}

export type ChatType = 'text' | 'system' | 'reaction' | 'poll';

export interface ChatMessage {
  id: string;
  roomId: string;
  playerId: string;
  name: string;
  createdAt: number;
  type: ChatType;
  text?: string;
}
