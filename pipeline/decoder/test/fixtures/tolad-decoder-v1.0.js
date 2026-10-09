// ToLaD tile decoder, format version 1 (see pipeline/FORMAT.md).
// No dependencies; works in browsers, Web Workers and Node 18+.
//
//   import { decodeFile } from './tolad-decoder.js';
//   const sk = decodeFile(arrayBuffer);          // skeleton.tld
//   sk.meta.tiles                                // tile manifest
//   sk.name(0), sk.ever(0), sk.profile(0) ...    // per-row accessors
//
// All per-row columns are exposed as typed arrays (zero-copy views) in
// `file.col`; the accessor methods dequantize one row at a time.

export const FORMAT_VERSION = 1;
export const KIND_SKELETON = 0;
export const KIND_TILE = 1;

export const Q = Object.freeze({
  AGE_STEPS_PER_DEX: 6000,
  AGE_MIN_LOG10: -6,
  LOG16_STEPS_PER_DEX: 1000,
  LOG16_MIN_LOG10: -8,
  LOHI_STEPS_PER_DEX: 20,
  PROFILE_STEPS_PER_DEX: 20,
  PROFILE_K: 16,
  PROFILE_RANGE: 1000,
});

export const FLAG = Object.freeze({
  GRADE_MASK: 0x3,
  EXTINCT: 1 << 2,
  TAXONOMIC: 1 << 3,
  DATE_SHIFT: 4,
  SPECIES: 1 << 6,
  STUB: 1 << 7,
  ANCHORED: 1 << 8,
  GRAFT: 1 << 9,
  GROUP: 1 << 10,
});

export const GRADES = ['A', 'B', 'C', 'D'];
export const DATE_SOURCES = ['upham-calibrated', 'interpolated', 'fossil-range', 'anchored'];

export function dqAge(q) {
  return q === 0 ? 0 : Math.pow(10, (q - 1) / Q.AGE_STEPS_PER_DEX + Q.AGE_MIN_LOG10);
}

export function dqLog16(q) {
  return q === 0 ? 0 : Math.pow(10, (q - 1) / Q.LOG16_STEPS_PER_DEX + Q.LOG16_MIN_LOG10);
}

/** Bin edges (ages, Ma) of a node's births-rate profile; edge 0 = t1 (young end). */
export function profileEdges(t0, t1) {
  const k = Q.PROFILE_K;
  const r = Q.PROFILE_RANGE;
  const out = new Float64Array(k + 1);
  for (let i = 0; i <= k; i++) out[i] = t1 + (t0 - t1) * (Math.pow(r, i / k) - 1) / (r - 1);
  return out;
}

const TYPES = {
  CHLD: Uint16Array, T0__: Uint16Array, T1__: Uint16Array, EVER: Uint16Array,
  ALIV: Uint16Array, GHST: Uint16Array, LOHI: Uint8Array, FLAG: Uint16Array,
  METH: Uint16Array, SRCM: Uint16Array, PPK_: Uint16Array, PROF: Uint8Array,
  NTIP: Uint32Array, GID_: Uint32Array, OTT_: Uint32Array, PBDB: Uint32Array,
  STUB: Uint32Array,
};

function fourcc(u32) {
  return String.fromCharCode(u32 & 255, (u32 >>> 8) & 255, (u32 >>> 16) & 255, u32 >>> 24);
}

/**
 * Decode one .tld file (skeleton or tile).
 * @param {ArrayBuffer|ArrayBufferView} input
 */
export function decodeFile(input) {
  let buf;
  if (input instanceof ArrayBuffer) buf = input;
  else if (ArrayBuffer.isView(input)) {
    // typed-array views need an 8-byte aligned base; copy if needed
    buf = input.byteOffset % 8 === 0 && input.byteLength === input.buffer.byteLength
      ? input.buffer
      : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  } else throw new TypeError('decodeFile: expected ArrayBuffer or view');
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'TLAD') throw new Error(`bad magic ${magic}`);
  const version = dv.getUint16(4, true);
  if (version !== FORMAT_VERSION) throw new Error(`unsupported format version ${version}`);
  const kind = dv.getUint16(6, true);
  const n = dv.getUint32(8, true);
  const nsec = dv.getUint32(12, true);
  const col = {};
  let meta = null;
  let nameOffsets = null;
  let nameBytes = null;
  for (let s = 0; s < nsec; s++) {
    const base = 16 + 16 * s;
    const id = fourcc(dv.getUint32(base, true));
    const off = dv.getUint32(base + 4, true);
    const len = dv.getUint32(base + 8, true);
    const count = dv.getUint32(base + 12, true);
    if (id === 'META') {
      meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off, len)));
    } else if (id === 'NAME') {
      nameOffsets = new Uint32Array(buf, off, count + 1);
      nameBytes = new Uint8Array(buf, off + 4 * (count + 1), len - 4 * (count + 1));
    } else if (TYPES[id]) {
      const T = TYPES[id];
      col[id] = new T(buf, off, len / T.BYTES_PER_ELEMENT);
    }
  }
  return new TileFile(kind, n, col, meta, nameOffsets, nameBytes);
}

