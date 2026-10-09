/**
 * Fixed inputs → outputs. `computeGolden()` is compared against the committed
 * fixture test/golden.json in Node and in Chromium. Regenerate the fixture ONLY
 * for an intentional, breaking change: `npm run golden:update`.
 */
import { EXAMPLE_SPECIES } from '../src/examples.ts';
import { normalFromU32 } from '../src/binomial.ts';
import { hashBig, hashString, lowbias32, mix, rand, randFloat } from '../src/hash.ts';
import { makePermutation } from '../src/feistel.ts';
import { Species, type Address } from '../src/species.ts';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const addr = (a: Address): Json => [a.generation, a.index.toString()];

export const HASH_INPUTS = [0, 1, 2, 3, 42, 255, 256, 65535, 65536, 0x7fffffff, 0x80000000, 0xdeadbeef, 0xffffffff];

export function computeGolden(): Record<string, Json> {
  const out: Record<string, Json> = {};

  out.lowbias32 = HASH_INPUTS.map((x) => lowbias32(x));
  out.mix = HASH_INPUTS.map((x) => mix(x, 0x12345678));
  out.rand = HASH_INPUTS.map((x) => rand(0xc0ffee, x));
  out.randFloat = HASH_INPUTS.map((x) => randFloat(7, x));
  out.hashBig = ['0', '1', '4294967295', '4294967296', '123456789012345678901234567890'].map((s) => hashBig(99, BigInt(s)));
  out.hashString = ['', 'human', 'cat', 'Escherichia_coli'].map((s) => hashString(s));
  out.normal = [0, 1, 0x3fffff, 0x7fffffff, 0x80000000, 0xc0000000, 0xffffffff].map((u) => normalFromU32(u));

  const perms: Json[] = [];
  for (const [domain, key] of [
    [10n, 1],
    [1000n, 2],
    [102555000000n, 3],
    [10n ** 30n, 4],
    [(1n << 133n) + 12345n, 5],
  ] as const) {
    const p = makePermutation(domain, key);
    const xs = [0n, 1n, domain / 3n, domain - 1n];
    perms.push({ domain: domain.toString(), fwd: xs.map((x) => p.forward(x).toString()) });
  }
  out.feistel = perms;

  const species: Record<string, Json> = {};
  for (const [name, spec] of Object.entries(EXAMPLE_SPECIES)) {
    const s = new Species(spec);
    const G = s.generations;
    const gens = [0, 1, Math.floor(G / 2), G - 2, G - 1];
    const cases: Json[] = [];
    for (const g of gens) {
      const N = s.size(g);
      for (const i of [0n, N / 2n, N - 1n]) {
        const a = { generation: g, index: i };
        const at = s.attributes(a);
        const ch = s.children(a);
        cases.push({
          addr: addr(a),
          ordinal: s.ordinal(a).toString(),
          handle: s.handle(a),
          slot: s.slotOf(a).toString(),
          parents: s.parents(a).map(addr),
          children: [ch.generation, ch.start.toString(), ch.count.toString()],
          sex: at.sex,
          birthTime: at.birthTime,
          lifespan: at.lifespan,
          alive: at.alive,
        });
      }
    }
    const T = s.totalEver;
    species[name] = {
      totalEver: T.toString(),
      generations: G,
      sizes: gens.map((g) => s.size(g).toString()),
      generationOf: [0n, T / 7n, T / 2n, T - 1n].map((k) => s.population.generationOf(k)),
      decodeId: [0n, 1n, T / 5n, T - 1n].map((id) => s.decodeId(id).toString()),
      cases,
    };
  }
  out.species = species;
  return out;
}
