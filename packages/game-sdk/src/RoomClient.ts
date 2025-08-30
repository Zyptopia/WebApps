// FILE: packages/game-sdk/src/RoomClient.ts
import { initFirebase, ref, onValue, push, set, update, onDisconnect, get, runTransaction } from './firebase';
import type { Room, Player, ChatMessage, Avatar } from './types';
import { MAX_NAME_LEN, CHAT_MAX_LEN, JOIN_CODE_ALPHABET, JOIN_CODE_LEN, MAX_PLAYERS_DEFAULT, HEARTBEAT_MS } from './types';
import { ModerationEngine, type ModerateResult } from './moderation';

const DEFAULT_PRESETS = ['p1','p2','p3','p4','p5','p6','p7','p8'];
const pickPresetId = () => DEFAULT_PRESETS[Math.floor(Math.random()*DEFAULT_PRESETS.length)];

function randomCode(len = JOIN_CODE_LEN) {
  let s=''; for(let i=0;i<len;i++) s+= JOIN_CODE_ALPHABET[Math.floor(Math.random()*JOIN_CODE_ALPHABET.length)]; return s;
}
function uuidv4(){ const c = crypto.getRandomValues(new Uint8Array(16)); c[6]=(c[6]&0x0f)|0x40; c[8]=(c[8]&0x3f)|0x80; const h=(n:number)=>n.toString(16).padStart(2,'0'); const s=Array.from(c,h).join(''); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; }
function ensureGuestId(){ let id=localStorage.getItem('guestId'); if(!id){ id=uuidv4(); localStorage.setItem('guestId', id) } return id }

export type CreateRoomInput = { slug: string; version: string; name: string; avatar?: Avatar | null; private?: boolean; maxPlayers?: number }
export type JoinByCodeInput = { code: string; name: string; avatar?: Avatar | null }

type Unsub = () => void;

export class RoomClient {
  private fb: any;
  private guestId: string;

  public room: Room | null = null;
  public roomId: string | null = null;

  public players: Player[] = [];
  public chat: ChatMessage[] = [];

  // chat merge
  private serverChat: ChatMessage[] = [];
  private localEchoes: ChatMessage[] = [];

  // ready / reactions
  private readyIds: string[] = [];
  private reactions: Array<{ id: string; playerId: string; type: string; createdAt: number }> = [];

  private heart?: any;
  private unsubFns: Unsub[] = [];
  private subscribed = false;

  // listeners
  private playersListeners: Array<(p: Player[])=>void> = [];
  private roomListeners: Array<(r: Room|null)=>void> = [];
  private chatListeners: Array<(c: ChatMessage[])=>void> = [];
  private moderationListeners: Array<(m: ModerateResult)=>void> = [];
  private readyListeners: Array<(ids: string[])=>void> = [];
  private reactionListeners: Array<(events: Array<{ id: string; playerId: string; type: string; createdAt: number }>)=>void> = [];

  private playerRef?: any;
  private presenceRef?: any;
  private discPlayer?: { remove: any; cancel: () => Promise<void> };
  private discPresence?: { remove: any; cancel: () => Promise<void> };

  private moderation = new ModerationEngine({ chatMaxLen: CHAT_MAX_LEN });
  private lastReactionAt = 0; // rate limit

  constructor(opts: { firebaseConfig: Record<string, any> }) {
    this.fb = initFirebase(opts.firebaseConfig);
    this.guestId = ensureGuestId();
  }

