export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function rleEncode(indices: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < indices.length) {
    const v = indices[i];
    let run = 1;
    while (i + run < indices.length && indices[i + run] === v && run < 255) run++;
    out.push(run, v);
    i += run;
  }
  return new Uint8Array(out);
}

export function rleDecode(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(64 * 64);
  let j = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    const run = bytes[i];
    const v = bytes[i + 1];
    out.fill(v, j, j + run);
    j += run;
  }
  return out;
}

// size guard helper
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length * 3) / 4 - pad;
}
