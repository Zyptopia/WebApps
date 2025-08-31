// FILE: packages/avatars/src/AvatarEditor.tsx
import React from 'react';
import { classic16 } from './palette';
import { rleEncode, rleDecode, bytesToBase64, base64ToBytes, base64Bytes } from './rle';
import type { Avatar } from './index';

const SIZE = 64 as const;
const UNDO_MAX = 60;
const MAX_BYTES = 12 * 1024;
const MIN_DRAWN = 48;

// 0 = transparent (lets BG show); 1..15 = palette colors
const EMPTY = 0 as const;

type Tool = 'pen' | 'eraser' | 'fill';
type Pt = { x: number; y: number };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const at = (x: number, y: number) => y * SIZE + x;

function floodFill(buf: Uint8Array, x: number, y: number, from: number, to: number) {
  if (from === to) return;
  const q: Pt[] = [{ x, y }],
    seen = new Uint8Array(SIZE * SIZE);
  while (q.length) {
    const p = q.pop()!,
      k = at(p.x, p.y);
    if (seen[k]) continue;
    seen[k] = 1;
    if (buf[k] !== from) continue;
    buf[k] = to;
    if (p.x > 0) q.push({ x: p.x - 1, y: p.y });
    if (p.x + 1 < SIZE) q.push({ x: p.x + 1, y: p.y });
    if (p.y > 0) q.push({ x: p.x, y: p.y - 1 });
    if (p.y + 1 < SIZE) q.push({ x: p.x, y: p.y + 1 });
  }
}

function toArrayBuffer(src: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(src.byteLength);
  new Uint8Array(ab).set(src);
  return ab;
}
async function sha1Hex(bytes: Uint8Array) {
  try {
    const dig = await crypto.subtle?.digest?.('SHA-1', toArrayBuffer(bytes));
    if (dig) {
      const a = new Uint8Array(dig);
      return Array.from(a)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {}
  // FNV-1a fallback
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function paintTo(canvas: HTMLCanvasElement, idx: Uint8Array, pal: string[], bgIdx: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < idx.length; i++) {
    const pi = idx[i] === EMPTY ? bgIdx : idx[i];
    const v = parseInt((pal[pi] || '#000000').slice(1), 16);
    const k = i * 4;
    img.data[k] = (v >> 16) & 255;
    img.data[k + 1] = (v >> 8) & 255;
    img.data[k + 2] = v & 255;
    img.data[k + 3] = 255;
  }
  (ctx as any).imageSmoothingEnabled = false;
  ctx.putImageData(img, 0, 0);
}

const useMobile = () => {
  const [m, set] = React.useState(() =>
    typeof window !== 'undefined' ? matchMedia('(max-width:640px)').matches : false
  );
  React.useEffect(() => {
    const mq = matchMedia('(max-width:640px)');
    const f = () => set(mq.matches);
    mq.addEventListener?.('change', f);
    return () => mq.removeEventListener?.('change', f);
  }, []);
  return m;
};

type Brush = 1 | 3; // pen 1px; eraser 3×3
const stamp = (buf: Uint8Array, p: Pt, c: number, b: Brush) => {
  if (b === 1) {
    if (p.x >= 0 && p.x < SIZE && p.y >= 0 && p.y < SIZE) buf[at(p.x, p.y)] = c;
    return;
  }
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = p.x + dx,
        y = p.y + dy;
      if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) buf[at(x, y)] = c;
    }
};
const line = (buf: Uint8Array, a: Pt, b: Pt, c: number, br: Brush) => {
  let x = a.x,
    y = a.y;
  const dx = Math.abs(b.x - a.x),
    sx = a.x < b.x ? 1 : -1,
    dy = -Math.abs(b.y - a.y),
    sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    stamp(buf, { x, y }, c, br);
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
};