  // --- Subscriptions ---------------------------------------------------------
  onPlayers(cb: (players: Player[]) => void){ this.playersListeners.push(cb); if(this.players.length) cb(this.players); return ()=>{ this.playersListeners = this.playersListeners.filter(f=>f!==cb) } }
  onRoomMeta(cb: (room: Room|null)=>void){ this.roomListeners.push(cb); if(this.room) cb(this.room); return ()=>{ this.roomListeners = this.roomListeners.filter(f=>f!==cb) } }
  onChat(cb: (msgs: ChatMessage[])=>void){ this.chatListeners.push(cb); if(this.chat.length) cb(this.chat); return ()=>{ this.chatListeners = this.chatListeners.filter(f=>f!==cb) } }
  onModeration(cb: (m: ModerateResult)=>void){ this.moderationListeners.push(cb); return ()=>{ this.moderationListeners = this.moderationListeners.filter(f=>f!==cb) } }
  onReady(cb: (ids: string[])=>void){ this.readyListeners.push(cb); if(this.readyIds.length) cb(this.readyIds); return ()=>{ this.readyListeners = this.readyListeners.filter(f=>f!==cb) } }
  onReactions(cb: (events: Array<{ id: string; playerId: string; type: string; createdAt: number }>)=>void){ this.reactionListeners.push(cb); if(this.reactions.length) cb(this.reactions); return ()=>{ this.reactionListeners = this.reactionListeners.filter(f=>f!==cb) } }

  private notifyPlayers(){ this.playersListeners.forEach(cb=>cb(this.players)) }
  private notifyRoom(){ this.roomListeners.forEach(cb=>cb(this.room)) }
  private notifyChat(){ this.chatListeners.forEach(cb=>cb(this.chat)) }
  private notifyModeration(res: ModerateResult){ this.moderationListeners.forEach(cb=>cb(res)) }
  private notifyReady(){ this.readyListeners.forEach(cb=>cb(this.readyIds)) }
  private notifyReactions(){ this.reactionListeners.forEach(cb=>cb(this.reactions)) }

  private attachSubscriptions(){
    if(this.subscribed || !this.roomId) return;
    this.subscribed = true;

    const playersRef = ref(this.fb.db, `rooms/${this.roomId}/players`);
    const roomRef = ref(this.fb.db, `rooms/${this.roomId}/meta`);
    const chatRef = ref(this.fb.db, `rooms/${this.roomId}/chat`);
    const readyRef = ref(this.fb.db, `rooms/${this.roomId}/ready`);
    const reactRef = ref(this.fb.db, `rooms/${this.roomId}/reactions`);

    const u1 = onValue(playersRef, (snap)=>{ const val=snap.val()||{}; const list: Player[] = Object.values(val); this.players = list.sort((a,b)=> a.name.localeCompare(b.name)); this.notifyPlayers() });
    const u2 = onValue(roomRef, (snap)=>{ this.room = (snap.val()||null); this.notifyRoom() });
    const u3 = onValue(chatRef, (snap)=>{ const val=snap.val()||{}; const list: ChatMessage[] = Object.entries(val).map(([id,v]:any)=>({id, ...v})); this.serverChat = list.sort((a,b)=> a.createdAt - b.createdAt); this.rebuildChatWithEchoes() });
    const u4 = onValue(readyRef, (snap)=>{ const val=snap.val()||{}; this.readyIds = Object.keys(val); this.notifyReady() });
    const u5 = onValue(reactRef, (snap)=>{ const val = snap.val()||{}; let list: any[] = Object.entries(val).map(([id,v]:any)=>({ id, ...v })); const cutoff = Date.now() - 5000; list = list.filter(ev => typeof ev.createdAt === 'number' && ev.createdAt >= cutoff); list.sort((a,b)=> a.createdAt - b.createdAt); this.reactions = list; this.notifyReactions(); });

    this.unsubFns.push(()=>u1(), ()=>u2(), ()=>u3(), ()=>u4(), ()=>u5());
  }

  // Merge server chat + local echoes (keep echoes for 60s)
  private rebuildChatWithEchoes(){
    const now = Date.now();
    this.localEchoes = this.localEchoes.filter(m => (now - m.createdAt) < 60_000);
    const merged = [...this.serverChat, ...this.localEchoes].sort((a,b)=> a.createdAt - b.createdAt);
    this.chat = merged;
    this.notifyChat();
  }

