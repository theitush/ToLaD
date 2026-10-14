// The columns from static GPU buffers (ToLaD#340, research/scalable-tree.md §5 and step 4; ?gl=cols).
//
// The Steady layout (steady.ts) moves a column only at its own splits: every edge in the world is T[k] + D[k] * u,
// k a column (a node's, or a species' own above its split) and u its peel's ease, which depends on the height alone
// (the forks' heights are fixed). So the columns are built once per layout as world-space trapezoid pieces between
// fixed heights, each with its column k, its u at both ends, its offset from the column's edge and its lanes' widths;
// the openness of the gaps (the width zoom) is the per-column texture (T, D), rewritten only when the layout moves;
// the camera is four uniforms. A frame uploads nothing else and the vertex shader makes each piece's trapezoid in
// screen px exactly as view.ts drawLanes and drawStem do on the CPU (RECT_FS's coverage is the same shader).
//
// What is drawn: the stem (each node's column, its dark backdrop), and the lanes: a node's column as one ribbon (its
// founders' width, its green the column's prefix: the same pixels as its strands' slots side by side, whose green is
// that one prefix, layout.ts segGreen) and each species' own column above its split. A species merged into a clade
// (lod.ts) or drawn with its individuals or a styled span (twigs.ts fade, colstyle.ts) is hidden here and drawn on
// the CPU over it, as before.
//
// Float32: x is kept relative to an anchor near the camera (re-anchored as it drifts), y is the world's (log time).
// Where float32 cannot hold a pixel (a deep time zoom, or a peel's sweep at a deep width zoom) usable() says so and
// the view draws the frame on the CPU.

import { compile, RECT_FS } from './meshgl';
import { isNode, lanesAt, nodeQ, type Fan, type FanNode } from './layout';
import type { Steady } from './steady';

/** Floats per piece: yT, yB, k, node(1)/own(0), uT, uB, oT, oB, wT, wB, gT, gB. */
const PF = 12;
/** Samples across a peel (the S-curve's chords): within ~0.1% of its sweep. */
const PEEL_N = 32;
/** Grid of heights (world) an own column's widths are sampled on before the straight runs are dropped. */
const GRID = 1;
/** A sample is dropped where its neighbours' chord is within this share of the column's widest (widths, green, u). */
const TOL = 0.0015;
const TEX_W = 1024;

/** One column's samples from top (ty) to bottom, as pieces: [y, u, off, w, g] per height. */
function simplify(s: number[][]): number[][] {
  if (s.length <= 2) return s;
  let wMax = 0;
  for (const p of s) wMax = Math.max(wMax, p[3]);
  const tol = TOL * Math.max(wMax, 1e-12);
  const out = [s[0]];
  let a = 0;
  for (let b = 2; b <= s.length; b++) {
    // Can a→b span every sample between? Else keep b - 1.
    const ok =
      b < s.length &&
      (() => {
        const A = s[a];
        const B = s[b];
        const H = B[0] - A[0];
        for (let m = a + 1; m < b; m++) {
          const t = (s[m][0] - A[0]) / H;
          for (const c of [2, 3, 4]) if (Math.abs(A[c] + (B[c] - A[c]) * t - s[m][c]) > tol) return false;
          if (Math.abs(A[1] + (B[1] - A[1]) * t - s[m][1]) > TOL) return false;
        }
        return true;
      })();
    if (!ok) {
      out.push(s[b - 1]);
      a = b - 1;
    }
  }
  return out;
}

function uniq(ys: number[], lo: number, hi: number): number[] {
  const v = ys.filter((y) => y >= lo && y <= hi).sort((p, q) => p - q);
  const u: number[] = [];
  for (const y of v) if (!u.length || y - u[u.length - 1] > 1e-9) u.push(y);
  return u;
}

function peel(ys: number[], y0: number, h: number): void {
  if (h > 0) for (let i = 0; i <= PEEL_N; i++) ys.push(y0 - (h * i) / PEEL_N);
}

/** The static pieces of a fan's columns (built once per layout). */
export class ColsData {
  f: Float32Array;
  n = 0;
  readonly nodes: number;
  readonly strands: number;
  /** The highest |y| of any piece: float32's resolution in y is about yMax * 6e-8. */
  yMax = 0;
  readonly buildMs: number;

