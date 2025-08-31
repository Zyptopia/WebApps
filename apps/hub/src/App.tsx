// ================================
// FILE: apps/hub/src/App.tsx (CLEANED)
// Fixes: use SDK identity (client.selfId), gate host UI with amHost,
// and DO NOT append main.tsx to this file.
// ================================

import React, { useEffect, useMemo, useState } from 'react';
import { RoomClient, type Avatar } from '@sdk/game-sdk';
import { firebaseConfig } from './firebase-config';
import { AvatarEditor, getPresetIds, renderAvatar } from '@pkg/avatars';
import { Button, Input } from '@pkg/ui';

function useRoomClient() {
  return useMemo(() => new RoomClient({ firebaseConfig }), []);
}

const MAX_NAME = 20;
const REACTION_EMOJI: Record<'wave'|'clap'|'laugh'|'wow'|'nope', string> = {
  wave: '👋', clap: '👏', laugh: '😂', wow: '😮', nope: '🙅‍♂️'
};

const AVATAR_SIZE = 48;
const GAP_AFTER_AVATAR = 16;
const REACTION_SLOT_W = 36;

// inline styles (kept minimal; works well on mobile)
const avatarBtnStyle: React.CSSProperties = {
  width: AVATAR_SIZE, height: AVATAR_SIZE, padding: 0, border: 'none',
  background: 'transparent', display: 'grid', placeItems: 'center',
  borderRadius: 12, cursor: 'pointer'
};
const reactionSlotStyle: React.CSSProperties = {
  width: REACTION_SLOT_W, minWidth: REACTION_SLOT_W, height: AVATAR_SIZE,
  display: 'grid', placeItems: 'center'
};
const reactionChipStyle: React.CSSProperties = {
  display: 'grid', placeItems: 'center',
  minWidth: 28, height: 24, padding: '0 8px',
  borderRadius: 12, fontSize: 18,
  background: 'rgba(0,0,0,0.6)', color: 'white',
  pointerEvents: 'none'
};
const iconBtn: React.CSSProperties = {
  width: 44, height: 44, minWidth: 44, padding: 0,
  display: 'grid', placeItems: 'center', fontSize: 20, borderRadius: 10
};

