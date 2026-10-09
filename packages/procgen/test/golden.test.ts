import { describe, expect, it } from 'vitest';
import fixture from './golden.json';
import { computeGolden } from './golden-cases.ts';

describe('golden values (fixed inputs → fixed outputs)', () => {
  const got = computeGolden();
  for (const key of Object.keys(fixture)) {
    it(key, () => {
      expect(got[key]).toEqual((fixture as Record<string, unknown>)[key]);
    });
  }
  it('fixture covers every computed key', () => {
    expect(Object.keys(got).sort()).toEqual(Object.keys(fixture).sort());
  });
});
