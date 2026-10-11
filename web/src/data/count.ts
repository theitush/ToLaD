// The one way the app writes a population count (ToLaD#96): approximately,
// with only the digits it means. "~7k", "~1.4k", "~230k", "~1.3 trillion".
//
// Rounding: two significant figures when the leading digit is 1 or 2, one
// otherwise (so the shown figure is never more than ~25% off, and never
// carries a digit the model or survey cannot vouch for). Small cited counts
// stay exact ("37" red wolves, "66" wisent in 1924), and values that are
// round by construction (the scale bar's 1, 2 or 5 × 10^k, axis ticks) are
// written as they are, without the "~".

export interface CountStyle {
  /** The value is exact (a scale-bar step, an axis tick): no rounding, no "~". */
  exact?: boolean;
  /** A cited figure: under 1,000 it is shown exactly (a census of 37 is 37). */
  cited?: boolean;
  /** Prefix "~" when rounded (default true; false where the sentence already says "roughly"). */
  tilde?: boolean;
  /** Axis-tick units: k, M, B, T instead of words. */
  short?: boolean;
}

/** `n` to the digits a count means: 2 significant figures when the leading digit is 1 or 2, else 1. */
export function meaningful(n: number): number {
  if (!(n > 0)) return 0;
  const lead = n / Math.pow(10, Math.floor(Math.log10(n)));
  return Number(n.toPrecision(lead < 3 ? 2 : 1));
}

const WORDS: [number, string, string][] = [
  [1e12, ' trillion', 'T'],
  [1e9, ' billion', 'B'],
  [1e6, ' million', 'M'],
  [1e3, 'k', 'k'],
];

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const num = (v: number) => Number(v.toPrecision(12)).toLocaleString('en-US', { maximumFractionDigits: 3 });

/** A population count: "~7k", "~230k", "~1.3 trillion"; exact styles "37", "50k", "2 million". */
export function formatCount(n: number, style: CountStyle = {}): string {
  if (!(n > 0)) return '0';
  const exact = style.exact || (style.cited && n < 1000);
  if (!exact && n < 0.5) return 'under 1';
  const r = exact ? n : meaningful(n);
  const pre = exact || style.tilde === false ? '' : '~';
  // Exact small values keep every digit ("3,890"); above 10,000 they take units too.
  if (r < (exact && !style.short ? 1e4 : 1e3)) return pre + Math.round(r).toLocaleString('en-US');
  if (r >= 1e15) {
    const e = Math.floor(Math.log10(r));
    const m = num(r / Math.pow(10, e));
    return `${pre}${m} × 10${String(e)
      .split('')
      .map((d) => SUP[Number(d)])
      .join('')}`;
  }
  for (const [v, word, short] of WORDS) if (r >= v) return `${pre}${num(r / v)}${style.short ? short : word}`;
  return pre + num(r);
}

/**
 * Round the counts written into a sentence (the pipeline's card notes print
 * "150,002"): every comma-grouped number becomes formatCount's figure.
 * Years ("11,700 years ago", "1,500 BCE") are left as they are.
 */
export function approxCountsIn(text: string): string {
  return text.replace(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,]|\.\d|\s*(?:yr|years?|y\b|BCE|CE|BC|AD|kya|Mya|ya)\b)/g, (m, at: number, all: string) => {
    // ("about ~3,000" in a note: one tilde, not two)
    const f = formatCount(Number(m.replace(/,/g, '')));
    return all[at - 1] === '~' ? f.replace(/^~/, '') : f;
  });
}