export default function App() {
  const client = useRoomClient();

  // expose for console debugging
  useEffect(() => { (window as any).rc = client; }, [client]);

  // avatar picker
  const presetIds = getPresetIds();
  const [avatar, setAvatar] = useState<Avatar>({ kind: 'preset', id: presetIds[0] });

  // lobby state
  const [view, setView] = useState<'home' | 'lobby'>('home');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [room, setRoom] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [chat, setChat] = useState<any[]>([]);
  const [chatText, setChatText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // moderation UI
  const [warn, setWarn] = useState<string | null>(null);
  const [cooldownMs, setCooldownMs] = useState(0);

  // ready + countdown
  const [readyIds, setReadyIds] = useState<string[]>([]);
  const [countdownMs, setCountdownMs] = useState(0);

  // reactions (per-player, ~1.5s)
  const [activeReactions, setActiveReactions] = useState<Record<string, { type: keyof typeof REACTION_EMOJI; key: string }>>({});

  // lobby message
  const [lobbyMsg, setLobbyMsg] = useState<string | null>(null);
  const showLobbyMsg = (m: string) => { setLobbyMsg(m); window.setTimeout(() => setLobbyMsg(null), 3000); };

  // --- Settings UI state (host only) ---
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatDelayMsDraft, setChatDelayMsDraft] = useState(0);

  // listeners
  useEffect(() => client.onPlayers(setPlayers), [client]);
  useEffect(() => client.onRoomMeta((r: any) => {
    setRoom(r);
    // keep local drafts in sync when room changes
    const delay = (r as any)?.options?.chatDelayMs ?? (r as any)?.options?.slowModeMs ?? 0;
    setChatDelayMsDraft(delay);
  }), [client]);
  useEffect(() => client.onChat(setChat), [client]);
  useEffect(() => client.onReady((s: Set<string>) => setReadyIds(Array.from(s))), [client]);
  useEffect(() => {
    return client.onReactions((events: Array<{ playerId: string; type: keyof typeof REACTION_EMOJI; createdAt: number }>) => {
      const latestPerPlayer: Record<string, { type: keyof typeof REACTION_EMOJI; at: number }> = {};
      for (const ev of events) {
        const cur = latestPerPlayer[ev.playerId];
        if (!cur || ev.createdAt > cur.at) latestPerPlayer[ev.playerId] = { type: ev.type as any, at: ev.createdAt };
      }
      Object.entries(latestPerPlayer).forEach(([pid, { type, at }]) => {
        const key = `${pid}-${at}`;
        setActiveReactions(prev => ({ ...prev, [pid]: { type, key } }));
        window.setTimeout(() => {
          setActiveReactions(prev => {
            if (prev[pid]?.key !== key) return prev;
            const copy = { ...prev }; delete copy[pid]; return copy;
          });
        }, 1500);
      });
    });
  }, [client]);

  // moderation events
  useEffect(() => {
    return client.onModeration((res: any) => {
      if (!res.ok) {
        if (res.reason === 'TOO_LONG') setWarn('Message too long (max 160).');
        else if (res.reason === 'DUPLICATE') setWarn('Duplicate message (15s).');
        else if (res.reason === 'CAPS') setWarn('Too much ALL CAPS.');
        else if (res.reason === 'EMPTY') setWarn('Nothing to send.');
        else if (res.reason === 'COOLDOWN') {
          const left = Math.max(0, Math.ceil((res.cooldownMsLeft ?? 0) / 100) * 100);
          setWarn('Chat delay is on…'); setCooldownMs(left);
        } else setWarn('Message blocked.');
      } else { setCooldownMs(0); setWarn(res.replaced ? 'Profanity/links adjusted.' : null); }
    });
  }, [client]);

  // cooldown ticker
  useEffect(() => {
    if (cooldownMs <= 0) return;
    const id = setInterval(() => setCooldownMs(ms => Math.max(0, ms - 200)), 200);
    return () => clearInterval(id);
  }, [cooldownMs]);

  // countdown ticker
  useEffect(() => {
    if (!room?.epochStart || room?.status !== 'starting') { setCountdownMs(0); return; }
    const tick = () => setCountdownMs(Math.max(0, room.epochStart - Date.now()));
    tick(); const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [room?.epochStart, room?.status]);

  // Deep link: /join/:code prefill + auto-join (supports base path, hash, and ?code)
  useEffect(() => {
    const tryDeepLink = async () => {
      try {
        const getCode = (): string => {
          const up = (s: string) => s.toUpperCase();
          // 1) Pathname: look for "/join/:code" anywhere in the path
          const segs = location.pathname.split('/').filter(Boolean);
          const j1 = segs.map(s=>s.toLowerCase()).lastIndexOf('join');
          if (j1 !== -1 && segs[j1+1]) return up(segs[j1+1].slice(0,4));
          // 2) Hash-based: "#/join/:code" or "#join/:code"
          const h = location.hash.replace(/^#/, '');
          const hsegs = h.split('/').filter(Boolean);
          const j2 = hsegs.map(s=>s.toLowerCase()).lastIndexOf('join');
          if (j2 !== -1 && hsegs[j2+1]) return up(hsegs[j2+1].slice(0,4));
          // 3) Query: ?code=ABCD
          const sp = new URLSearchParams(location.search);
          const q = sp.get('code');
          if (q) return up(q.slice(0,4));
          return '';
        };

        const codeFromLink = getCode();
        if (codeFromLink && /^[A-Z0-9]{4}$/.test(codeFromLink)) {
          setCode(codeFromLink);
          const nickname = 'Guest';
          try {
            await client.joinRoomByCode({ code: codeFromLink, name: nickname, avatar });
            setView('lobby'); setError(null);
          } catch (e:any) {
            const msg = String(e?.message || e);
            if (msg.includes('ERR_CODE_NOT_FOUND')) setError('Code not found. Check the 4-letter code and try again.');
            else if (msg.toLowerCase().includes('room not found')) setError('This room no longer exists.');
            else setError('Could not join from link. You can paste the code manually.');
          }
        }
      } catch {}
    };
    tryDeepLink();
  }, [client]);

  // Stable identity
  const selfId = client.selfId;
  const amHost = !!(room && room.hostId === selfId);

  // actions
  const createRoom = async () => {
    const nickname = name.trim().slice(0, MAX_NAME) || 'Guest';
    try {
      await client.createRoom({ slug: 'typing-race', version: '0.1.0', name: nickname, avatar });
      setView('lobby');
      setError(null);
    } catch (e:any) {
      const msg = String(e?.message || e);
      console.error('createRoom failed:', e);
      if (msg.includes('ERR_PERMISSION_DENIED')) setError('Permission denied by database rules. Check Anonymous Auth + rules.');
      else if (msg.includes('ERR_ALLOCATE_CODE')) setError('Could not allocate a join code. Try again.');
      else if (msg.includes('ERR_CODE_WRITE')) setError('Could not reserve join code — rules forbid writes to /codes.');
      else setError('Could not create room. Please try again.');
    }
  };

  const joinRoom = async () => {
    const nickname = name.trim().slice(0, MAX_NAME) || 'Guest';
    const entered = code.trim().toUpperCase();
    if (entered.length !== 4) { setError('Enter a 4-character code (e.g., AB12).'); return; }
    try { await client.joinRoomByCode({ code: entered, name: nickname, avatar }); setView('lobby'); setError(null); }
    catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes('ERR_CODE_NOT_FOUND')) setError('Code not found. Check the 4-letter code and try again.');
      else if (msg.toLowerCase().includes('room not found')) setError('This room no longer exists.');
      else setError('Could not join. Please try again.');
    }
  };

  const leaveLobby = async () => {
    await client.leaveRoom();
    setRoom(null); setPlayers([]); setChat([]); setWarn(null); setCooldownMs(0); setReadyIds([]); setView('home');
  };

  const sendChat = async () => {
    const t = chatText.trim();
    if (!t) return;
    try { await client.sendText(t); setChatText(''); } catch {}
  };

  const canSend = cooldownMs <= 0 && chatText.trim().length > 0;

  // ready helpers
  const isSelfReady = readyIds.includes(selfId);
  const everyoneReady = players.length >= 2 && readyIds.length >= 2 && readyIds.length === players.length;

  const toggleReady = async () => {
    try {
      await client.setReady(); // toggle
    } catch (e:any) {
      setError('Could not update Ready — check your connection.');
    }
  };

  const startCountdown = async () => {
    if (!amHost) { showLobbyMsg('Only the host can start the game.'); return; }
    if (players.length < 2) { showLobbyMsg('Need at least 2 players to start.'); return; }
    if (!everyoneReady) { showLobbyMsg('Everyone must be Ready before starting.'); return; }
    try { await client.hostStartCountdown(3); }
    catch (e: any) {
      const msg = String(e?.message || e);
      if (/PERMISSION|insufficient/i.test(msg)) showLobbyMsg('Start is blocked by database rules.');
      else if (/ERR_NOT_HOST/.test(msg)) showLobbyMsg('Only the host can start the game.');
      else showLobbyMsg('Could not start — check your connection.');
      console.warn('hostStartCountdown failed:', msg);
    }
  };

  // share
  const shareCode = async () => {
    const joinCode = room?.joinCode || '';
    const base = (import.meta as any).env?.BASE_URL ?? '/';
    const joinPath = `${base.replace(/\/?$/, '/') }join/${joinCode}`; // ensures trailing '/'
    const link = `${location.origin}${joinPath}`;
    const text = `Join my room (${joinCode}) — ${link}`;
    try {
      if ((navigator as any).share) await (navigator as any).share({ title: 'Creative Hub', text, url: link });
      else { await navigator.clipboard.writeText(text); setWarn('Join link copied to clipboard.'); }
    } catch {}
  };

  // reactions
  const sendReaction = async (type: keyof typeof REACTION_EMOJI) => {
    const key = `${selfId}-${Date.now()}`;
    setActiveReactions(prev => ({ ...prev, [selfId]: { type, key } }));
    window.setTimeout(() => {
      setActiveReactions(prev => {
        if (prev[selfId]?.key !== key) return prev;
        const copy = { ...prev }; delete copy[selfId]; return copy;
      });
    }, 1500);
    try { await client.sendReaction(type as any); } catch (e) { console.warn('sendReaction failed', e); }
  };
  const onAvatarTap = () => sendReaction('wave');

  // host: open settings
  const openSettings = () => {
    const delay = (room as any)?.options?.chatDelayMs ?? (room as any)?.options?.slowModeMs ?? 0;
    setChatDelayMsDraft(delay);
    setSettingsOpen(true);
    (document.getElementById('settings-dialog') as HTMLDialogElement | null)?.showModal?.();
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    (document.getElementById('settings-dialog') as HTMLDialogElement | null)?.close?.();
  };
  const saveSettings = async () => {
    try {
      await client.updateOptions({
        chatDelayMs: Math.max(0, Math.min(60000, Math.round(chatDelayMsDraft)))
      });
      showLobbyMsg('Settings updated.');
      closeSettings();
    } catch (e:any) {
      console.warn('updateOptions failed', e);
      showLobbyMsg('Could not update settings.');
    }
  };

  // host: mute / unmute
  const mutePlayer = async (pid: string) => {
    try { await client.shadowMute(pid, 5); showLobbyMsg('Player muted (5 min).'); }
    catch { showLobbyMsg('Could not mute player.'); }
  };
  const unmutePlayer = async (pid: string) => {
    try { await client.shadowUnmute(pid); showLobbyMsg('Player unmuted.'); }
    catch { showLobbyMsg('Could not unmute player.'); }
  };

  const renderCountdown = () => {
    if (room?.status !== 'starting') return null;
    const sec = Math.ceil(countdownMs / 1000);
    return <div className="small" style={{ fontSize: 18, fontWeight: 600 }}>{sec > 0 ? `Starting in ${sec}…` : 'GO!'}</div>;
  };

  return (
    <div className="container">
      <h1>Creative Hub</h1>

      {view === 'home' && (
        <div className="card">
          <div className="two">
            <div>
              <div className="field">
                <label>Nickname</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Up to 20 chars" maxLength={MAX_NAME} />
              </div>

              <div className="field">
                <label>Join Code</label>
                <Input className="upper" value={code} onChange={(e) => setCode(e.target.value)} placeholder="AB12" maxLength={4} />
                {error && <div className="error" role="alert">{error}</div>}
              </div>

              <div className="row">
                <Button type="button" onClick={createRoom}>Create Room</Button>
                <Button type="button" className="secondary" onClick={joinRoom}>Join Room</Button>
              </div>
            </div>

            <div>
              <h3>Avatar</h3>

              {/* Avatar chooser: portrait + actions + presets */}
              <div style={{ display:'grid', gridTemplateColumns:'112px 1fr', gap: 12 }}>
                {/* Large portrait */}
                <div style={{
                  width:112, height:112, borderRadius:16, background:'#0b1220',
                  display:'grid', placeItems:'center'
                }}>
                  {renderAvatar(avatar, 96)}
                </div>

                {/* Actions + presets */}
                <div>
                  <div className="row" style={{ gap: 8, marginBottom: 8, alignItems:'center' }}>
                    <Button type="button" onClick={() => (document.getElementById('doodle-editor-dialog') as HTMLDialogElement | null)?.showModal()}>
                      Design your avatar
                    </Button>
                    <span className="small" style={{ opacity: .8 }}>or pick a preset</span>
                  </div>

                  <div className="grid">
                    {presetIds.map((id) => {
                      const selected = avatar?.kind === 'preset' && (avatar as any).id === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setAvatar({ kind: 'preset', id } as any)}
                          className={`avatar-option ${selected ? 'selected' : ''}`}
                          aria-label={`Preset ${id}`}
                        >
                          <div className="avatar">{renderAvatar({ kind: 'preset', id } as any, AVATAR_SIZE)}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Keep editor mounted; Save auto-closes the dialog */}
              <AvatarEditor value={avatar} onChange={(a) => { setAvatar(a); }} />
            </div>
          </div>
        </div>
      )}

      {view === 'lobby' && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap:'wrap' }}>
            <div>
              <div className="small">Room Code</div>
              <div className="code" style={{ fontSize: 24 }}>{room?.joinCode ?? '----'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap:'wrap' }}>
              <div>
                <div className="small">Status</div>
                <div style={{ fontSize: 18 }}>{room?.status ?? 'lobby'}</div>
                {renderCountdown()}
              </div>
              <Button type="button" onClick={shareCode} title="Copy/share Join link">Share code</Button>
              {amHost && (
                <Button type="button" className="secondary" onClick={openSettings} title="Room settings">
                  Settings
                </Button>
              )}
              <Button type="button" className="secondary" onClick={leaveLobby}>Leave lobby</Button>
            </div>
          </div>

          <hr />
          <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap:'wrap' }}>
            <h3 style={{ margin: 0 }}>Players</h3>
            <div className="small" aria-live="polite">Ready {readyIds.length}/{players.length}</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Button type="button" onClick={toggleReady}>{isSelfReady ? 'Unready' : 'Ready'}</Button>
              <Button type="button" onClick={startCountdown} title="Host: start countdown">Start in 3s</Button>
            </div>
          </div>

          {lobbyMsg && <div className="small" role="status" style={{ marginTop: 6, opacity: 0.9 }}>{lobbyMsg}</div>}

          <div className="list" style={{ marginTop: 8 }}>
            {players.map((p) => {
              const isReady = readyIds.includes(p.id);
              const active = activeReactions[p.id];
              const mutedUntil = (p as any)?.mutedUntil ?? 0;
              const isMuted = mutedUntil > Date.now();
              return (
                <div key={p.id} className="inline" style={{ display: 'flex', alignItems: 'center', columnGap: GAP_AFTER_AVATAR, flexWrap:'wrap' }}>
                  <button type="button" onClick={onAvatarTap} style={avatarBtnStyle} title="Tap to wave">
                    {renderAvatar(p.avatar, AVATAR_SIZE)}
                  </button>

                  {/* Reaction slot (no overlap) */}
                  <div style={reactionSlotStyle}>
                    {active && <div style={reactionChipStyle} aria-hidden>{REACTION_EMOJI[active.type]}</div>}
                  </div>

                  {/* Name & status */}
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <div>
                      <div>
                        {p.name} <span className="small">({p.role})</span>
                        {isReady && <span className="small" style={{ marginLeft: 8, color: 'var(--ok, #16a34a)' }}>• Ready</span>}
                        {p.id === selfId && <span className="small" style={{ marginLeft: 8, opacity: 0.8 }}>(you)</span>}
                        {isMuted && <span className="small" style={{ marginLeft: 8, color:'#f59e0b' }}>• Muted</span>}
                      </div>
                    </div>

                    {/* Host actions per player */}
                    {amHost && p.id !== selfId && (
                      <div className="row" style={{ gap:6 }}>
                        {!isMuted
                          ? <Button type="button" className="secondary" onClick={() => mutePlayer(p.id)}>Mute</Button>
                          : <Button type="button" className="secondary" onClick={() => unmutePlayer(p.id)}>Unmute</Button>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick reactions bar */}
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap:'wrap' }}>
            <Button type="button" onClick={() => sendReaction('wave')} style={iconBtn} title="Wave">{REACTION_EMOJI.wave}</Button>
            <Button type="button" onClick={() => sendReaction('clap')} style={iconBtn} title="Clap">{REACTION_EMOJI.clap}</Button>
            <Button type="button" onClick={() => sendReaction('laugh')} style={iconBtn} title="Laugh">{REACTION_EMOJI.laugh}</Button>
            <Button type="button" onClick={() => sendReaction('wow')} style={iconBtn} title="Wow">{REACTION_EMOJI.wow}</Button>
            <Button type="button" onClick={() => sendReaction('nope')} style={iconBtn} title="Nope">{REACTION_EMOJI.nope}</Button>
          </div>

          <hr />
          <h3>Chat</h3>
          <div className="chat">
            {chat.map((m: any) => (
              <div key={m.id}>
                <span className="small">[{new Date(m.createdAt).toLocaleTimeString()}] </span>
                <strong>{m.name}: </strong>
                <span>{m.text}</span>
              </div>
            ))}
          </div>

          <div className="row stretch" style={{ marginTop: 8 }}>
            <Input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) sendChat();
                }
              }}
              placeholder={cooldownMs > 0 ? `Chat delay: ${(cooldownMs/1000).toFixed(1)}s` : 'Say hi'}
              maxLength={160}
              aria-invalid={!!warn}
              aria-describedby={warn ? 'chat-warn' : undefined}
            />
            <Button type="button" onClick={sendChat} disabled={!canSend}>{cooldownMs > 0 ? 'Wait…' : 'Send'}</Button>
          </div>
          {warn && <div id="chat-warn" className="small" style={{ marginTop: 6, opacity: 0.8 }}>
            {cooldownMs > 0 ? `Chat delay active — ${(cooldownMs/1000).toFixed(1)}s remaining.` : warn}
          </div>}
        </div>
      )}

      {/* Host-only Settings dialog (mobile-friendly) */}
      <dialog id="settings-dialog"
        style={{
          width: 'min(520px, 94vw)', borderRadius: 12, border: '1px solid #1e293b',
          padding: 16, background: '#0b1220', color: 'white'
        }}
        onClose={() => setSettingsOpen(false)}
      >
        <form method="dialog" style={{ margin:0 }}>
          <h3 style={{ marginTop: 0 }}>Room Settings</h3>
          {!amHost && <div className="small" style={{ marginBottom: 8, opacity:0.8 }}>Only the host can change settings.</div>}

          <div className="field">
            <label>Chat delay</label>
            <div className="small" style={{ opacity:.85, marginBottom: 6 }}>
              Enforce a minimum delay between messages for each player.
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'center' }}>
              <input
                type="range"
                min={0}
                max={10000}
                step={250}
                value={chatDelayMsDraft}
                onChange={(e) => setChatDelayMsDraft(Number(e.target.value))}
                disabled={!amHost}
              />
              <div className="small" style={{ minWidth:72, textAlign:'right' }}>
                {(chatDelayMsDraft/1000).toFixed(2)}s
              </div>
            </div>
          </div>

          <div className="row" style={{ marginTop: 16, justifyContent:'flex-end', gap:8 }}>
            <Button type="button" className="secondary" onClick={closeSettings}>Close</Button>
            <Button type="button" onClick={saveSettings} disabled={!amHost}>Save</Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}