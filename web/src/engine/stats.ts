/** Rolling frame-time statistics (ms). */
export class RollingStats {
  private buf: Float64Array;
  private n = 0;
  private i = 0;
  constructor(size = 120) {
    this.buf = new Float64Array(size);
  }
  push(v: number): void {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.buf.length;
    this.n = Math.min(this.n + 1, this.buf.length);
  }
  get count(): number {
    return this.n;
  }
  reset(): void {
    this.n = 0;
    this.i = 0;
  }
  summary(): { avg: number; p95: number } {
    return summarize(Array.from(this.buf.subarray(0, this.n)));
  }
}

export function summarize(values: number[]): { avg: number; p95: number } {
  if (values.length === 0) return { avg: 0, p95: 0 };
  const s = [...values].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  return { avg, p95 };
}
