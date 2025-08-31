// ================================
// FILE: apps/hub/src/components/LobbyPanel.tsx (types clarified)
// Only needed if you actually render this component.
// ================================

import React, { useMemo, useState } from 'react';
import { useClient } from '../sdk/ClientContext';

export default function LobbyPanel() {
  const { client, room, players, readyIds, amHost } = useClient();
  const [saving, setSaving] = useState(false);
  const [delay, setDelay] = useState<number>(() =>
    Number((room as any)?.options?.chatDelayMs ?? 0)
  );
  const allReady = useMemo(() => {
    if (!players.length) return false;
    const ids = new Set(players.map((p: any) => p.id));
    for (const id of ids) if (!readyIds.has(id)) return false;
    return ids.size >= 2; // require at least 2 players
  }, [players, readyIds]);

  if (!room) return null;

  const doReady = async () => {
    await client.setReady();
  };
  const doStart = async () => {
    try {
      await client.hostStartCountdown(3);
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  };
  const saveOpts = async () => {
    try {
      setSaving(true);
      await client.updateOptions({ chatDelayMs: Number(delay) || 0 });
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };
  const mute = async (id: string) => {
    try {
      await client.shadowMute(id, 5);
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  };
  const unmute = async (id: string) => {
    try {
      await client.shadowUnmute(id);
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  };

  return (
    <div className="lobby card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs opacity-70">Room Code</div>
          <div className="text-xl font-semibold">{(room as any).joinCode}</div>
          <div className="text-xs mt-1">
            Status <b>{(room as any).status}</b>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="btn"
            onClick={() => navigator.clipboard.writeText((room as any).joinCode)}
          >
            Share code
          </button>
        </div>
      </div>

      <div>
        <div className="font-semibold mb-2">
          Players{' '}
          <span className="text-xs opacity-70">
            Ready {readyIds.size}/{players.length}
          </span>
        </div>
        <div className="space-y-2">
          {players.map((p: any) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded bg-black/10 px-3 py-2"
            >
              <div>
                <div className="font-medium">
                  {p.name} <span className="opacity-70 text-sm">({p.role})</span>
                </div>
                <div className="text-xs opacity-60">
                  {p.id === client.selfId ? 'you' : p.id.slice(0, 6)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {amHost && p.id !== client.selfId && (
                  <>
                    <button className="btn" onClick={() => mute(p.id)}>
                      Mute
                    </button>
                    <button className="btn" onClick={() => unmute(p.id)}>
                      Unmute
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className="btn" onClick={doReady}>
          Ready
        </button>
        <button className="btn" disabled={!amHost || !allReady} onClick={doStart}>
          Start in 3s
        </button>
      </div>

      {amHost && (
        <div className="rounded bg-black/10 p-3 space-y-2">
          <div className="font-semibold">Room settings (host)</div>
          <label className="text-sm">Chat delay (ms)</label>
          <input
            className="input"
            type="number"
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value) || 0)}
          />
          <div>
            <button className="btn" onClick={saveOpts} disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
