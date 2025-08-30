// FILE: packages/game-sdk/src/RoomClient.ts
import { initFirebase, ref, onValue, push, set, update, onDisconnect, get, runTransaction } from './firebase';
import type { Room, Player, ChatMessage, Avatar } from './types';
import { MAX_NAME_LEN, CHAT_MAX_LEN, JOIN_CODE_ALPHABET, JOIN_CODE_LEN, MAX_PLAYERS_DEFAULT, HEARTBEAT_MS } from './types';
import { ModerationEngine, type ModerateResult } from './moderation';

const DEFAULT_PRESETS = ['p1','p2','p3','p4','p5','p6','p7','p8'];
const REACTION_TYPES = ['wave','clap','laugh','wow','nope'] as const;
type ReactionType = typeof REACTION_TYPES[number];

type ReactionEvent = { id: string; playerId: string; type: ReactionType; createdAt: number };

const pickPresetId = () => DEFAULT_PRESETS[Math.floor(Math.random()*DEFAULT_PRESETS.length)];

function randomCode(len = JOIN_CODE_LEN) {
  let s=''; for(let i=0;i<len;i++) s+= JOIN_CODE_ALPHABET[Math.floor(Math.random()*JOIN_CODE_ALPHABET.length)];
  return s;
}
function uuidv4(){ const c = crypto.getRandomValues(new Uint8Array(16)); c[6]=(c[6]&0x0f)|0x40; c[8]=(c[8]&0x3f)|0x80; const h=(n:number)=>n.toString(16).padStart(2,'0'); const s=Array.from(c,h).join(''); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; }
function ensureGuestId(){ let id=localStorage.getItem('guestId'); if(!id){ id=uuidv4(); localStorage.setItem('guestId', id) } return id }

export type CreateRoomInput = { slug: string; version: string; name: string; avatar?: Avatar | null; private?: boolean; maxPlayers?: number }
export type JoinByCodeInput = { code: string; name: string; avatar?: Avatar | null }

type Unsub = () => void;

export class RoomClient {
  private fb: any;
  private guestId: string;

  // auth uid (set after anonymous sign-in). We always use selfId() for writes.
  private uid: string | null = null;
  private get selfId(): string { return this.uid ?? this.guestId; }

  public room: Room | null = null;
  public roomId: string | null = null;

  public players: Player[] = [];
  public chat: ChatMessage[] = [];

  private serverChat: ChatMessage[] = [];
  private localEchoes: ChatMessage[] = [];

  private heart?: any;
  private unsubFns: Unsub[] = [];
  private subscribed = false;

  // listeners
  private playersListeners: Array<(p: Player[])=>void> = [];
  private roomListeners: Array<(r: Room|null)=>void> = [];
  private chatListeners: Array<(c: ChatMessage[])=>void> = [];
  private moderationListeners: Array<(m: ModerateResult)=>void> = [];

  // ready + reactions
  private readyIds: Set<string> = new Set();
  private readyListeners: Array<(ready: Set<string>)=>void> = [];

  private reactions: ReactionEvent[] = [];
  private reactionListeners: Array<(events: ReactionEvent[])=>void> = [];
  private lastReactionAt = 0; // local rate-limit

  private playerRef?: any;
  private presenceRef?: any;
  private discPlayer?: { remove: any; cancel: () => Promise<void> };
  private discPresence?: { remove: any; cancel: () => Promise<void> };

  private moderation = new ModerationEngine({ chatMaxLen: CHAT_MAX_LEN });

  constructor(opts: { firebaseConfig: Record<string, any> }) {
    // enable anonymous auth so rules can require auth != null
    this.fb = initFirebase(opts.firebaseConfig, { anonymousAuth: true });
    this.guestId = ensureGuestId();

    // capture uid once auth is ready
    this.ensureAuth().catch(()=>{});
  }

  // ---------- utils: robustly await auth and cache uid ----------
  private async ensureAuth(){
    try {
      const r = this.fb?.authReady;
      if (r) {
        if (typeof r === 'function') await r();
        else if (typeof r?.then === 'function') await r;
      }
      this.uid = this.fb?.auth?.currentUser?.uid ?? this.uid ?? null;
    } catch {}
  }
  private async waitAuth(){ await this.ensureAuth(); }

