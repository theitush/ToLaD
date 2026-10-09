// Data worker: fetch (or take inlined bytes), decode and lay out .tld files,
// and post the result back with its typed arrays as Transferables.

import { processBuffer, transferables } from './river';

interface Init {
  type: 'init';
  /** Base URL of data/mammals/ (ends with '/'), when fetching. */
  base: string | null;
  /** Inlined files (single-file build): path → base64. */
  inline: Record<string, string> | null;
}
interface Load {
  type: 'load';
  id: number;
  /** -1 = skeleton, else a tile id. */
  tile: number;
}

let base: string | null = null;
let inline: Record<string, string> | null = null;

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function bytesOf(tile: number): Promise<Uint8Array> {
  const path = tile < 0 ? 'skeleton.tld' : `t/${tile}.tld`;
  if (inline) {
    const b = inline[path];
    if (!b) throw new Error(`${path} is not inlined`);
    return fromBase64(b);
  }
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

self.onmessage = async (ev: MessageEvent<Init | Load>) => {
  const m = ev.data;
  if (m.type === 'init') {
    base = m.base;
    inline = m.inline;
    return;
  }
  try {
    const t0 = performance.now();
    const bytes = await bytesOf(m.tile);
    const p = processBuffer(bytes, m.tile);
    const ms = performance.now() - t0;
    (self as unknown as Worker).postMessage({ id: m.id, ok: true, file: p, ms, bytes: bytes.byteLength }, transferables(p));
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: m.id, ok: false, error: String(e) });
  }
};