  constructor(
    readonly fan: Fan,
    readonly st: Steady,
  ) {
    const t0 = performance.now();
    this.nodes = fan.nodes.length;
    this.strands = fan.branches.length;
    this.f = new Float32Array(PF * 4096);
    const bottom = fan.trunkBottom.y;
    // The nodes' columns: from the split down to the parent's (the root's: the bottom of the world).
    fan.nodes.forEach((v, j) => {
      const top = v.y;
      const bot = Math.min(v.yBot, bottom);
      if (!(bot > top)) return;
      const ys = [top, bot];
      // (forkH: how far above its split a fork's peels end.)
      if (v.parent) peel(ys, v.parent.y, st.forkH(v.parent));
      if (v.blend > 0) for (let i = 0; i <= 16; i++) ys.push(top + (v.blend * i) / 16);
      for (let k = 0; k < Math.min(v.q.length, 64); k++) ys.push(fan.time.y(v.ageMa + ((k + 0.5) * v.genYears) / 1e6));
      const gAbove = nodeGreenAbove(v);
      const s = uniq(ys, top, bot).map((y) => {
        const g = nodeQ(v, fan.time.ageAt(y)) * v.width;
        const u = v.blend > 0 ? smoother((y - v.y) / v.blend) : 1;
        return [y, st.nodeU(j, y), 0, v.width, u >= 1 ? g : gAbove + (g - gAbove) * u];
      });
      this.push(simplify(s), j, 1);
    });
    // Each species' own column: from its tip down to its split.
    for (const b of fan.branches) {
      const top = b.tipY;
      const bot = Math.min(b.splitY, bottom);
      if (!(bot > top)) continue;
      const ys = [top, bot];
      const i = b.index;
      peel(ys, b.splitY, st.ownFork(i));
      for (let y = Math.ceil(top / GRID) * GRID; y < bot; y += GRID) ys.push(y);
      for (const a of b.pop.features()) ys.push(fan.time.y(a / 1e6));
      // (Just inside both ends: the lanes' values there, not the split's step.)
      const s = uniq(ys, top, bot).map((y) => {
        const yy = Math.min(Math.max(y, top + 1e-9), bot - 1e-9);
        const [w, g] = lanesAt(b, yy);
        return [y, st.ownU(i, yy), -w / 2, w, g];
      });
      this.push(simplify(s), this.nodes + i, 0);
    }
    this.buildMs = performance.now() - t0;
  }

  private push(s: number[][], k: number, node: number): void {
    for (let i = 0; i + 1 < s.length; i++) {
      const A = s[i];
      const B = s[i + 1];
      if (!(B[0] > A[0]) || (!(A[3] > 0) && !(B[3] > 0))) continue;
      if ((this.n + 1) * PF > this.f.length) {
        const nf = new Float32Array(this.f.length * 2);
        nf.set(this.f);
        this.f = nf;
      }
      const o = this.n * PF;
      const F = this.f;
      F[o] = A[0];
      F[o + 1] = B[0];
      F[o + 2] = k;
      F[o + 3] = node;
      F[o + 4] = A[1];
      F[o + 5] = B[1];
      F[o + 6] = A[2];
      F[o + 7] = B[2];
      F[o + 8] = A[3];
      F[o + 9] = B[3];
      F[o + 10] = A[4];
      F[o + 11] = B[4];
      this.yMax = Math.max(this.yMax, Math.abs(A[0]), Math.abs(B[0]));
      this.n++;
    }
  }
}

const smoother = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));

/** A node's green just above its split: its daughters' own greens there, side by side (segGreen's gAbove, summed). */
function nodeGreenAbove(v: FanNode): number {
  let g = 0;
  for (const k of v.kids) {
    if (isNode(k)) g += nodeQ(k, k.ageMa) * k.width;
    else g += lanesAt(k, v.y - 1e-6)[1];
  }
  return g;
}

const COLS_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 aYK;
layout(location = 2) in vec4 aUO;
layout(location = 3) in vec4 aWG;
uniform vec2 uView;
// x: px = (world - anchor) * sx + ox; y: px = (world - cy) * sy + h / 2.
uniform vec4 uCam; // sx, ox, sy, oy
uniform int uKind; // 0 stem, 1 gray lane, 2 glow outer, 3 glow inner, 4 green lane
uniform vec3 uStem;
uniform vec3 uGray;
uniform vec3 uGrayDark;
uniform vec3 uGreen;
uniform vec3 uGreenDark;
uniform float uGlowOn;
uniform highp sampler2D uSeg;
out vec2 vP;
flat out vec4 vRect;
flat out vec4 vColor;
flat out vec2 vSkew;
flat out vec2 vClip;

float narrow(float px) {
  float t = clamp((px - 2.0) / 8.0, 0.0, 1.0);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}
// twigs.ts laneDim with no lives and the texture's full weight.
float dimOf(float px) { return 0.72 + (0.3 - 0.72) * narrow(px); }

void cull() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vP = vec2(0.0); vRect = vec4(0.0); vColor = vec4(0.0); vSkew = vec2(0.0); vClip = vec2(0.0);
}

