/**
 * Determinism lint: the generation path (src/) may only use integer math, IEEE
 * basic arithmetic and correctly-rounded Math functions. Transcendentals
 * (exp/log/pow/sin/…) are not bit-identical across JS engines.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../src/', import.meta.url).pathname;

// Exactly specified by ECMAScript (correctly rounded or integer-valued).
const ALLOWED_MATH = new Set([
  'imul', 'clz32', 'floor', 'ceil', 'round', 'trunc', 'abs', 'sign', 'min', 'max', 'sqrt',
]);
const FORBIDDEN = [
  { re: /\bDate\.now\b|\bnew Date\b|\bperformance\.now\b/, why: 'clock' },
  { re: /\bcrypto\.getRandomValues\b/, why: 'random' },
  { re: /\bparseFloat\b|\.toFixed\(|\.toPrecision\(/, why: 'float formatting/parsing' },
  { re: /\*\*/, why: 'exponent operator (use shifts / literals)' },
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));

describe('determinism lint (src/)', () => {
  it('finds source files', () => {
    expect(files.length).toBeGreaterThan(5);
  });
  for (const f of files) {
    it(f, () => {
      const code = stripComments(readFileSync(join(SRC, f), 'utf8'));
      const problems: string[] = [];
      for (const m of code.matchAll(/\bMath\.(\w+)/g)) {
        if (!ALLOWED_MATH.has(m[1]!)) problems.push(`Math.${m[1]}`);
      }
      for (const { re, why } of FORBIDDEN) {
        const m = re.exec(code);
        if (m) problems.push(`${m[0]} (${why})`);
      }
      expect(problems).toEqual([]);
    });
  }
});