export function AvatarEditor({
  value,
  onChange,
}: {
  value?: Avatar | null;
  onChange: (a: Avatar) => void;
}) {
  const mobile = useMobile();
  const palette = classic16;

  // Import
  const initial = React.useMemo(() => {
    if (value?.kind === 'doodle') {
      try {
        return rleDecode(base64ToBytes(value.rle));
      } catch {}
    }
    return new Uint8Array(SIZE * SIZE).fill(EMPTY);
  }, [value]);

  const [idx, setIdx] = React.useState(initial);
  const undo = React.useRef<Uint8Array[]>([]);
  const redo = React.useRef<Uint8Array[]>([]);
  const commit = (next: Uint8Array) => {
    undo.current.push(idx);
    if (undo.current.length > UNDO_MAX) undo.current.shift();
    redo.current = [];
    setIdx(next);
  };
  const doUndo = () => {
    const p = undo.current.pop();
    if (!p) return;
    redo.current.push(idx);
    setIdx(p);
  };
  const doRedo = () => {
    const n = redo.current.pop();
    if (!n) return;
    undo.current.push(idx);
    setIdx(n);
  };

  const [tool, setTool] = React.useState<Tool>('pen');
  const [col, setCol] = React.useState(1); // 1..15
  const [bg, setBg] = React.useState(
    value?.kind === 'doodle' && typeof value.meta.bg === 'number' ? value.meta.bg : 0
  );
  const [bgMode, setBgMode] = React.useState(false);

  // Layout refs
  const dlgRef = React.useRef<HTMLDialogElement | null>(null);
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const boardRef = React.useRef<HTMLDivElement | null>(null);
  const toolsRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const [scale, setScale] = React.useState(5);
  const [offset, setOffset] = React.useState<Pt>({ x: 0, y: 0 });

  const pointers = React.useRef<Map<number, Pt>>(new Map());
  const pinch = React.useRef<{ d: number; s0: number } | null>(null);
  const drawing = React.useRef(false);
  const last = React.useRef<Pt | null>(null);

  React.useEffect(() => {
    if (canvasRef.current) paintTo(canvasRef.current, idx, palette, bg);
  }, [idx, bg]);

  // Lock page scroll & do fixed overlay sizing
  React.useLayoutEffect(() => {
    const dlg =
      (document.getElementById('doodle-editor-dialog') as HTMLDialogElement | null) ||
      dlgRef.current;
    if (!dlg) return;
    dlg.style.padding = '0';
    dlg.style.margin = '0';
    dlg.style.background = 'transparent';
    dlg.style.position = 'fixed';
    dlg.style.inset = '0';
    dlg.style.width = '100vw';
    dlg.style.height = '100dvh';
    dlg.style.border = 'none';
    const lock = () => {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    };
    const unlock = () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
    if (dlg.open) lock();
    const mo = new MutationObserver(() => {
      dlg.open ? lock() : unlock();
    });
    mo.observe(dlg, { attributes: true, attributeFilter: ['open'] });

    const fit = () => {
      if (!sheetRef.current || !boardRef.current || !toolsRef.current) return;
      // Sheet is full screen; compute available board height precisely: sheet - tools - paddings - gap
      const SHEET_PAD = 12;
      const GAP = 10;
      const fullH = window.innerHeight;
      const toolsH = toolsRef.current.getBoundingClientRect().height;
      const boardH = Math.max(100, fullH - SHEET_PAD * 2 - toolsH - GAP);
      boardRef.current.style.height = `${boardH}px`;

      const r = boardRef.current.getBoundingClientRect();
      const s = Math.floor(Math.min(r.width / SIZE, r.height / SIZE));
      const newScale = clamp(s, mobile ? 3 : 4, 12);
      setScale(newScale);
      const w = SIZE * newScale,
        h = SIZE * newScale;
      setOffset({ x: Math.max(0, (r.width - w) / 2), y: Math.max(0, (r.height - h) / 2) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    sheetRef.current && ro.observe(sheetRef.current);
    toolsRef.current && ro.observe(toolsRef.current);
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
      mo.disconnect();
      unlock();
    };
  }, [mobile]);

  const toBoard = (cx: number, cy: number): Pt | null => {
    const r = boardRef.current!.getBoundingClientRect();
    const x = cx - r.left - offset.x,
      y = cy - r.top - offset.y;
    const px = Math.floor(x / scale),
      py = Math.floor(y / scale);
    if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) return null;
    return { x: px, y: py };
  };

  const onDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s0: scale };
      return;
    }
    if (e.button === 1 || e.buttons === 2 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey)
      return;
    const p = toBoard(e.clientX, e.clientY);
    if (!p) return;
    if (tool === 'fill') {
      const next = new Uint8Array(idx);
      const from = next[at(p.x, p.y)];
      const to = bgMode ? EMPTY : col;
      floodFill(next, p.x, p.y, from, to);
      commit(next);
      return;
    }
    drawing.current = true;
    last.current = p;
    const next = new Uint8Array(idx);
    const isE = tool === 'eraser';
    stamp(next, p, isE ? EMPTY : col, isE ? 3 : 1);
    setIdx(next);
  };

  const onMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (pointers.current.size >= 2 && pinch.current) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = Array.from(pointers.current.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setScale(clamp(pinch.current.s0 * (d / pinch.current.d), 3, 12));
      return;
    }
    if (
      e.buttons === 2 ||
      (e.buttons === 1 && (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey))
    ) {
      setOffset((o) => ({ x: o.x + e.movementX, y: o.y + e.movementY }));
      return;
    }
    if (!drawing.current) return;
    const p = toBoard(e.clientX, e.clientY);
    if (!p || !last.current) return;
    const next = new Uint8Array(idx);
    const isE = tool === 'eraser';
    line(next, last.current, p, isE ? EMPTY : col, isE ? 3 : 1);
    setIdx(next);
    last.current = p;
  };

  const onUp: React.PointerEventHandler<HTMLDivElement> = (e) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (drawing.current) {
      commit(new Uint8Array(idx));
      drawing.current = false;
      last.current = null;
    }
  };

  const clear = () => commit(new Uint8Array(SIZE * SIZE).fill(EMPTY));

  const save = async () => {
    let drawn = 0;
    for (let i = 0; i < idx.length; i++) if (idx[i] !== EMPTY) drawn++;
    if (drawn < MIN_DRAWN) {
      alert(`Try drawing a bit more (≥ ${MIN_DRAWN} pixels).`);
      return;
    }
    const b64 = bytesToBase64(rleEncode(idx));
    if (base64Bytes(b64) > MAX_BYTES) {
      alert('Avatar is over 12KB — simplify it a little.');
      return;
    }
    const hash = await sha1Hex(idx);
    onChange({
      kind: 'doodle',
      meta: { size: SIZE, palette: classic16, bg, createdAt: Date.now(), hash },
      rle: b64,
    });
    (document.getElementById('doodle-editor-dialog') as HTMLDialogElement | null)?.close();
  };

  // Sizes
  const SHEET_PAD = 12;
  const GAP = 10;
  const SW = mobile ? 20 : 22;

  return (
    <div>
      <dialog
        id="doodle-editor-dialog"
        ref={dlgRef}
        style={{ border: 'none', background: 'transparent', inset: 0, position: 'fixed' as const }}
      >
        <div
          ref={sheetRef}
          style={{
            position: 'fixed',
            inset: 0,
            padding: `${SHEET_PAD}px`,
            paddingBottom: `calc(${SHEET_PAD}px + env(safe-area-inset-bottom))`,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(0,0,0,0.35)', // dim backdrop
          }}
        >
          <div
            style={{
              margin: '0 auto',
              height: '100%',
              width: 'min(920px, calc(100vw - 16px))',
              display: 'flex',
              flexDirection: 'column',
              gap: GAP,
            }}
          >
            {/* BOARD (flex:1) */}
            <div
              ref={boardRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                flex: '1 1 auto',
                position: 'relative',
                overflow: 'hidden',
                borderRadius: 12,
                background: '#0f172a',
                touchAction: 'none',
                minHeight: 0,
                outline: '2px solid rgba(255,255,255,.16)', // **VISIBLE BORDER**
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.55)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: offset.x,
                  top: offset.y,
                  width: SIZE * scale,
                  height: SIZE * scale,
                  imageRendering: 'pixelated' as any,
                }}
              >
                <canvas
                  ref={canvasRef}
                  width={SIZE}
                  height={SIZE}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>

            {/* TOOLS (auto height, never overflows) */}
            <div ref={toolsRef} style={{ display: 'grid', gap: GAP, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: GAP }}>
                <button
                  onClick={() => setTool('pen')}
                  className={`btn ${tool === 'pen' ? '' : 'secondary'}`}
                  style={{ padding: 8 }}
                  title="Pen"
                >
                  ✏️
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  className={`btn ${tool === 'eraser' ? '' : 'secondary'}`}
                  style={{ padding: 8 }}
                  title="Eraser (3×3)"
                >
                  🩹
                </button>
                <button
                  onClick={() => setTool('fill')}
                  className={`btn ${tool === 'fill' ? '' : 'secondary'}`}
                  style={{ padding: 8 }}
                  title="Fill"
                >
                  🪣
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="small">Palette</span>
                <button
                  className={`btn ${bgMode ? '' : 'secondary'}`}
                  onClick={() => setBgMode((v) => !v)}
                  style={{ padding: 4, minWidth: 36 }}
                >
                  BG
                </button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1, minWidth: 0 }}>
                  {classic16.map((hex, i) => {
                    const sel = i === col && !bgMode,
                      isBG = i === bg;
                    return (
                      <button
                        key={i}
                        onClick={() => (bgMode ? setBg(i) : setCol(i))}
                        title={bgMode ? 'Set background' : `Color ${i}`}
                        style={{
                          width: SW,
                          height: SW,
                          borderRadius: 8,
                          border: sel ? '2px solid #fff' : '1px solid #111',
                          background: hex,
                          boxShadow: isBG ? 'inset 0 0 0 2px #22d3ee' : 'none',
                          flex: '0 0 auto',
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto auto auto 1fr auto auto auto',
                  gap: 6,
                  alignItems: 'center',
                }}
              >
                <span className="small">Zoom</span>
                <button
                  className="btn secondary"
                  onClick={() => setScale((s) => clamp(s - 1, mobile ? 3 : 4, 12))}
                >
                  −
                </button>
                <div style={{ minWidth: 28, textAlign: 'center' }}>{Math.round(scale)}×</div>
                <div />
                <button className="btn secondary" onClick={doUndo} title="Undo">
                  ↶
                </button>
                <button className="btn secondary" onClick={doRedo} title="Redo">
                  ↷
                </button>
                <button className="btn secondary" onClick={clear} title="Clear">
                  Clear
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn" onClick={save}>
                  Save
                </button>
                <button
                  className="btn secondary"
                  onClick={() =>
                    (document.getElementById('doodle-editor-dialog') as HTMLDialogElement)?.close()
                  }
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}
