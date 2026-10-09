import type { SpeciesSpec } from './species.ts';

/**
 * Example species used by tests, golden fixtures and benchmarks. These are
 * illustrative profiles, NOT the modelled counts of the data pipeline.
 */
export const EXAMPLE_SPECIES = {
  /** Small sexual population, for exhaustive property tests. */
  tiny: {
    key: 'tiny',
    sexual: true,
    segments: [
      { generations: 12, startSize: 40, endSize: 120 },
      { generations: 8, startSize: 120, endSize: 30 },
    ],
    generationYears: 2,
    lifespanYears: 3,
    window: 8,
    migrantRate: 1 / 16,
    splitBlock: 8,
  },
  /** Small asexual population. */
  clone: {
    key: 'clone',
    sexual: false,
    segments: [{ generations: 30, startSize: 10, endSize: 50 }],
    generationYears: 1,
    lifespanYears: 1,
    window: 4,
    migrantRate: 1 / 8,
    splitBlock: 4,
  },
  /** Sweepstakes reproducer: overdispersed family sizes. */
  cod: {
    key: 'cod',
    sexual: true,
    segments: [{ generations: 10, startSize: 400 }],
    generationYears: 5,
    lifespanYears: 8,
    familyConcentration: 0.2,
  },
  /** Humans, ~1.0e11 ever born over ~11.4k generations of 25 years. */
  human: {
    key: 'human',
    sexual: true,
    segments: [
      { generations: 11000, startSize: 10_000, endSize: 1_000_000 },
      { generations: 400, startSize: 1_000_000, endSize: 300_000_000 },
      { generations: 12, startSize: 300_000_000, endSize: 3_500_000_000 },
      { generations: 4, startSize: 3_500_000_000 },
    ],
    generationYears: 25,
    lifespanYears: 40,
  },
  /** Asexual microbe, 10^30 ever: 10^10 generations of 10^20. */
  microbe: {
    key: 'microbe',
    sexual: false,
    segments: [{ generations: 10_000_000_000, startSize: 100_000_000_000_000_000_000n }],
    generationYears: 0.01,
    lifespanYears: 0.01,
  },
  /** Sexual species with 10^30 ever: 10^9 generations of 10^21. */
  bigsexual: {
    key: 'bigsexual',
    sexual: true,
    segments: [{ generations: 1_000_000_000, startSize: 1_000_000_000_000_000_000_000n }],
    generationYears: 1,
    lifespanYears: 1,
  },
} satisfies Record<string, SpeciesSpec>;
