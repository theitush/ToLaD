// Synthetic, infinitely deep tree of life.
//
// This is a stand-in for real data. The engine only talks to it through the
// small `TreeSource` interface, so task `river` can swap in real tiles.
//
// Determinism: the *structure* (child count, weights, start/end times,
// alive/extinct) is decided with integer hashing only. The log10 counts used
// for the log width mode and the green lane are derived floats and only
// affect presentation, never which nodes exist.

import { hash3 } from './hash';

/** Time is measured in integer units of 1/TIME_UNITS of the parent's span. */
export const TIME_UNITS = 65536;
/** Fraction of a node's own span used for its taper-in (thread → full width). */
export const TAPER_IN = 0.1;
/** Fraction of an extinct node's span used for its taper-out at the end. */
export const TAPER_OUT = 0.1;

export interface NodeInfo {
  id: string;
  depth: number;
  /** Index among its siblings (left to right). */
  index: number;
  /** Integer weight among siblings (share of individuals ever, linear mode). */
  weight: number;
  /** Start / end in the parent's span, integer units of 1/TIME_UNITS. Root: 0..TIME_UNITS. */
  start: number;
  end: number;
  /** Reaches "now" (true) or went extinct before it (false). */
  alive: boolean;
  /** log10 of individuals ever in the clade (presentation only). */
  log10N: number;
  /** log10 of individuals alive now; -Infinity if extinct (presentation only). */
  log10A: number;
}

/** The only interface the engine needs from a data source. */
export interface TreeSource<N> {
  root(): N;
  /** Children, ordered left to right. Must be deterministic and depend only on `node`. */
  children(node: N): N[];
  info(node: N): NodeInfo;
}

export interface SynthNode {
  info: NodeInfo;
  h0: number;
  h1: number;
}

const U = TIME_UNITS;
const TAPER_IN_U = Math.round(TAPER_IN * U); // 6554
const DEAD_PARENT_MAX_END = U - Math.round(TAPER_OUT * U); // children of an extinct node end before its taper-out
const ALIVE_PARENT_MAX_DEAD_END = Math.round(0.97 * U);
const MIN_LEN = Math.round(0.08 * U);
const START_RANGE = Math.round(0.3 * U); // child starts in [0.1, 0.4) of the parent span

export class SyntheticTree implements TreeSource<SynthNode> {
  private readonly rootNode: SynthNode;

  constructor(readonly seed = 1) {
    const h0 = hash3(seed, 0x51ed, 1);
    const h1 = hash3(seed, 0x51ed, 2);
    this.rootNode = {
      h0,
      h1,
      info: {
        id: makeId(0, h0, h1),
        depth: 0,
        index: 0,
        weight: 1,
        start: 0,
        end: U,
        alive: true,
        log10N: 40, // ~all cells that ever lived
        log10A: 30, // ~alive now
      },
    };
  }

  root(): SynthNode {
    return this.rootNode;
  }

  info(node: SynthNode): NodeInfo {
    return node.info;
  }

  children(p: SynthNode): SynthNode[] {
    const pi = p.info;
    const r = hash3(p.h0, p.h1, 0);
    const k = 2 + (r % 3); // 2..4 children
    const forcedAlive = (r >>> 8) % k;

    type Raw = { h0: number; h1: number; weight: number; start: number; end: number; alive: boolean; q: number };
    const raw: Raw[] = [];
    for (let i = 0; i < k; i++) {
      const c0 = hash3(p.h0, p.h1, i + 1);
      const c1 = hash3(p.h1, c0, i + 101);
      const wr = c0 % 1000;
      const weight = 1 + Math.floor((wr * wr) / 1000); // 1..999, skewed small
      const alive = pi.alive && (i === forcedAlive || (c1 & 1) === 1);
      const start = TAPER_IN_U + ((c1 >>> 8) % START_RANGE);
      let end: number;
      if (alive) {
        end = U;
      } else {
        const maxEnd = pi.alive ? ALIVE_PARENT_MAX_DEAD_END : DEAD_PARENT_MAX_END;
        end = start + MIN_LEN + ((c0 >>> 12) % (maxEnd - start - MIN_LEN));
      }
      const q = 300 + ((c1 >>> 20) % 700); // alive-retention factor in permille
      raw.push({ h0: c0, h1: c1, weight, start, end, alive, q });
    }
    // Survivors on the left (so green lanes roughly continue), extinct on the
    // right ordered by start time. Stable integer ordering.
    raw.sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.start !== b.start) return a.start - b.start;
      return a.h0 - b.h0;
    });

    let sumW = 0;
    let sumAliveW = 0;
    for (const c of raw) {
      sumW += c.weight;
      if (c.alive) sumAliveW += c.weight;
    }
    const depth = pi.depth + 1;
    return raw.map((c, index) => {
      const log10N = pi.log10N + Math.log10(c.weight / sumW);
      let log10A = -Infinity;
      if (c.alive) {
        log10A = pi.log10A + Math.log10((c.weight / sumAliveW) * (c.q / 1000) * 1.5);
        log10A = Math.min(log10A, log10N + Math.log10(0.95));
      }
      return {
        h0: c.h0,
        h1: c.h1,
        info: { id: makeId(depth, c.h0, c.h1), depth, index, weight: c.weight, start: c.start, end: c.end, alive: c.alive, log10N, log10A },
      };
    });
  }
}

function makeId(depth: number, h0: number, h1: number): string {
  return `${depth}.${h0.toString(36)}.${h1.toString(36)}`;
}
