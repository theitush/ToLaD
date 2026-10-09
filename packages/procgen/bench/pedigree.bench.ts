/**
 * Micro-benchmark: parent / children / ID lookups on huge species.
 * Run: `npm run bench` (Node ≥ 22.18, native TS type stripping).
 */
import { EXAMPLE_SPECIES } from '../src/examples.ts';
import { rand } from '../src/hash.ts';
import { Species, type Address } from '../src/species.ts';

function sample(s: Species, n: number): Address[] {
  const out: Address[] = [];
  for (let t = 0; t < n; t++) {
    const g = 1 + Math.floor((rand(11, t) / 4294967296) * (s.generations - 2));
    const N = s.size(g);
    const i = ((BigInt(rand(12, t)) << 64n) | (BigInt(rand(13, t)) << 32n) | BigInt(rand(14, t))) % N;
    out.push({ generation: g, index: i });
  }
  return out;
}

function time(label: string, xs: Address[], f: (a: Address) => unknown): number {
  for (let r = 0; r < 2; r++) for (const a of xs) f(a); // warm-up
  const reps = 3;
  const t0 = performance.now();
  for (let r = 0; r < reps; r++) for (const a of xs) f(a);
  const us = ((performance.now() - t0) * 1000) / (reps * xs.length);
  console.log(`  ${label.padEnd(22)} ${us.toFixed(1).padStart(7)} µs`);
  return us;
}

for (const name of ['human', 'bigsexual', 'microbe'] as const) {
  const s = new Species(EXAMPLE_SPECIES[name]);
  const xs = sample(s, 1000);
  const ks = xs.map((a) => s.ordinal(a));
  const ids = ks.map((k) => s.encodeId(k));
  console.log(
    `${name}: total ever ${s.totalEver.toString()} (~1e${s.totalEver.toString().length - 1}), ` +
      `${s.generations} generations, ${s.sexual ? 'sexual' : 'asexual'}`,
  );
  time('parents(addr)', xs, (a) => s.parents(a));
  time('children(addr)', xs, (a) => s.children(a));
  time('attributes(addr)', xs, (a) => s.attributes(a));
  let j = 0;
  time('encodeId(ordinal)', xs, () => s.encodeId(ks[j++ % ks.length]!));
  j = 0;
  time('addressOfId(id)', xs, () => s.addressOfId(ids[j++ % ids.length]!));
}
