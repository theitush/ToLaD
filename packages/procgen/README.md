# @tolad/procgen

Deterministic, stateless procedural individuals for ToLaD. Given a species and an
address, every device computes the same individual, the same parents, the same
children and the same public ID, forever, with nothing stored.

Design: `research/04-layout-and-mesh.md` §5–6 and `research/03-rendering.md` §4.1.
No runtime dependencies. ESM, TypeScript source (`exports` points at `src/index.ts`).

## API

```ts
import { Species, EXAMPLE_SPECIES, HASH_GLSL, parseHandle } from '@tolad/procgen';

const human = new Species({
  key: 'human',
  sexual: true,
  segments: [                       // births per generation, piecewise linear
    { generations: 11000, startSize: 10_000, endSize: 1_000_000 },
    { generations: 400, startSize: 1_000_000, endSize: 300_000_000 },
    // ...
  ],
  generationYears: 25,
  lifespanYears: 40,
  // optional: seed, now, window (64), migrantRate (1/256), splitBlock (64),
  //           familyConcentration (beta-binomial), demes (hook)
});

const a = { generation: 5707, index: 174054n };   // address (g, i)
human.ordinal(a);            // global serial k = C(g) + i           (bigint)
human.address(k);            // k → (g, i), binary search
human.idOf(a);               // public ID P(k)                       (bigint)
human.handle(a);             // "human#9631999900"
human.addressOfHandle('human#9631999900');
human.parents(a);            // [mother, father]  ([parent] if asexual, [] at g = 0)
human.children(a);           // { generation: g+1, start, count }  contiguous range
human.partner(a);            // other member of the couple, or null
human.attributes(a);         // { sex, birthTime, lifespan, deathTime, alive }
human.fieldHash(a, 16);      // extra deterministic uint32 per individual (fields ≥ 16 are free)
human.size(g); human.cumulative(g); human.totalEver; human.generations;
```

Indices, ordinals and IDs are `bigint` everywhere (totals reach ~10^40);
generations are `number` (always < 2^53). Low-level pieces are exported too:
`lowbias32 / mix / hash2 / hash3 / rand / randFloat / hashBig`, `makePermutation`,
`splitCount`, `normalFromU32`, `PopulationModel`.

`HASH_GLSL` is the same hash as a GLSL ES 3.00 source string (`lowbias32`, `mixh`,
`hash2`, `hash3`, `rand`, `randFloat`); `mix` is a GLSL builtin, hence `mixh`.

## Determinism rules

- The generation path (`src/`) uses only integer math (`Math.imul`, bit ops,
  `BigInt`) and IEEE basic arithmetic plus `Math.sqrt`, `Math.floor` and the other
  exactly-specified `Math` functions. **No `Math.exp/log/pow/sin/cos/…`, no `**`,
  no clocks, no `Math.random`.** `test/lint.test.ts` enforces this by scanning `src/`.
- Floats appear only where every operation is correctly rounded (e.g. σ = √(npq),
  birth time = (g + u)·generationYears), so results are bit-identical across engines.
- The inverse normal CDF is an **integer table** (`src/normal-table.ts`) generated
  offline by `scripts/gen-normal-table.ts`; the committed integers are the truth.
- Seed tags and field counters in `species.ts` are frozen: changing one changes
  every individual. `test/golden.json` pins hashes, permutations, counts, IDs,
  parents, children and attributes; regenerate it (`npm run golden:update`) only
  for an intentional breaking change.

## Algorithms

**Hash / RNG.** `lowbias32` (Wellons) is a 2-multiply uint32 avalanche mixer.
`mix(h, v) = lowbias32(h ^ lowbias32(v + 0x9e3779b9))` folds a word into a state;
`rand(seed, counter) = mix(seed, counter)` is a counter-based RNG (any draw is
O(1)). BigInts are hashed as little-endian 32-bit limbs.

**Population.** Births ramp linearly inside each segment. The cumulative count is
defined first, `C(g0+t) = C0 + ⌊(2LAt + (B−A)t²) / 2L⌋` (floor of the exact
integral), so `N(g) = C(g+1) − C(g)` is exact and `N(g) ≥ min(A, B)`.
`generationOf(k)` binary-searches the segment prefix table, then the segment.

**Public IDs.** A keyed balanced Feistel network (6 rounds) over the smallest even
bit width covering `[0, totalEver)`, with cycle-walking back into the domain
(< 4 expected walks). Number engine up to 2^52, BigInt engine above. Bijective and
invertible: `decodeId(encodeId(k)) === k`. Keyed per species.

