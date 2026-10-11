import { describe, expect, it } from 'vitest';
import { approxCountsIn, formatCount, meaningful } from './count';

describe('formatCount: a population count with only the digits it means (ToLaD#96)', () => {
  it('rounds to one significant figure, two when the leading digit is 1 or 2, with a "~"', () => {
    expect(formatCount(6750)).toBe('~7k');
    expect(formatCount(1360)).toBe('~1.4k');
    expect(formatCount(232000)).toBe('~230k');
    expect(formatCount(1.29e12)).toBe('~1.3 trillion');
    expect(formatCount(6.28e11)).toBe('~600 billion');
    expect(formatCount(1.4e11)).toBe('~140 billion');
    expect(formatCount(2.4e11)).toBe('~240 billion');
    expect(formatCount(5.81e9)).toBe('~6 billion');
    expect(formatCount(150002)).toBe('~150k');
    expect(formatCount(390000)).toBe('~400k');
    expect(formatCount(3.4e6)).toBe('~3 million');
    expect(formatCount(37.4)).toBe('~40');
    expect(formatCount(4.2)).toBe('~4');
  });

  it('picks the unit after rounding: 999,600 is ~1 million, not ~1,000k', () => {
    expect(formatCount(999600)).toBe('~1 million');
    expect(formatCount(996)).toBe('~1k');
  });

  it('never shows more digits than it means', () => {
    for (let e = 0; e < 15; e += 0.37) {
      const n = Math.pow(10, e) * 1.2345;
      const digits = formatCount(n).replace(/[^\d]/g, '').replace(/0+$/, '');
      expect(digits.length, `${n}: ${formatCount(n)}`).toBeLessThanOrEqual(2);
      expect(Math.abs(meaningful(n) - n) / n).toBeLessThanOrEqual(0.26);
    }
  });

  it('keeps small cited counts exact, and round values (scale bar, ticks) as they are', () => {
    expect(formatCount(37, { cited: true })).toBe('37');
    expect(formatCount(66, { cited: true })).toBe('66');
    expect(formatCount(3890, { cited: true })).toBe('~4k');
    expect(formatCount(50000, { exact: true })).toBe('50k');
    expect(formatCount(2e6, { exact: true })).toBe('2 million');
    expect(formatCount(1, { exact: true })).toBe('1');
    expect(formatCount(1e4, { exact: true, short: true })).toBe('10k');
    expect(formatCount(1e6, { exact: true, short: true })).toBe('1M');
    expect(formatCount(500, { exact: true, short: true })).toBe('500');
  });

  it('drops the "~" where the sentence already says "roughly"', () => {
    expect(formatCount(2.4e11, { tilde: false })).toBe('240 billion');
  });

  it('writes huge counts as a power of ten', () => {
    expect(formatCount(3.4e18)).toBe('~3 × 10¹⁸');
  });

  it('handles nothing and less than one', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(NaN)).toBe('0');
    expect(formatCount(0.2)).toBe('under 1');
  });
});

describe('approxCountsIn: the counts inside a pipeline sentence', () => {
  it('rounds comma-grouped counts and leaves years and small numbers alone', () => {
    expect(approxCountsIn('the modelled natural (pre-human) level (150,002) is below it')).toBe('the modelled natural (pre-human) level (~150k) is below it');
    expect(approxCountsIn('2015 census, 3,890; 1,234,567 born')).toBe('2015 census, ~4k; ~1.2 million born');
    expect(approxCountsIn('held from 11,700 years ago; 1924 census, 66')).toBe('held from 11,700 years ago; 1924 census, 66');
  });

  it('keeps one tilde where a note already says "~" before a count', () => {
    expect(approxCountsIn("CatSG dates the ~3,200 in-situ estimate to 2009")).toBe('CatSG dates the ~3k in-situ estimate to 2009');
  });
});