void main() {
  int k = int(aYK.z + 0.5);
  vec4 seg = texelFetch(uSeg, ivec2(k % ${TEX_W}, k / ${TEX_W}), 0);
  bool node = aYK.w > 0.5;
  // Hidden: z the stem's (a merged clade's node), w the lanes' (a species drawn on the CPU).
  if ((uKind == 0 && (!node || seg.z > 0.5)) || (uKind != 0 && seg.w > 0.5)) { cull(); return; }
  float sx = uCam.x;
  float L = uView.x;
  float y0 = aYK.x * uCam.z + uCam.w;
  float y1 = aYK.y * uCam.z + uCam.w;
  if (!(y1 > y0) || y1 < -4.0 || y0 > uView.y + 4.0) { cull(); return; }
  float xq = (seg.x + seg.y * aUO.x + aUO.z) * sx + uCam.y;
  float xp = (seg.x + seg.y * aUO.y + aUO.w) * sx + uCam.y;
  float wq = aWG.x * sx;
  float wp = aWG.y * sx;
  float l0, r0, l1, r1, cl = -8.0, cr = L + 8.0, a = 1.0;
  vec3 c;
  if (uKind == 0) {
    l0 = xq; r0 = xq + wq; l1 = xp; r1 = xp + wp; c = uStem; cl = 0.0; cr = 0.0;
    if (max(l0, l1) > L + 8.0 || min(l0, l1) + max(wq, wp) < -8.0) { cull(); return; }
  } else {
    if (!(wq > 0.0) && !(wp > 0.0)) { cull(); return; }
    float gq = aWG.z * sx;
    float gp = aWG.w * sx;
    float sq = sqrt(1.0 + pow((xp + wp * 0.5 - xq - wq * 0.5) / (y1 - y0), 2.0));
    if ((xq + max(max(wq, gq), sq) + 4.0 * sq < -8.0 && xp + max(max(wp, gp), sq) + 4.0 * sq < -8.0) || (xq - 4.0 * sq > L + 8.0 && xp - 4.0 * sq > L + 8.0)) { cull(); return; }
    float wm = (wq + wp) * 0.5;
    float gm = (gq + gp) * 0.5;
    float xa = min(xq, xp);
    float xr = max(xq + max(0.6, wq), xp + max(0.6, wp)) + 0.5;
    if (uKind == 1) {
      l0 = xq; r0 = xq + max(0.6 * sq, wq); l1 = xp; r1 = xp + max(0.6 * sq, wp);
      c = mix(uGray, uGrayDark, dimOf(wm - gm) * 0.82);
      cl = xa - 0.5; cr = xr;
    } else {
      if (!(gq > 0.0) && !(gp > 0.0)) { cull(); return; }
      float g1q = xq + max(sq, gq);
      float g1p = xp + max(sq, gp);
      float xb = max(xq + max(1.0, gq), xp + max(1.0, gp));
      c = mix(uGreen, uGreenDark, dimOf(gm) * 0.9);
      if (uKind == 4) { l0 = xq; r0 = g1q; l1 = xp; r1 = g1p; cl = xa - 0.5; cr = xb + 0.5; }
      else {
        float glow = uGlowOn * min(1.0, gm / 6.0) * max(0.0, 1.0 - (sq - 1.0) / 0.25);
        if (!(glow > 0.01)) { cull(); return; }
        float e = uKind == 2 ? 4.0 * sq : 1.5 * sq;
        a = (uKind == 2 ? 0.06 : 0.14) * glow;
        l0 = xq - e; r0 = g1q + e; l1 = xp - e; r1 = g1p + e; cl = xa - e; cr = xb + e;
      }
    }
    // (view.ts trap(): wholly off screen dropped; an edge wholly off pinned just outside; the clip to the screen.)
    if ((r0 < -8.0 && r1 < -8.0) || (l0 > L + 8.0 && l1 > L + 8.0)) { cull(); return; }
    cl = max(-8.0, cl);
    cr = min(L + 8.0, cr);
    if (l0 < -8.0 && l1 < -8.0) { l0 = -8.0; l1 = -8.0; }
    if (r0 > L + 8.0 && r1 > L + 8.0) { r0 = L + 8.0; r1 = L + 8.0; }
  }
  if (!(max(r0, r1) > min(l0, l1))) { cull(); return; }
  // As RECT_VS: the trapezoid's box, grown for the filter.
  vec4 rect = vec4(l0, y0, r0, y1);
  vec2 skew = vec2(l1 - l0, r1 - r0);
  float sk = max(abs(skew.x), abs(skew.y));
  float g = 2.5 + 0.5 * clamp(sk / max(1e-6, y1 - y0), 1.0, max(3.0, sk));
  vec2 lo = vec2(min(rect.x, rect.x + skew.x) - g, rect.y);
  vec2 hi = vec2(max(rect.z, rect.z + skew.y) + g, rect.w);
  vec2 p = mix(lo, hi, corner);
  vP = p;
  vRect = rect;
  vColor = vec4(c, a);
  vSkew = skew;
  vClip = vec2(cl, cr);
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

/** The columns' GPU state: the static pieces, the per-column texture, the program. */
export class ColsGL {
  private readonly prog: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly tex: WebGLTexture;
  private readonly seg: Float32Array;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};
  private ver = -1;
  /** The x anchor (world) T is relative to, and the most |D| (a peel's sweep, world). */
  private x0 = NaN;
  private dMax = 0;
  /** Per column its hidden flags (stem, lanes) as last uploaded. */
  readonly hidden: Uint8Array;
  private hiddenUp: Uint8Array;
  uploads = 0;

  constructor(
    readonly gl: WebGL2RenderingContext,
    readonly data: ColsData,
  ) {
    this.prog = compile(gl, COLS_VS, RECT_FS);
    for (const n of ['uView', 'uCam', 'uKind', 'uStem', 'uGray', 'uGrayDark', 'uGreen', 'uGreenDark', 'uGlowOn', 'uSeg']) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.f.subarray(0, data.n * PF), gl.STATIC_DRAW);
    for (let a = 0; a < 3; a++) {
      gl.enableVertexAttribArray(1 + a);
      gl.vertexAttribPointer(1 + a, 4, gl.FLOAT, false, PF * 4, a * 16);
      gl.vertexAttribDivisor(1 + a, 1);
    }
    gl.bindVertexArray(null);
    const K = data.nodes + data.strands;
    const rows = Math.ceil(K / TEX_W);
    this.seg = new Float32Array(TEX_W * rows * 4);
    this.hidden = new Uint8Array(K * 2);
    this.hiddenUp = new Uint8Array(K * 2).fill(255);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEX_W, rows, 0, gl.RGBA, gl.FLOAT, this.seg);
  }

  /**
   * Whether float32 holds this camera to a fraction of a pixel (else the view draws the frame on the CPU): y, the
   * world's heights at sy; x, a peel's sweep (D) at sx. (Anchor-relative coordinates for both: plan step 7.)
   */
  usable(sx: number, sy: number): boolean {
    return this.data.yMax * sy * 1.2e-7 < 0.1 && (this.dMax || 1) * sx * 1.2e-7 < 0.1;
  }

  /** Bring the per-column texture up to the layout (fold version), the anchor and the hidden flags: nothing if none moved. */
  sync(cx: number, sx: number, w: number): void {
    const st = this.data.st;
    const ver = st.ver;
    const drift = Math.abs(cx - this.x0) * sx > 2e4 || !Number.isFinite(this.x0);
    let flags = false;
    const H = this.hidden;
    const U = this.hiddenUp;
    for (let i = 0; i < H.length; i++) if (H[i] !== U[i]) flags = true;
    if (ver === this.ver && !drift && !flags) return;
    if (ver !== this.ver || drift) {
      if (drift) this.x0 = cx;
      st.segs(this.x0, this.seg);
      let d = 0;
      for (let k = 0; k < H.length / 2; k++) d = Math.max(d, Math.abs(this.seg[4 * k + 1]));
      this.dMax = d;
      this.ver = ver;
    }
    for (let k = 0; k < H.length / 2; k++) {
      this.seg[4 * k + 2] = H[2 * k];
      this.seg[4 * k + 3] = H[2 * k + 1];
    }
    U.set(H);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, this.seg.length / 4 / TEX_W, gl.RGBA, gl.FLOAT, this.seg);
    this.uploads++;
    void w;
  }

  /** Draw: the stem, then the gray lanes, the glows and the green lanes (each pass over every piece; the shader culls). */
  draw(w: number, h: number, cam: { cx: number; cy: number; sx: number; sy: number }, pal: { stem: number[]; gray: number[]; grayDark: number[]; green: number[]; greenDark: number[] }, glow: boolean): void {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.uSeg, 0);
    gl.uniform2f(this.u.uView, w, h);
    gl.uniform4f(this.u.uCam, cam.sx, (this.x0 - cam.cx) * cam.sx + w / 2, cam.sy, -cam.cy * cam.sy + h / 2);
    gl.uniform3fv(this.u.uStem, pal.stem);
    gl.uniform3fv(this.u.uGray, pal.gray);
    gl.uniform3fv(this.u.uGrayDark, pal.grayDark);
    gl.uniform3fv(this.u.uGreen, pal.green);
    gl.uniform3fv(this.u.uGreenDark, pal.greenDark);
    gl.uniform1f(this.u.uGlowOn, glow ? 1 : 0);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (let kind = 0; kind <= 4; kind++) {
      if (!glow && (kind === 2 || kind === 3)) continue;
      gl.uniform1i(this.u.uKind, kind);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.data.n);
    }
    gl.bindVertexArray(null);
  }
}