export class TileFile {
  constructor(kind, n, col, meta, nameOffsets, nameBytes) {
    this.kind = kind;
    this.n = n;
    this.col = col;
    this.meta = meta;
    this._no = nameOffsets;
    this._nb = nameBytes;
    this._td = new TextDecoder();
    // parent index from preorder child counts
    const parent = new Int32Array(n);
    const stack = [];
    const left = [];
    for (let i = 0; i < n; i++) {
      while (stack.length && left[left.length - 1] === 0) { stack.pop(); left.pop(); }
      parent[i] = stack.length ? stack[stack.length - 1] : -1;
      if (stack.length) left[left.length - 1]--;
      const c = col.CHLD[i];
      if (c > 0) { stack.push(i); left.push(c); }
    }
    this.parent = parent;
    // stub index -> tile id, and representative names
    this.stubs = new Map();
    const st = col.STUB || new Uint32Array(0);
    const reps = (meta && meta.stub_rep) || [];
    for (let j = 0; j * 2 < st.length; j++) this.stubs.set(st[2 * j], { tile: st[2 * j + 1], rep: reps[j] });
  }

  names(i) {
    if (!this._no) return [''];
    return this._td.decode(this._nb.subarray(this._no[i], this._no[i + 1])).split('|');
  }
  name(i) { return this.names(i)[0]; }
  t0(i) { return dqAge(this.col.T0__[i]); }
  t1(i) { return dqAge(this.col.T1__[i]); }
  ever(i) { return dqLog16(this.col.EVER[i]); }
  alive(i) { return dqLog16(this.col.ALIV[i]); }
  ghost(i) { return dqLog16(this.col.GHST[i]); }
  aliveFraction(i) { const e = this.ever(i); return e > 0 ? this.alive(i) / e : 0; }
  everLo(i) { return this.ever(i) / Math.pow(10, this.col.LOHI[2 * i] / Q.LOHI_STEPS_PER_DEX); }
  everHi(i) { return this.ever(i) * Math.pow(10, this.col.LOHI[2 * i + 1] / Q.LOHI_STEPS_PER_DEX); }
  flags(i) { return this.col.FLAG[i]; }
  grade(i) { return GRADES[this.col.FLAG[i] & FLAG.GRADE_MASK]; }
  extinct(i) { return (this.col.FLAG[i] & FLAG.EXTINCT) !== 0; }
  taxonomic(i) { return (this.col.FLAG[i] & FLAG.TAXONOMIC) !== 0; }
  dateSource(i) { return DATE_SOURCES[(this.col.FLAG[i] >> FLAG.DATE_SHIFT) & 3]; }
  isSpecies(i) { return (this.col.FLAG[i] & FLAG.SPECIES) !== 0; }
  isStub(i) { return (this.col.FLAG[i] & FLAG.STUB) !== 0; }
  gid(i) { return this.col.GID_[i]; }
  ntips(i) { return this.col.NTIP[i]; }
  ott(i) { return this.col.OTT_[i] || null; }
  pbdb(i) { return this.col.PBDB[i] || null; }
  methodIndex(i) { return this.col.METH[i]; }
  sourceMask(i) { return this.col.SRCM[i]; }
  /** Representative name for a stub (unloaded subtree) or an unnamed node. */
  representative(i) {
    const s = this.stubs.get(i);
    if (s && s.rep) return s.rep;
    return this.name(i);
  }
  /** Mean births/yr in each profile bin (bin 0 = youngest), see profileEdges(). */
  profile(i) {
    const k = Q.PROFILE_K;
    const peak = dqLog16(this.col.PPK_[i]);
    const out = new Float64Array(k);
    for (let j = 0; j < k; j++) {
      const q = this.col.PROF[i * k + j];
      out[j] = q === 255 ? 0 : peak * Math.pow(10, -q / Q.PROFILE_STEPS_PER_DEX);
    }
    return out;
  }
  children(i) {
    const out = [];
    const c = this.col.CHLD[i];
    let j = i + 1;
    for (let k = 0; k < c; k++) {
      out.push(j);
      j = this.subtreeEnd(j);
    }
    return out;
  }
  /** Index one past the last row of the subtree rooted at row i. */
  subtreeEnd(i) {
    let need = 1;
    let j = i;
    while (need > 0) { need += this.col.CHLD[j] - 1; j++; }
    return j;
  }
}

/** Resolve method / source labels for a row using the skeleton META tables. */
export function describe(skeletonMeta, file, i) {
  const mask = file.sourceMask(i);
  const sources = [];
  skeletonMeta.sources.forEach((s, b) => { if (mask & (1 << b)) sources.push(s.key); });
  return {
    name: file.name(i),
    alt: file.names(i).slice(1),
    method: skeletonMeta.methods[file.methodIndex(i)],
    sources,
    grade: file.grade(i),
    dateSource: file.dateSource(i),
  };
}
