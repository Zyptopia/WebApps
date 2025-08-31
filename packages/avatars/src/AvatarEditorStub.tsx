import React, { useMemo, useRef, useState } from 'react';
import type { Avatar } from '@sdk/game-sdk';
import { renderAvatar } from './renderAvatar';

export function AvatarEditorStub({
  value,
  onChange,
}: {
  value: Avatar | null | undefined;
  onChange: (a: Avatar) => void;
}) {
  const [seed] = useState(Math.random());
  const ref = useRef<HTMLCanvasElement>(null);
  const palette = useMemo(
    () => ['#000000', '#ffffff', '#f43f5e', '#22c55e', '#3b82f6', '#eab308', '#a78bfa'],
    []
  );

  const makeDoodle = (): Avatar => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = palette[Math.floor(seed * palette.length)];
    ctx.fillRect(8, 8, 48, 48);
    return { kind: 'doodle', meta: { w: 64, h: 64, palette }, rle: 'stub' };
  };

  return (
    <button
      type="button"
      className="avatar-option"
      onClick={() => onChange(makeDoodle())}
      title="Doodle (stub)"
      aria-label="Doodle (stub)"
    >
      <canvas ref={ref} width={64} height={64} style={{ display: 'none' }} />
      <div className="avatar">{renderAvatar(value ?? { kind: 'preset', id: 'p1' }, 48)}</div>
    </button>
  );
}