  // ---------------------------------------------------------------------------
  // Subscriptions
  onPlayers(cb: (players: Player[]) => void){ this.playersListeners.push(cb); if(this.players.length) cb(this.players); return ()=>{ this.playersListeners = this.playersListeners.filter(f=>f!==cb) } }
  onRoomMeta(cb: (room: Room|null)=>void){ this.roomListeners.push(cb); if(this.room) cb(this.room); return ()=>{ this.roomListeners = this.roomListeners.filter(f=>f!==cb) } }
  onChat(cb: (msgs: ChatMessage[])=>void){ this.chatListeners.push(cb); if(this.chat.length) cb(this.chat); return ()=>{ this.chatListeners = this.chatListeners.filter(f=>f!==cb) } }
  onModeration(cb: (m: ModerateResult)=>void){ this.moderationListeners.push(cb); return ()=>{ this.moderationListeners = this.moderationListeners.filter(f=>f!==cb) } }

  onReady(cb: (ready: Set<string>) => void){ this.readyListeners.push(cb); if(this.readyIds.size) cb(new Set(this.readyIds)); return ()=>{ this.readyListeners = this.readyListeners.filter(f=>f!==cb) } }
  onReactions(cb: (events: ReactionEvent[]) => void){ this.reactionListeners.push(cb); if(this.reactions.length) cb(this.reactions.slice()); return ()=>{ this.reactionListeners = this.reactionListeners.filter(f=>f!==cb) } }

  private notifyPlayers(){ this.playersListeners.forEach(cb=>cb(this.players)) }
  private notifyRoom(){ this.roomListeners.forEach(cb=>cb(this.room)) }
  private notifyChat(){ this.chatListeners.forEach(cb=>cb(this.chat)) }
  private notifyModeration(res: ModerateResult){ this.moderationListeners.forEach(cb=>cb(res)) }
  private notifyReady(){ const snapshot = new Set(this.readyIds); this.readyListeners.forEach(cb=>cb(snapshot)); }
  private notifyReactions(){ const copy = this.reactions.slice(); this.reactionListeners.forEach(cb=>cb(copy)); }

  private attachSubscriptions(){
    if(this.subscribed || !this.roomId) return;
    this.subscribed = true;

    const playersRef = ref(this.fb.db, `rooms/${this.roomId}/players`);
    const roomRef = ref(this.fb.db, `rooms/${this.roomId}/meta`);
    const chatRef = ref(this.fb.db, `rooms/${this.roomId}/chat`);
    const readyRef = ref(this.fb.db, `rooms/${this.roomId}/ready`);
    const reactRef = ref(this.fb.db, `rooms/${this.roomId}/reactions`);

    const u1 = onValue(playersRef, (snap)=>{ const val = snap.val()||{}; const list: Player[] = Object.values(val); this.players = list.sort((a,b)=> a.name.localeCompare(b.name)); this.notifyPlayers(); });
    const u2 = onValue(roomRef, (snap)=>{ this.room = (snap.val()||null); this.notifyRoom(); });
    const u3 = onValue(chatRef, (snap)=>{ const val = snap.val()||{}; const list: ChatMessage[] = Object.entries(val).map(([id,v]:any)=>({id, ...v})); this.serverChat = list.sort((a,b)=> a.createdAt - b.createdAt); this.rebuildChatWithEchoes(); });
    const u4 = onValue(readyRef, (snap)=>{ const val = (snap.val()||{}) as Record<string,any>; const ids = Object.keys(val).filter(k => !!val[k]); this.readyIds = new Set(ids); this.notifyReady(); });
    const u5 = onValue(reactRef, (snap)=>{ const val = (snap.val()||{}) as Record<string, any>; const list: ReactionEvent[] = Object.entries(val).map(([id, v]: any) => ({ id, ...v })); list.sort((a,b)=>a.createdAt-b.createdAt); this.reactions = list; this.notifyReactions(); });

    this.unsubFns.push(()=>u1(), ()=>u2(), ()=>u3(), ()=>u4(), ()=>u5());
  }

  private rebuildChatWithEchoes(){
    const now = Date.now();
    this.localEchoes = this.localEchoes.filter(m => (now - m.createdAt) < 60_000);
    const merged = [...this.serverChat, ...this.localEchoes].sort((a,b)=> a.createdAt - b.createdAt);
    this.chat = merged;
    this.notifyChat();
  }

