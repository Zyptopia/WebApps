import React from 'react';
import { rleDecode, base64ToBytes } from './rle';
import type { Avatar } from './index';
import { presets } from './presets';

// draw a doodle to a canvas, crisp-pixel scaling
function drawDoodle(
  canvas: HTMLCanvasElement,
  avatar: Extract<Avatar, { kind: 'doodle' }>,
  size: number
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = 64;
  canvas.height = 64;
  (canvas.style as any).imageRendering = 'pixelated';
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const idx = rleDecode(base64ToBytes(avatar.rle));
  const pal = Array.isArray(avatar.meta.palette) ? avatar.meta.palette : ['#000', '#fff']; // fallback
  const data = ctx.createImageData(64, 64);
  for (let i = 0; i < idx.length; i++) {
    const hex = pal[idx[i]] || '#000000';
    const v = parseInt(hex.slice(1), 16);
    const k = i * 4;
    data.data[k] = (v >> 16) & 255;
    data.data[k + 1] = (v >> 8) & 255;
    data.data[k + 2] = v & 255;
    data.data[k + 3] = 255;
  }
  (ctx as any).imageSmoothingEnabled = false;
  ctx.putImageData(data, 0, 0);
}

function PresetSVG({ id, size }: { id: string; size: number }) {
  const svg = presets[id] || null;
  if (!svg) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 12,
          background: '#111827',
          display: 'grid',
          placeItems: 'center',
          color: '#60a5fa',
          fontSize: Math.round(size * 0.4),
        }}
      >
        🙂
      </div>
    );
  }
  return <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function DoodleCanvas({
  avatar,
  size,
}: {
  avatar: Extract<Avatar, { kind: 'doodle' }>;
  size: number;
}) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  React.useEffect(() => {
    if (ref.current) drawDoodle(ref.current, avatar, size);
  }, [avatar, size]);
  return (
    <canvas
      ref={ref}
      width={64}
      height={64}
      style={{ width: size, height: size, imageRendering: 'pixelated' as any }}
    />
  );
}

export function renderAvatar(avatar: Avatar | null | undefined, size: number): JSX.Element {
  if (!avatar) return <PresetSVG id="p1" size={size} />;
  if (avatar.kind === 'preset') return <PresetSVG id={avatar.id} size={size} />;
  return <DoodleCanvas avatar={avatar} size={size} />;
}