  // --- Presence --------------------------------------------------------------
  private startPresence(name: string, avatar?: Avatar | null){
    if(!this.roomId) return;
    const now = Date.now();
    const assignedAvatar: Avatar | undefined = avatar ?? { kind:'preset', id: pickPresetId() };
    const role: Player['role'] = (this.room?.hostId===this.guestId) ? 'host' : 'player';
    const p: Player = { id:this.guestId, name, role, avatar: assignedAvatar, lastSeen: now };

    const pRef = ref(this.fb.db, `rooms/${this.roomId}/players/${this.guestId}`);
    const presRef = ref(this.fb.db, `rooms/${this.roomId}/presence/${this.guestId}`);

    set(pRef, p);
    set(presRef, { lastSeen: now });

    this.discPlayer = onDisconnect(pRef); this.discPlayer.remove();
    this.discPresence = onDisconnect(presRef); this.discPresence.remove();

    if(this.heart) clearInterval(this.heart);
    this.heart = setInterval(()=>{ const t=Date.now(); update(pRef,{ lastSeen:t }); set(presRef,{ lastSeen:t }) }, HEARTBEAT_MS);

    this.playerRef = pRef; this.presenceRef = presRef;
  }

  // --- Room lifecycle --------------------------------------------------------
  private async allocateCode(roomId: string): Promise<string>{
    for(let i=0;i<32;i++){
      const code = randomCode();
      const codeRef = ref(this.fb.db, `codes/${code}`);
      const res = await runTransaction(codeRef, (cur)=> cur ? cur : { roomId, createdAt: Date.now() });
      if (res.committed) return code;
    }
    throw new Error('Could not allocate join code');
  }

  async createRoom(input: CreateRoomInput){
    const roomRef = push(ref(this.fb.db, 'rooms')); const roomId = roomRef.key!;
    const joinCode = await this.allocateCode(roomId); const now = Date.now();
    const room: Room = { id: roomId, slug: input.slug, version: input.version, joinCode, private: !!input.private, maxPlayers: input.maxPlayers ?? MAX_PLAYERS_DEFAULT, status: 'lobby', hostId: this.guestId, createdAt: now, options: {} } as Room;
    const assignedAvatar: Avatar | undefined = input.avatar ?? { kind:'preset', id: pickPresetId() };
    const player: Player = { id: this.guestId, name: String(input.name).slice(0,MAX_NAME_LEN), role: 'host', avatar: assignedAvatar, lastSeen: now };
    await update(ref(this.fb.db), {
      [`rooms/${roomId}/meta`]: room,
      [`rooms/${roomId}/players/${this.guestId}`]: player
    });
    this.roomId = roomId; this.room = room; this.attachSubscriptions(); this.startPresence(input.name, assignedAvatar); return room;
  }

  async joinRoomByCode(input: JoinByCodeInput){
    const code = String(input.code).toUpperCase();
    const mapSnap = await get(ref(this.fb.db, `codes/${code}`));
    if(!mapSnap.exists()) throw new Error('ERR_CODE_NOT_FOUND');
    const { roomId } = mapSnap.val();
    const metaSnap = await get(ref(this.fb.db, `rooms/${roomId}/meta`));
    if(!metaSnap.exists()) throw new Error('Room not found');
    const room = metaSnap.val() as Room;
    const now = Date.now();
    const assignedAvatar: Avatar | undefined = input.avatar ?? { kind:'preset', id: pickPresetId() };
    const player: Player = { id: this.guestId, name: String(input.name).slice(0,MAX_NAME_LEN), role: room.hostId===this.guestId ? 'host':'player', avatar: assignedAvatar, lastSeen: now };
    await set(ref(this.fb.db, `rooms/${roomId}/players/${this.guestId}`), player);
    this.roomId = roomId; this.room = room; this.attachSubscriptions(); this.startPresence(input.name, assignedAvatar); return room;
  }

  // --- Chat ------------------------------------------------------------------
  private isSelfMuted(): boolean {
    const self = this.players.find(p=>p.id===this.guestId);
    const until = self?.mutedUntil ?? 0;
    return until > Date.now();
  }