  // ---------------------------------------------------------------------------
  // Presence
  private async startPresence(name: string, avatar?: Avatar | null){
    await this.waitAuth();
    if(!this.roomId) return;

    const now = Date.now();
    const assignedAvatar: Avatar | undefined = avatar ?? { kind:'preset', id: pickPresetId() };
    const role: Player['role'] = (this.room?.hostId===this.selfId) ? 'host' : 'player';
    const p: Player = { id:this.selfId, name, role, avatar: assignedAvatar, lastSeen: now };

    const pRef = ref(this.fb.db, `rooms/${this.roomId}/players/${this.selfId}`);
    const presRef = ref(this.fb.db, `rooms/${this.roomId}/presence/${this.selfId}`);

    set(pRef, p);
    set(presRef, { lastSeen: now });

    this.discPlayer = onDisconnect(pRef);  this.discPlayer.remove();
    this.discPresence = onDisconnect(presRef); this.discPresence.remove();

    if(this.heart) clearInterval(this.heart);
    this.heart = setInterval(()=>{ const t=Date.now(); update(pRef,{ lastSeen:t }); set(presRef,{ lastSeen:t }) }, HEARTBEAT_MS);

    this.playerRef = pRef;
    this.presenceRef = presRef;
  }

  // ---------------------------------------------------------------------------
  // Room lifecycle
  private async allocateCode(roomId: string): Promise<string>{
    for(let i=0;i<32;i++){
      const code = randomCode();
      const codeRef = ref(this.fb.db, `codes/${code}`);
      try {
        const res = await runTransaction(codeRef, (cur)=> cur ? cur : { roomId, createdAt: Date.now() });
        if (res.committed) return code;
      } catch (e:any) {
        if (i > 2) throw new Error(`ERR_CODE_WRITE:${e?.code||e?.message||'unknown'}`);
      }
    }
    throw new Error('ERR_ALLOCATE_CODE');
  }

  async createRoom(input: CreateRoomInput){
    await this.waitAuth();

    try {
      const roomRef = push(ref(this.fb.db, 'rooms'));
      const roomId = roomRef.key!;
      const joinCode = await this.allocateCode(roomId);
      const now = Date.now();

      const room: Room = {
        id: roomId,
        slug: input.slug,
        version: input.version,
        joinCode,
        private: !!input.private,
        maxPlayers: input.maxPlayers ?? MAX_PLAYERS_DEFAULT,
        status: 'lobby',
        hostId: this.selfId,
        createdAt: now,
        options: {}
      } as Room;

      const assignedAvatar: Avatar | undefined = input.avatar ?? { kind:'preset', id: pickPresetId() };
      const player: Player = {
        id: this.selfId,
        name: String(input.name).slice(0,MAX_NAME_LEN),
        role: 'host',
        avatar: assignedAvatar,
        lastSeen: now
      };

      await update(ref(this.fb.db), {
        [`rooms/${roomId}/meta`]: room,
        [`rooms/${roomId}/players/${this.selfId}`]: player
      });

      this.roomId = roomId; this.room = room;
      this.attachSubscriptions();
      this.startPresence(input.name, assignedAvatar);
      return room;

    } catch (e:any) {
      const code = e?.code || e?.message || '';
      if (String(code).includes('PERMISSION_DENIED')) throw new Error('ERR_PERMISSION_DENIED');
      if (String(code).includes('ERR_ALLOCATE_CODE')) throw new Error('ERR_ALLOCATE_CODE');
      if (String(code).includes('ERR_CODE_WRITE')) throw new Error(String(code));
      throw e;
    }
  }

  async joinRoomByCode(input: JoinByCodeInput){
    await this.waitAuth();

    const code = String(input.code).toUpperCase();
    const mapSnap = await get(ref(this.fb.db, `codes/${code}`));
    if(!mapSnap.exists()) throw new Error('ERR_CODE_NOT_FOUND');

    const { roomId } = mapSnap.val();
    const metaSnap = await get(ref(this.fb.db, `rooms/${roomId}/meta`));
    if(!metaSnap.exists()) throw new Error('Room not found');

    const room = metaSnap.val() as Room;
    const now = Date.now();
    const assignedAvatar: Avatar | undefined = input.avatar ?? { kind:'preset', id: pickPresetId() };
    const player: Player = {
      id: this.selfId,
      name: String(input.name).slice(0,MAX_NAME_LEN),
      role: room.hostId===this.selfId ? 'host':'player',
      avatar: assignedAvatar,
      lastSeen: now
    };

    await set(ref(this.fb.db, `rooms/${roomId}/players/${this.selfId}`), player);

    this.roomId = roomId; this.room = room;
    this.attachSubscriptions();
    this.startPresence(input.name, assignedAvatar);
    return room;
  }

