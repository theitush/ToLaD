// WebGL2 layer of the fan: the lanes, flat trapezoids with anti-aliased edges (the columns' chords). Drawn on its
// own canvas under the Canvas 2D one, which keeps the text and the history marks.

const RECT_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 aRect;
layout(location = 2) in vec4 aColor;
layout(location = 3) in vec4 aSkew;
uniform vec2 uView;
out vec2 vP;
flat out vec4 vRect;
flat out vec4 vColor;
flat out vec2 vSkew;
flat out vec2 vClip;
void main() {
  // A trapezoid: [x0, x1] at y0, shifted by (dl, dr) at y1 (a rectangle when 0).
  // Its bounding box, grown so the anti-aliased edges have room (RECT_FS's filter, hw).
  float sk = max(abs(aSkew.x), abs(aSkew.y));
  float g = 2.5 + 0.5 * clamp(sk / max(1e-6, aRect.w - aRect.y), 1.0, max(3.0, sk));
  vec2 lo = vec2(min(aRect.x, aRect.x + aSkew.x) - g, aRect.y);
  vec2 hi = vec2(max(aRect.z, aRect.z + aSkew.y) + g, aRect.w);
  vec2 p = mix(lo, hi, corner);
  vP = p;
  vRect = aRect;
  vColor = aColor;
  vSkew = aSkew.xy;
  vClip = aSkew.zw;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

const RECT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vRect;
flat in vec4 vColor;
flat in vec2 vSkew;
flat in vec2 vClip;
out vec4 o;
void main() {
  // The edges at this row (linear between y0 and y1), and the pixel's horizontal coverage by
  // [xl, xr]: crisp edges, hairlines stay visible. A slanted edge is filtered over its
  // horizontal run across the pixel (at least the pixel).
  float H = max(1e-6, vRect.w - vRect.y);
  float t = clamp((vP.y - vRect.y) / H, 0.0, 1.0);
  float xl = vRect.x + vSkew.x * t;
  float xr = vRect.z + vSkew.y * t;
  // (Clipped to [cl, cr] along the row, if given: a lane's least width across a steep lean stops
  // where its chord does, not a row's width past it.)
  if (vClip.y > vClip.x) {
    xl = max(xl, vClip.x);
    xr = min(xr, vClip.y);
  }
  // A lane leaning s px per px covers s px of a row per px down: filtered over that run, a thin
  // lean is a continuous faint line, not a row of dashes. (A sliver of a trapezoid, far under a
  // pixel tall, filtered over at most its own run, 3 px at least, so it does not smear.)
  float sk = max(abs(vSkew.x), abs(vSkew.y));
  float hw = 0.5 * clamp(sk / H, 1.0, max(3.0, sk));
  float c = clamp(min(vP.x + hw, xr) - max(vP.x - hw, xl), 0.0, 2.0 * hw) / (2.0 * hw);
  float a = vColor.a * c;
  o = vec4(vColor.rgb * a, a);
}`;

// The lanes' chords (ToLaD#502): a column's stretch between two sample rows sent once, as its two rows on screen, and
// spread here into the trapezoids view.ts drawLanes drew from it on the CPU, in its order: its gray lane, its green
// lane's two glows and the green lane (instance i of a chord: role i % 4; a role with nothing to draw is no area).
// Each one as RECT_VS has it, into RECT_FS. The arithmetic is drawLanes' piece() and trap(), step for step (expandChords
// is the same in JS, for the tests).
const SEG_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 aQ;
layout(location = 2) in vec4 aP;
layout(location = 3) in vec4 aW;
layout(location = 4) in vec4 aE;
uniform vec2 uView;
uniform float uL;
uniform vec3 uGray;
uniform vec3 uGrayD;
uniform vec3 uGreen;
uniform vec3 uGreenD;
uniform vec4 uK;
out vec2 vP;
flat out vec4 vRect;
flat out vec4 vColor;
flat out vec2 vSkew;
flat out vec2 vClip;
float laneDim(float px) {
  float t = clamp((px - 2.0) / 8.0, 0.0, 1.0);
  return uK.x + (uK.y - uK.x) * (1.0 - t * t * (3.0 - 2.0 * t));
}
vec3 mixc(vec3 A, vec3 B, float t) {
  return floor((A * (1.0 - t) + B * t) * 255.0 + 0.5) / 255.0;
}
void main() {
  int role = gl_InstanceID % 4;
  // The chord: per row (q its top, p its bottom) its lane's left, right and green edges (px, as the CPU made them: no
  // edge a sum of two rounded values, however wide the lane), and widths; its height, and its centre line's run over it
  // (its lean, exact however short the chord); gray or not, its dim.
  float xq = aQ.x, rq = aQ.y, eq = aQ.z, y0 = aQ.w;
  float xp = aP.x, rp = aP.y, ep = aP.z, dy = aP.w;
  float wq = aW.x, gq = aW.y, wp = aW.z, gp = aW.w;
  float y1 = y0 + dy;
  float wm = (wq + wp) / 2.0;
  float gm = (gq + gp) / 2.0;
  float d = aE.x / dy;
  float sq = sqrt(1.0 + d * d);
  float xa = min(xq, xp);
  float l0 = 0.0, r0 = 0.0, l1 = 0.0, r1 = 0.0, a = 0.0, cl = 0.0, cr = 0.0;
  vec3 c = vec3(0.0);
  if (role == 0) {
    if (aE.y > 0.5) {
      l0 = xq;
      r0 = wq >= 0.6 * sq ? rq : xq + 0.6 * sq;
      l1 = xp;
      r1 = wp >= 0.6 * sq ? rp : xp + 0.6 * sq;
      c = mixc(uGray, uGrayD, laneDim(wm - gm) * 0.82);
      a = 1.0;
      cl = xa - 0.5;
      cr = max(wq >= 0.6 ? rq : xq + 0.6, wp >= 0.6 ? rp : xp + 0.6) + 0.5;
    }
  } else if (gq > 0.0 || gp > 0.0) {
    float g1q = gq >= sq ? eq : xq + sq;
    float g1p = gp >= sq ? ep : xp + sq;
    float xb = max(gq >= 1.0 ? eq : xq + 1.0, gp >= 1.0 ? ep : xp + 1.0);
    c = mixc(uGreen, uGreenD, laneDim(gm) * 0.9);
    if (role == 3) {
      l0 = xq;
      r0 = g1q;
      l1 = xp;
      r1 = g1p;
      a = 1.0;
      cl = xa - 0.5;
      cr = xb + 0.5;
    } else {
      float glow = (1.0 - aE.z) * min(1.0, gm / uK.z) * max(0.0, 1.0 - (sq - 1.0) / uK.w);
      if (glow > 0.01) {
        float e = role == 1 ? 4.0 * sq : 1.5 * sq;
        l0 = xq - e;
        r0 = g1q + e;
        l1 = xp - e;
        r1 = g1p + e;
        a = (role == 1 ? 0.06 : 0.14) * glow;
        cl = xa - e;
        cr = xb + e;
      }
    }
  }
  // trap(): wholly off screen, dropped; an edge wholly off screen pinned just outside it. Then RectBatch.push's test.
  float R = uL + 8.0;
  bool keep = a > 0.0 && !((r0 < -8.0 && r1 < -8.0) || (l0 > R && l1 > R));
  cl = max(-8.0, cl);
  cr = min(R, cr);
  if (l0 < -8.0 && l1 < -8.0) {
    l0 = -8.0;
    l1 = -8.0;
  }
  if (r0 > R && r1 > R) {
    r0 = R;
    r1 = R;
  }
  keep = keep && max(r0, r1) > min(l0, l1) && dy > 0.0;
  if (!keep) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    return;
  }
  vec2 S = vec2(l1 - l0, r1 - r0);
  float sk = max(abs(S.x), abs(S.y));
  float g = 2.5 + 0.5 * clamp(sk / max(1e-6, dy), 1.0, max(3.0, sk));
  vec2 lo = vec2(min(l0, l0 + S.x) - g, y0);
  vec2 hi = vec2(max(r0, r0 + S.y) + g, y1);
  vec2 p = mix(lo, hi, corner);
  vP = p;
  vRect = vec4(l0, y0, r0, y1);
  vColor = vec4(c, a);
  vSkew = S;
  vClip = vec2(cl, cr);
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

/** Growable typed arrays for one frame's instances. */
export class RectBatch {
  f = new Float32Array(12 * 256);
  n = 0;
  /**
   * A rectangle [x0, x1] × [y0, y1] (CSS px) in colour (r, g, b 0–1, alpha);
   * with (dl, dr), a trapezoid: its left and right edges shifted by dl and dr
   * at y1 (straight between); with cl < cr, clipped to [cl, cr] in x.
   */
  push(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a: number, dl = 0, dr = 0, cl = 0, cr = 0): void {
    if (!(Math.max(x1, x1 + dr) > Math.min(x0, x0 + dl)) || !(y1 > y0) || a <= 0) return;
    if ((this.n + 1) * 12 > this.f.length) {
      const nf = new Float32Array(this.f.length * 2);
      nf.set(this.f);
      this.f = nf;
    }
    const o = this.n * 12;
    this.f[o] = x0;
    this.f[o + 1] = y0;
    this.f[o + 2] = x1;
    this.f[o + 3] = y1;
    this.f[o + 4] = r;
    this.f[o + 5] = g;
    this.f[o + 6] = b;
    this.f[o + 7] = a;
    this.f[o + 8] = dl;
    this.f[o + 9] = dr;
    this.f[o + 10] = cl;
    this.f[o + 11] = cr;
    this.n++;
  }
}

/** The lanes' colours and constants SEG_VS reads (view.ts sets them: one source). */
export interface ChordStyle {
  gray: readonly number[];
  grayDark: readonly number[];
  green: readonly number[];
  greenDark: readonly number[];
  /** laneDim's wide and narrow dims, GLOW_W, GLOW_LEAN. */
  k: readonly [number, number, number, number];
}

/** Floats a chord takes (SEG_VS's four attributes). */
export const SEG_F = 16;

/** Growable typed arrays for one frame's chords (SEG_VS): per chord its rows' edges and widths, its height and lean, its kind. */
export class SegBatch {
  f = new Float32Array(SEG_F * 256);
  n = 0;
  /** Rows q (top, y0) and p (bottom, y1): left edge, width and green width (px); gray: its gray lane drawn; dim: its styled stretch's. */
  push(xq: number, wq: number, gq: number, y0: number, xp: number, wp: number, gp: number, y1: number, gray: boolean, dim: number): void {
    if ((this.n + 1) * SEG_F > this.f.length) {
      const nf = new Float32Array(this.f.length * 2);
      nf.set(this.f);
      this.f = nf;
    }
    const f = this.f;
    const o = this.n * SEG_F;
    f[o] = xq;
    f[o + 1] = xq + wq;
    f[o + 2] = xq + gq;
    f[o + 3] = y0;
    f[o + 4] = xp;
    f[o + 5] = xp + wp;
    f[o + 6] = xp + gp;
    f[o + 7] = y1 - y0;
    f[o + 8] = wq;
    f[o + 9] = gq;
    f[o + 10] = wp;
    f[o + 11] = gp;
    f[o + 12] = xp + wp / 2 - xq - wq / 2;
    f[o + 13] = gray ? 1 : 0;
    f[o + 14] = dim;
    f[o + 15] = 0;
    this.n++;
  }
}

/**
 * One frame's instances: the rects under the text (the lanes' chords among them, sent as chords: lanes()) and over
 * them. The chords keep their place among the rects: `cuts` holds, per run of chords, [under.n, segs.n] where it starts.
 */
export class Batches {
  /** The lanes; over them, lines that must stay on top (grid, "now"). */
  readonly under = new RectBatch();
  readonly over = new RectBatch();
  readonly segs = new SegBatch();
  readonly cuts: number[] = [];

  begin(): void {
    this.under.n = 0;
    this.over.n = 0;
    this.segs.n = 0;
    this.cuts.length = 0;
  }

  /** The chords' batch, for chords drawn after the rects pushed so far (a new run if rects came since the last chord). */
  lanes(): SegBatch {
    const C = this.cuts;
    if (!C.length || C[C.length - 2] !== this.under.n) C.push(this.under.n, this.segs.n);
    return this.segs;
  }
}

/**
 * SEG_VS in JS (ToLaD#502): the batches' rects with every chord spread into its trapezoids, in the order drawn, into
 * `out`: what the GPU draws, for the tests. Its arithmetic is the shader's (float32 inputs, double steps).
 */
export function expandChords(b: Batches, L: number, st: ChordStyle, out: RectBatch): RectBatch {
  out.n = 0;
  const U = b.under.f;
  const copy = (i: number) => {
    const o = 12 * i;
    out.push(U[o], U[o + 1], U[o + 2], U[o + 3], U[o + 4], U[o + 5], U[o + 6], U[o + 7], U[o + 8], U[o + 9], U[o + 10], U[o + 11]);
  };
  const laneDim = (px: number) => {
    const t = Math.min(1, Math.max(0, (px - 2) / 8));
    return st.k[0] + (st.k[1] - st.k[0]) * (1 - t * t * (3 - 2 * t));
  };
  const mixc = (A: readonly number[], B: readonly number[], t: number) => A.map((a, k) => Math.floor((a * (1 - t) + B[k] * t) * 255 + 0.5) / 255);
  const R = L + 8;
  const trap = (l0: number, r0: number, l1: number, r1: number, y0: number, y1: number, c: number[], a: number, cl: number, cr: number) => {
    if (!(a > 0) || (r0 < -8 && r1 < -8) || (l0 > R && l1 > R)) return;
    cl = Math.max(-8, cl);
    cr = Math.min(R, cr);
    if (l0 < -8 && l1 < -8) l0 = l1 = -8;
    if (r0 > R && r1 > R) r0 = r1 = R;
    out.push(l0, y0, r0, y1, c[0], c[1], c[2], a, l1 - l0, r1 - r0, cl, cr);
  };
  const chord = (j: number) => {
    const F = b.segs.f;
    const o = SEG_F * j;
    const [xq, rq, eq, y0, xp, rp, ep, dy, wq, gq, wp, gp, dc, gray, dim] = F.subarray(o, o + 15);
    const y1 = y0 + dy;
    const wm = (wq + wp) / 2;
    const gm = (gq + gp) / 2;
    const d = dc / dy;
    const sq = Math.sqrt(1 + d * d);
    const xa = Math.min(xq, xp);
    if (gray > 0.5) {
      const cr = Math.max(wq >= 0.6 ? rq : xq + 0.6, wp >= 0.6 ? rp : xp + 0.6) + 0.5;
      trap(xq, wq >= 0.6 * sq ? rq : xq + 0.6 * sq, xp, wp >= 0.6 * sq ? rp : xp + 0.6 * sq, y0, y1, mixc(st.gray, st.grayDark, laneDim(wm - gm) * 0.82), 1, xa - 0.5, cr);
    }
    if (!(gq > 0 || gp > 0)) return;
    const g1q = gq >= sq ? eq : xq + sq;
    const g1p = gp >= sq ? ep : xp + sq;
    const xb = Math.max(gq >= 1 ? eq : xq + 1, gp >= 1 ? ep : xp + 1);
    const c = mixc(st.green, st.greenDark, laneDim(gm) * 0.9);
    const glow = (1 - dim) * Math.min(1, gm / st.k[2]) * Math.max(0, 1 - (sq - 1) / st.k[3]);
    for (const [e, a] of [
      [4 * sq, 0.06],
      [1.5 * sq, 0.14],
    ])
      if (glow > 0.01) trap(xq - e, g1q + e, xp - e, g1p + e, y0, y1, c, a * glow, xa - e, xb + e);
    trap(xq, g1q, xp, g1p, y0, y1, c, 1, xa - 0.5, xb + 0.5);
  };
  const C = b.cuts;
  let u = 0;
  for (let k = 0; k < C.length; k += 2) {
    for (; u < C[k]; u++) copy(u);
    const e = k + 2 < C.length ? C[k + 3] : b.segs.n;
    for (let j = C[k + 1]; j < e; j++) chord(j);
  }
  for (; u < b.under.n; u++) copy(u);
  return out;
}

export class FanGL extends Batches {
  readonly gl: WebGL2RenderingContext;
  private rectProg!: WebGLProgram;
  private rectVao!: WebGLVertexArrayObject;
  private rectBuf!: WebGLBuffer;
  private uView: WebGLUniformLocation | null = null;
  private segProg!: WebGLProgram;
  private segVao!: WebGLVertexArrayObject;
  private segBuf!: WebGLBuffer;
  private segU: Record<string, WebGLUniformLocation | null> = {};
  /** The chords' colours (view.ts). */
  style: ChordStyle | null = null;
  /** Called when a lost context is back, its programs and buffers made again (ToLaD#478): the frame is to be drawn again. */
  onRestored: () => void = () => {};

  constructor(readonly canvas: HTMLCanvasElement) {
    super();
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('No WebGL2');
    this.gl = gl;
    // (A browser drops a background tab's context, ToLaD#478: the default kept, it never comes back. Asked back, it does, empty.)
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => {
      this.setup();
      this.onRestored();
    });
    this.setup();
  }

  /** The context lost (a background tab, ToLaD#478): nothing drawn until it is restored. */
  get lost(): boolean {
    return this.gl.isContextLost();
  }

  /** The program and buffers, made on a new context or a restored one (all of a lost context's are gone). */
  private setup(): void {
    const gl = this.gl;
    this.rectProg = compile(gl, RECT_VS, RECT_FS);
    this.uView = gl.getUniformLocation(this.rectProg, 'uView');
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.rectVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.rectVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.rectBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuf);
    for (let k = 0; k < 3; k++) {
      gl.enableVertexAttribArray(1 + k);
      gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, 48, k * 16);
      gl.vertexAttribDivisor(1 + k, 1);
    }
    // (The chords: the same quad, a chord's three attributes held over its four instances.)
    this.segProg = compile(gl, SEG_VS, RECT_FS);
    this.segU = {};
    for (const u of ['uView', 'uL', 'uGray', 'uGrayD', 'uGreen', 'uGreenD', 'uK']) this.segU[u] = gl.getUniformLocation(this.segProg, u);
    this.segVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.segVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.segBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
    for (let k = 0; k < 4; k++) {
      gl.enableVertexAttribArray(1 + k);
      gl.vertexAttribDivisor(1 + k, 4);
    }
    gl.bindVertexArray(null);
  }

  /** Items from..to - 1 of a batch already sent (its buffer bound, its VAO's): its `attrs` vec4s pointed at them, `per` instances each. */
  private range(from: number, to: number, attrs: number, per: number): void {
    if (!(to > from)) return;
    const gl = this.gl;
    const stride = 16 * attrs;
    for (let k = 0; k < attrs; k++) gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, stride, from * stride + k * 16);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, (to - from) * per);
  }

  /** Rects from..to - 1 of b, b sent first if `send`. */
  private rects(b: RectBatch, w: number, h: number, from = 0, to = b.n, send = true): void {
    if (!(to > from)) return;
    const gl = this.gl;
    gl.useProgram(this.rectProg);
    gl.uniform2f(this.uView, w, h);
    gl.bindVertexArray(this.rectVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuf);
    if (send) gl.bufferData(gl.ARRAY_BUFFER, b.f.subarray(0, b.n * 12), gl.STREAM_DRAW);
    this.range(from, to, 3, 1);
  }

  /** Chords from..to - 1 (sent), spread into their trapezoids by SEG_VS. */
  private chords(w: number, h: number, from: number, to: number): void {
    const st = this.style;
    if (!(to > from) || !st) return;
    const gl = this.gl;
    const U = this.segU;
    gl.useProgram(this.segProg);
    gl.uniform2f(U.uView, w, h);
    gl.uniform1f(U.uL, this.laneW);
    gl.uniform3fv(U.uGray, st.gray as number[]);
    gl.uniform3fv(U.uGrayD, st.grayDark as number[]);
    gl.uniform3fv(U.uGreen, st.green as number[]);
    gl.uniform3fv(U.uGreenD, st.greenDark as number[]);
    gl.uniform4fv(U.uK, st.k as unknown as number[]);
    gl.bindVertexArray(this.segVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
    this.range(from, to, SEG_F / 4, 4);
  }
  /** The width the lanes are clipped to (view.ts drawLanes' L: its w), set each frame. */
  laneW = 0;

  /** Draw the frame: lanes, then overlay lines. w, h in CSS px. */
  end(w: number, h: number, dpr: number): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    // Transparent: the page's background (a lit gradient) shows through.
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // (The rects under, the chords' runs among them where they were drawn, then the rects over; each batch sent once.)
    const C = this.cuts;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.under.f.subarray(0, this.under.n * 12), gl.STREAM_DRAW);
    if (this.segs.n) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.segs.f.subarray(0, this.segs.n * SEG_F), gl.STREAM_DRAW);
    }
    let u = 0;
    for (let k = 0; k < C.length; k += 2) {
      this.rects(this.under, w, h, u, C[k], false);
      u = Math.max(u, C[k]);
      this.chords(w, h, C[k + 1], k + 2 < C.length ? C[k + 3] : this.segs.n);
    }
    this.rects(this.under, w, h, u, this.under.n, false);
    this.rects(this.over, w, h);
    gl.bindVertexArray(null);
  }
}

/** '#rrggbb' → [r, g, b] in 0–1. */
export function rgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
