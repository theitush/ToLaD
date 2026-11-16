// Numbers packed for mammals.json (ToLaD#255): typed arrays as base64, so the page reads a few long strings instead of
// parsing millions of JSON numbers, and every number comes back bit for bit (a float64 is its own 8 bytes).
import type { Genealogy } from './population';
import type { Confidence, Split } from './splits';

/** Bytes to base64 (in chunks: String.fromCharCode takes so many arguments at a time). */
export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** base64 to bytes (a fresh buffer, aligned for any typed array over it). */
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** float64s as base64 (little-endian, the platform's order on every browser that runs WebGL). */
export const f64ToBase64 = (a: ArrayLike<number>): string => toBase64(new Uint8Array(Float64Array.from(a).buffer));
export const f64FromBase64 = (s: string): Float64Array => new Float64Array(fromBase64(s).buffer);

/** Non-negative integers as base64 varints (7 bits a byte, low first). */
export function uintsToBase64(a: ArrayLike<number>): string {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) {
    let v = a[i];
    if (!(Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER)) throw new Error(`not a whole number >= 0: ${v}`);
    while (v >= 128) {
      out.push((v % 128) | 128);
      v = Math.floor(v / 128);
    }
    out.push(v);
  }
  return toBase64(Uint8Array.from(out));
}
export function uintsFromBase64(s: string): number[] {
  const b = fromBase64(s);
  const out: number[] = [];
  let v = 0;
  let m = 1;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    v += (c & 127) * m;
    if (c < 128) {
      out.push(v);
      v = 0;
      m = 1;
    } else m *= 128;
  }
  return out;
}

/**
 * float64s as base64 in byte planes (every value's first byte, then every second...): the planes of sign and exponent
 * repeat, so the file's gzip takes them down where interleaved bytes would not; bit for bit.
 */
export function f64PlanesToBase64(a: ArrayLike<number>): string {
  const b = new Uint8Array(Float64Array.from(a).buffer);
  const n = a.length;
  const out = new Uint8Array(b.length);
  for (let i = 0; i < n; i++) for (let p = 0; p < 8; p++) out[p * n + i] = b[i * 8 + p];
  return toBase64(out);
}
export function f64PlanesFromBase64(s: string): Float64Array {
  const b = fromBase64(s);
  const n = b.length / 8;
  const out = new Uint8Array(b.length);
  for (let p = 0; p < 8; p++) for (let i = 0; i < n; i++) out[i * 8 + p] = b[p * n + i];
  return new Float64Array(out.buffer);
}

/**
 * Genealogies as mammals.json carries them: per entry its gid and start, and either an earlier entry whose genealogy
 * it is (most are the same walk as another: same size, generation and start) or its own: the generations as varint
 * steps, the shares as float64s in byte planes.
 */
export interface PackedGenealogies {
  gid: string;
  start: string;
  /** Per entry: 0, its own genealogy follows; d > 0, entry e − d's. */
  same: string;
  /** Per own genealogy: its samples. */
  n: string;
  k: string;
  h: string;
}

export function packGenealogies(g: Map<string, Genealogy>): PackedGenealogies {
  const gid: number[] = [];
  const start: number[] = [];
  const same: number[] = [];
  const n: number[] = [];
  const dk: number[] = [];
  const h: number[] = [];
  const first = new Map<string, number>();
  let e = 0;
  for (const [key, v] of g) {
    const at = key.indexOf(':');
    gid.push(Number(key.slice(0, at)));
    start.push(Number(key.slice(at + 1)));
    if (`${gid[e]}:${start[e]}` !== key) throw new Error(`genealogy key does not round-trip: ${key}`);
    // (The same walk: its samples bit for bit, generations and shares.)
    const id = `${f64ToBase64(v.k)}|${f64ToBase64(v.h)}`;
    const was = first.get(id);
    if (was !== undefined) same.push(e - was);
    else {
      first.set(id, e);
      same.push(0);
      n.push(v.k.length);
      for (let i = 0; i < v.k.length; i++) dk.push(v.k[i] - (i ? v.k[i - 1] : 0));
      for (let i = 0; i < v.h.length; i++) h.push(v.h[i]);
    }
    e++;
  }
  return { gid: uintsToBase64(gid), start: f64ToBase64(start), same: uintsToBase64(same), n: uintsToBase64(n), k: uintsToBase64(dk), h: f64PlanesToBase64(h) };
}