  // ---------------------------------------------------------------------------
  // Chat + moderation
  private isSelfMuted(): boolean {
    const self = this.players.find(p=>p.id===this.selfId);
    if (!self) return false;
    const until = (self as any).mutedUntil ?? 0;
    return until > Date.now();
  }

  async sendText(text: string){
    await this.waitAuth();
    if(!this.roomId) throw new Error('Not in room');

    const modOptions = { slowModeMs: this.room?.options?.slowModeMs } as any;
    const res = await this.moderation.moderate({
      roomId: this.roomId!, playerId: this.selfId, text, options: modOptions
    });
    if (!res.ok) { this.notifyModeration(res); return; }

    let clean = (res.text || '').slice(0, CHAT_MAX_LEN).trim();
    if (!clean) { this.notifyModeration({ ok:false, reason:'EMPTY' }); return; }

    const name = this.players.find(p=>p.id===this.selfId)?.name ?? 'Guest';
    const baseMsg: Omit<ChatMessage,'id'> = {
      roomId: this.roomId!, playerId: this.selfId, name, createdAt: Date.now(), type: 'text', text: clean
    };

    if (this.isSelfMuted()) {
      const localMsg: ChatMessage = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, ...baseMsg };
      this.localEchoes.push(localMsg);
      this.rebuildChatWithEchoes();
      this.notifyModeration({ ok:true, reason:'OK', text: clean });
      return;
    }

    const chatRef = ref(this.fb.db, `rooms/${this.roomId}/chat`);
    await set(push(chatRef), baseMsg);
    this.notifyModeration({ ok:true, reason:'OK', text: clean });
  }

  // ---------------------------------------------------------------------------
  // Lobby polish APIs

  /** Toggle ready for this player. true -> set; false -> remove */
  async setReady(flag: boolean){
    await this.waitAuth();
    if(!this.roomId) throw new Error('Not in room');
    const path = `rooms/${this.roomId}/ready/${this.selfId}`;
    if (flag) await set(ref(this.fb.db, path), true);
    else await set(ref(this.fb.db, path), null);
  }

  /** Host-only: write status:starting and epochStart = now + seconds*1000 */
  async hostStartCountdown(seconds = 3){
    await this.waitAuth();
    if(!this.roomId || !this.room) throw new Error('Not in room');
    if (this.room.hostId !== this.selfId) throw new Error('ERR_NOT_HOST');

    // must have >= 2 players
    const present = this.players.filter(Boolean);
    if (present.length < 2) throw new Error('ERR_TOO_FEW_PLAYERS');

    // must be all ready
    const allIds = new Set(present.map(p=>p.id));
    for (const id of allIds) {
      if (!this.readyIds.has(id)) throw new Error('ERR_NOT_ALL_READY');
    }

    const epochStart = Date.now() + Math.max(1, seconds)*1000;
    await update(ref(this.fb.db, `rooms/${this.roomId}/meta`), { status: 'starting', epochStart });
  }

  /** Lightweight emoji burst. Rate-limited to 1 / 2s locally. */
  async sendReaction(type: ReactionType){
    await this.waitAuth();
    if(!this.roomId) throw new Error('Not in room');
    if (!REACTION_TYPES.includes(type)) throw new Error('ERR_BAD_REACTION');

    const now = Date.now();
    if (now - this.lastReactionAt < 2000) return; // local throttle
    this.lastReactionAt = now;

    const payload = { playerId: this.selfId, type, createdAt: now };
    await set(push(ref(this.fb.db, `rooms/${this.roomId}/reactions`)), payload);
  }

  // ---------------------------------------------------------------------------
  // Leave
  async leaveRoom() {
    if (!this.roomId) return;
    try { await this.discPlayer?.cancel(); } catch {}
    try { await this.discPresence?.cancel(); } catch {}
    try { if (this.presenceRef) await set(this.presenceRef, null); } catch {}
    try { if (this.playerRef) await set(this.playerRef, null); } catch {}

    this.unsubFns.forEach(f=>f()); this.unsubFns = [];
    if (this.heart) clearInterval(this.heart);
    this.subscribed = false;

    this.roomId = null; this.room = null;
    this.players = [];
    this.serverChat = [];
    this.localEchoes = [];
    this.chat = [];
    this.readyIds.clear();
    this.reactions = [];
    this.notifyPlayers(); this.notifyRoom(); this.notifyChat(); this.notifyReady(); this.notifyReactions();
  }
}