  async sendText(text: string){
    if(!this.roomId) throw new Error('Not in room');
    const modOptions = { slowModeMs: this.room?.options?.slowModeMs } as any;
    const res = await this.moderation.moderate({ roomId: this.roomId!, playerId: this.guestId, text, options: modOptions });
    if (!res.ok) { this.notifyModeration(res); return; }

    let clean = (res.text || '').slice(0, CHAT_MAX_LEN).trim();
    if (!clean) { this.notifyModeration({ ok:false, reason:'EMPTY' }); return; }

    const name = this.players.find(p=>p.id===this.guestId)?.name ?? 'Guest';
    const baseMsg: Omit<ChatMessage,'id'> = { roomId: this.roomId!, playerId: this.guestId, name, createdAt: Date.now(), type: 'text', text: clean };

    if (this.isSelfMuted()) {
      const localMsg: ChatMessage = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, ...baseMsg };
      this.localEchoes.push(localMsg); this.rebuildChatWithEchoes(); this.notifyModeration({ ok:true, reason:'OK', text: clean }); return;
    }
    const chatRef = ref(this.fb.db, `rooms/${this.roomId}/chat`);
    await set(push(chatRef), baseMsg);
    this.notifyModeration({ ok:true, reason:'OK', text: clean });
  }

  // --- Ready -----------------------------------------------------------------
  async setReady(ready: boolean){
    if (!this.roomId) throw new Error('Not in room');
    const rRef = ref(this.fb.db, `rooms/${this.roomId}/ready/${this.guestId}`);
    if (ready) await set(rRef, true); else await set(rRef, null);
  }

  // --- Reactions -------------------------------------------------------------
  async sendReaction(type: 'wave'|'clap'|'laugh'|'wow'|'nope'){
    if (!this.roomId) throw new Error('Not in room');
    const now = Date.now();
    if (now - this.lastReactionAt < 2000) return; // 1 per 2s
    this.lastReactionAt = now;
    const ev = { playerId: this.guestId, type, createdAt: now };
    const rRef = ref(this.fb.db, `rooms/${this.roomId}/reactions`);
    const keyRef = push(rRef);
    await set(keyRef, ev);
    // client sweeper: remove own event after 5s to keep list small
    setTimeout(() => { set(keyRef, null).catch(()=>{}); }, 5000);
  }

  // --- Countdown -------------------------------------------------------------
  async hostStartCountdown(ms: number = 3000) {
    if (!this.roomId) throw new Error('Not in room');
    if (this.room?.hostId !== this.guestId) throw new Error('ERR_NOT_HOST');
    const epochStart = Date.now() + Math.max(0, ms|0);
    const statusRef = ref(this.fb.db, `rooms/${this.roomId}/meta/status`);
    const epochRef  = ref(this.fb.db, `rooms/${this.roomId}/meta/epochStart`);
    await Promise.all([ set(statusRef, 'starting'), set(epochRef, epochStart) ]);
  }

  // --- Host moderation helpers ----------------------------------------------
  async hostShadowMute(playerId: string, ms: number){
    if (!this.roomId) throw new Error('Not in room');
    if (this.room?.hostId !== this.guestId) throw new Error('ERR_NOT_HOST');
    const pRef = ref(this.fb.db, `rooms/${this.roomId}/players/${playerId}/mutedUntil`);
    await set(pRef, Date.now() + Math.max(0, ms|0));
  }

  async hostResetAvatar(playerId: string){
    if (!this.roomId) throw new Error('Not in room');
    if (this.room?.hostId !== this.guestId) throw new Error('ERR_NOT_HOST');
    const pRef = ref(this.fb.db, `rooms/${this.roomId}/players/${playerId}/avatar`);
    await set(pRef, { kind: 'preset', id: pickPresetId() });
  }

  // --- Leave -----------------------------------------------------------------
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
    this.players = []; this.serverChat = []; this.localEchoes = []; this.chat = [];
    this.readyIds = []; this.reactions = [];
    this.notifyPlayers(); this.notifyRoom(); this.notifyChat(); this.notifyReady(); this.notifyReactions();
  }
}