export function unpackGenealogies(p: PackedGenealogies): Map<string, Genealogy> {
  const gid = uintsFromBase64(p.gid);
  const start = f64FromBase64(p.start);
  const same = uintsFromBase64(p.same);
  const n = uintsFromBase64(p.n);
  const dk = uintsFromBase64(p.k);
  const h = f64PlanesFromBase64(p.h);
  const out = new Map<string, Genealogy>();
  const all: Genealogy[] = [];
  let at = 0;
  let own = 0;
  for (let e = 0; e < gid.length; e++) {
    let g: Genealogy;
    if (same[e]) g = all[e - same[e]];
    else {
      const c = n[own++];
      const k = new Float64Array(c);
      let acc = 0;
      for (let i = 0; i < c; i++) k[i] = acc += dk[at + i];
      g = { k, h: h.subarray(at, at + c) };
      at += c;
    }
    all.push(g);
    out.set(`${gid[e]}:${start[e]}`, g);
  }
  return out;
}

/**
 * A list of values in columns (the species, their histories' points...): numbers as varints (whole) or float64s, strings
 * once each in a table, objects one column per field, arrays flattened with their lengths, nulls and missing fields as
 * index lists. What JSON would carry, value for value (unpackColumns(packColumns(v)) deep-equals v, keys in their first
 * order), in a fraction of its numbers' digits and its repeated keys and strings.
 */
export type Columns =
  | { u: string } // whole numbers >= 0
  | { f: string } // any numbers
  | { b: string } // booleans
  | { s: string[]; i: string } // strings: the table and each one's index
  | { o: Record<string, Columns>; has?: Record<string, string> } // objects: per field its values (and which have it, when not all)
  | { a: string; v: Columns } // arrays: their lengths and every element
  | { nul: string; v: Columns } // some null: which, and the others
  | { j: unknown[] }; // anything else, as JSON has it

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function packColumns(vals: unknown[]): Columns {
  if (vals.some((x) => x === null)) {
    const nul: number[] = [];
    const rest: unknown[] = [];
    vals.forEach((x, i) => (x === null ? nul.push(i) : rest.push(x)));
    return { nul: uintsToBase64(nul), v: packColumns(rest) };
  }
  if (vals.every((x) => typeof x === 'number')) {
    const nums = vals as number[];
    return nums.every((x) => Number.isSafeInteger(x) && x >= 0 && !Object.is(x, -0)) ? { u: uintsToBase64(nums) } : { f: f64ToBase64(nums) };
  }
  if (vals.every((x) => typeof x === 'boolean')) return { b: uintsToBase64(vals.map((x) => (x ? 1 : 0))) };
  if (vals.every((x) => typeof x === 'string')) {
    const s: string[] = [];
    const at = new Map<string, number>();
    const i = (vals as string[]).map((x) => {
      let k = at.get(x);
      if (k === undefined) at.set(x, (k = s.push(x) - 1));
      return k;
    });
    return { s, i: uintsToBase64(i) };
  }
  if (vals.every(isObj)) {
    const rows = vals as Record<string, unknown>[];
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) for (const k in r) if (!seen.has(k)) seen.add(k), keys.push(k);
    const o: Record<string, Columns> = {};
    const has: Record<string, string> = {};
    for (const k of keys) {
      const at: number[] = [];
      const v: unknown[] = [];
      rows.forEach((r, i) => {
        if (k in r && r[k] !== undefined) at.push(i), v.push(r[k]);
      });
      o[k] = packColumns(v);
      if (at.length < rows.length) has[k] = uintsToBase64(at);
    }
    return Object.keys(has).length ? { o, has } : { o };
  }
  if (vals.every(Array.isArray)) {
    const arrs = vals as unknown[][];
    return { a: uintsToBase64(arrs.map((x) => x.length)), v: packColumns(arrs.flat()) };
  }
  return { j: vals };
}

