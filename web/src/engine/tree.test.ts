import { describe, expect, it } from 'vitest';
import { fmix32, hash3 } from './hash';
import { SyntheticTree, TIME_UNITS, type SynthNode } from './tree';

describe('integer hash', () => {
  it('has stable golden values', () => {
    expect(fmix32(0)).toBe(0);
    expect(fmix32(1)).toBe(0x514e28b7);
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
    expect(hash3(1, 2, 3)).not.toBe(hash3(1, 2, 4));
    // Golden: if this changes, every synthetic tree on every device changes.
    expect(hash3(0x51ed, 1, 2)).toBe(4039255557);
  });
});

describe('synthetic tree', () => {
  const tree = new SyntheticTree(1);

  function walk(n: SynthNode, depth: number, f: (n: SynthNode, kids: SynthNode[]) => void): void {
    if (depth === 0) return;
    const kids = tree.children(n);
    f(n, kids);
    for (const k of kids) walk(k, depth - 1, f);
  }

  it('is deterministic across instances', () => {
    const a = new SyntheticTree(1);
    const b = new SyntheticTree(1);
    let na = a.root();
    let nb = b.root();
    for (let d = 0; d < 300; d++) {
      const ka = a.children(na);
      const kb = b.children(nb);
      expect(ka.map((k) => k.info)).toEqual(kb.map((k) => k.info));
      na = ka[d % ka.length];
      nb = kb[d % kb.length];
    }
    expect(new SyntheticTree(2).root().info.id).not.toBe(a.root().info.id);
  });

  it('respects structural invariants', () => {
    let count = 0;
    walk(tree.root(), 7, (p, kids) => {
      count++;
      expect(kids.length).toBeGreaterThanOrEqual(2);
      expect(kids.length).toBeLessThanOrEqual(4);
      const pi = p.info;
      if (pi.alive) expect(kids.some((k) => k.info.alive)).toBe(true);
      else expect(kids.every((k) => !k.info.alive)).toBe(true);
      kids.forEach((k, i) => {
        const ki = k.info;
        expect(ki.index).toBe(i);
        expect(ki.depth).toBe(pi.depth + 1);
        expect(Number.isInteger(ki.weight) && ki.weight >= 1).toBe(true);
        expect(Number.isInteger(ki.start) && Number.isInteger(ki.end)).toBe(true);
        expect(ki.start).toBeGreaterThanOrEqual(0.1 * TIME_UNITS - 1);
        expect(ki.end).toBeGreaterThan(ki.start);
        if (ki.alive) expect(ki.end).toBe(TIME_UNITS);
        else expect(ki.end).toBeLessThanOrEqual(pi.alive ? TIME_UNITS : 0.9 * TIME_UNITS);
        if (ki.alive) expect(ki.log10A).toBeLessThan(ki.log10N);
        else expect(ki.log10A).toBe(-Infinity);
      });
      // survivors first
      const firstDead = kids.findIndex((k) => !k.info.alive);
      if (firstDead >= 0) expect(kids.slice(firstDead).every((k) => !k.info.alive)).toBe(true);
    });
    expect(count).toBeGreaterThan(100);
  });

  it('goes arbitrarily deep with unique ids along a chain', () => {
    let n = tree.root();
    const ids = new Set<string>();
    for (let d = 0; d < 3000; d++) {
      ids.add(n.info.id);
      const kids = tree.children(n);
      n = kids[(d * 7) % kids.length];
    }
    expect(n.info.depth).toBe(3000);
    expect(ids.size).toBe(3000);
  });
});