**Pedigree** (generation h = g−1 of size M → generation g of size N):

1. *Arrangement.* Individual `i` of h gets a mating slot `X_h(L_h(i))`.
   `L_h` is a brick-wall local shuffle: a small Feistel inside windows of width W,
   the window offset alternating with the parity of h (1-D stepping stone).
   `X_h` adds rare long-range migrants: a global Feistel `P_h` marks ⌊ε·M⌋ slots as
   migrant slots, which are rotated among themselves by a keyed shift.
   Couple j = slots (2j, 2j+1) (sexual; slot parity = sex, so every couple is F+M;
   an odd leftover slot is childless), or slot j (asexual).
2. *Births.* A balanced binary split tree over the K couples distributes the N
   births. Nodes with more than `splitBlock` couples split proportionally with
   dithered rounding `⌊n·kL/k + U⌋` (no √N random-walk drift, so children stay
   above their parents); smaller nodes split binomially (or beta-binomially), so
   family sizes are multinomial within each block. Couple j's children are the
   contiguous range `[prefix_j, prefix_j + c_j)` of generation g.
3. `parents(child)` walks the tree comparing the child index with the left count at
   each node; `children(couple)` walks to leaf j summing left counts. Both are one
   root-to-leaf path: O(log K) hash + binomial draws, nothing stored.

**Binomial sampling** (`splitCount`). n ≤ 64: exact (n Bernoulli trials, each one
hash compared against p·2^32). n > 64: normal approximation with continuity
correction; the mean `⌊n·num/den⌋` and its fraction are exact BigInt, z comes from
the integer inverse-CDF table (1024 buckets, linear interpolation, tails clamped at
|z| ≈ 6.3), σ = `Math.sqrt(n·p·q)`, clamped to [0, n]. With p ≈ ½ and n > 64,
npq > 16, where the approximation is good. *Beta-binomial:* with a Dirichlet
concentration α, each node first perturbs p to p' ~ Beta(α·kL, α·kR) (normal
approximation, variance pq/(αk+1), clamped); splitting with these node betas is a
Dirichlet-multinomial over the couples.

**Locality vs convergence.** Measured on a constant population of 4096: an
individual's ancestor cone covers 75% of a generation after ~28 generations with
ε = 1/256 (≈ 2.3·log2 N), versus ~74 with ε = 0. For humans (10,000 sampled
edges), the child–parent distance in index space has median 19, p90 45, p99 61
slots; 0.47% of edges are longer than 256 slots (the migrant couples, ≈ ε).

**Attributes.** `sex` from slot parity; `birthTime = (g + u)·generationYears`
(cosmetic jitter inside the generation); `lifespan = lifespanYears·(u1 + u2)`
(triangular on [0, 2·mean]); `alive ⇔ birthTime ≤ now < birthTime + lifespan`.
`now` defaults to the end of the last generation.

**Hooks.** `demes: DemeStructure` partitions a generation into contiguous demes; the
local shuffle never crosses a deme boundary. Real demographic models (Demes /
stdpopsim, migration between neighbouring demes) are a later task. An overlay of
real/mock individuals (research/04 §6.4) would be checked before these functions.

## Tests and tools

```sh
npm test               # Node project + Chromium project (Vitest browser mode, Playwright)
npm run test:node
npm run test:browser   # golden + property + GLSL readback in headless Chromium/Firefox
npm run typecheck
npm run bench          # parent / children / ID lookup timings
```

- `test/golden.test.ts`: fixed inputs → `test/golden.json`, run in every engine.
- `test/pedigree.test.ts`, `population.test.ts`, `feistel.test.ts`: property tests
  (exhaustive on small species, sampled on 10^11 / 10^30 species).
- `test/glsl.browser.test.ts`: compiles `HASH_GLSL` in WebGL2, evaluates it with
  transform feedback for 3×65536 inputs and compares with the TS hash and the fixture.
- `test/lint.test.ts`: the determinism lint.

Benchmark (Node 22, one core of a WSL2 laptop, 1000 random individuals):

| species | total ever | parents | children | attributes | addressOfId |
|---|---|---|---|---|---|
| human (sexual) | 1.0e11 | 34 µs | 24 µs | 4 µs | 2 µs |
| bigsexual (sexual) | 1e30 | 73 µs | 65 µs | 27 µs | 22 µs |
| microbe (asexual) | 1e30 | 86 µs | 84 µs | 2 µs | 10 µs |

Everything is BigInt on the walk; a Number or WASM `u128` fast path is the obvious
next step if per-frame CPU lookups ever need to be faster.