export function unpackColumns(c: Columns, n: number): unknown[] {
  if ('nul' in c) {
    const nul = uintsFromBase64(c.nul);
    const rest = unpackColumns(c.v, n - nul.length);
    const out: unknown[] = new Array(n);
    let r = 0;
    let z = 0;
    for (let i = 0; i < n; i++) out[i] = z < nul.length && nul[z] === i ? (z++, null) : rest[r++];
    return out;
  }
  if ('u' in c) return uintsFromBase64(c.u);
  if ('f' in c) return Array.from(f64FromBase64(c.f));
  if ('b' in c) return uintsFromBase64(c.b).map((x) => x === 1);
  if ('s' in c) return uintsFromBase64(c.i).map((x) => c.s[x]);
  if ('a' in c) {
    const lens = uintsFromBase64(c.a);
    const flat = unpackColumns(c.v, lens.reduce((p, q) => p + q, 0));
    let at = 0;
    return lens.map((l) => flat.slice(at, (at += l)));
  }
  if ('o' in c) {
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < n; i++) out.push({});
    for (const k in c.o) {
      const at = c.has?.[k] !== undefined ? uintsFromBase64(c.has[k]) : null;
      const v = unpackColumns(c.o[k], at ? at.length : n);
      if (at) for (let j = 0; j < at.length; j++) out[at[j]][k] = v[j];
      else for (let i = 0; i < n; i++) out[i][k] = v[i];
    }
    return out;
  }
  return c.j;
}

/** A dated tree as mammals.json carries it (the built one, splits.ts mammaliaTree): its strings once each, its splits in preorder as numbers. */
export interface PackedTree {
  str: string[];
  /** Per split: name, ageMa, lo, hi, cite, confidence, source, taxon, note (string indices, -1 absent), the daughters' count, then each daughter: a species' string index, or -1 and that split. */
  s: number[];
}

const SPLIT_FIELDS = new Set(['name', 'ageMa', 'lo', 'hi', 'cite', 'confidence', 'source', 'taxon', 'note', 'kids']);

export function packTree(t: Split): PackedTree {
  const str: string[] = [];
  const at = new Map<string, number>();
  const ix = (v: string | undefined): number => {
    if (v === undefined) return -1;
    let i = at.get(v);
    if (i === undefined) at.set(v, (i = str.push(v) - 1));
    return i;
  };
  const s: number[] = [];
  const go = (v: Split) => {
    for (const k of Object.keys(v)) if (!SPLIT_FIELDS.has(k)) throw new Error(`packTree: a split field it does not carry: ${k}`);
    s.push(ix(v.name), v.ageMa, v.lo, v.hi, ix(v.cite), ix(v.confidence), ix(v.source), ix(v.taxon), ix(v.note), v.kids.length);
    for (const k of v.kids) {
      if (typeof k === 'string') s.push(ix(k));
      else {
        s.push(-1);
        go(k);
      }
    }
  };
  go(t);
  return { str, s };
}

export function unpackTree(p: PackedTree): Split {
  const { str, s } = p;
  let i = 0;
  const get = (): string | undefined => {
    const v = s[i++];
    return v < 0 ? undefined : str[v];
  };
  const go = (): Split => {
    const name = get()!;
    const ageMa = s[i++];
    const lo = s[i++];
    const hi = s[i++];
    const cite = get()!;
    const confidence = get() as Confidence;
    const source = get();
    const taxon = get();
    const note = get();
    const n = s[i++];
    const kids: (string | Split)[] = [];
    // (In splitFrom's field order; a note only where there is one.)
    const v: Split = { name, ageMa, lo, hi, cite, confidence, source, taxon, ...(note !== undefined ? { note } : {}), kids };
    for (let j = 0; j < n; j++) kids.push(s[i] < 0 ? (i++, go()) : get()!);
    return v;
  };
  return go();
}
