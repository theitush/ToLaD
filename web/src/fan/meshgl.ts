// WebGL2 layer of the fan: the lanes (flat trapezoids with anti-aliased
// edges, the curved columns' chords) and the individuals mesh (mesh.ts), evaluated per pixel with
// procgen's hash (HASH_GLSL). Drawn on its own canvas under the Canvas 2D one,
// which keeps the text, the history marks and the parent threads.

import { HASH_GLSL } from '../../../packages/procgen/src/glsl.ts';
import { BridgeLayer } from './bridgegl';
import { LAT_DEPTH, LINK_LEVELS, LINK_P, MESH_F, MESH_U, NAR_FLOOR, TEX_FLOOR, type Palette } from './mesh';

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
void main() {
  // A trapezoid: [x0, x1] at y0, shifted by (dl, dr) at y1 (a rectangle when 0).
  // Its bounding box, grown so the anti-aliased edges have room.
  float g = 2.5;
  vec2 lo = vec2(min(aRect.x, aRect.x + aSkew.x) - g, aRect.y);
  vec2 hi = vec2(max(aRect.z, aRect.z + aSkew.y) + g, aRect.w);
  vec2 p = mix(lo, hi, corner);
  vP = p;
  vRect = aRect;
  vColor = aColor;
  vSkew = aSkew.xy;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

const RECT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vRect;
flat in vec4 vColor;
flat in vec2 vSkew;
out vec4 o;
void main() {
  // The edges at this row (linear between y0 and y1), and the pixel's horizontal coverage by
  // [xl, xr]: crisp edges, hairlines stay visible. A slanted edge is filtered over its
  // horizontal run across the pixel (at least the pixel).
  float H = max(1e-6, vRect.w - vRect.y);
  float t = clamp((vP.y - vRect.y) / H, 0.0, 1.0);
  float xl = vRect.x + vSkew.x * t;
  float xr = vRect.z + vSkew.y * t;
  // (At most 3 px: a sliver of a trapezoid, far under a pixel tall, would otherwise smear across its run.)
  float hw = 0.5 * clamp(max(abs(vSkew.x), abs(vSkew.y)) / H, 1.0, 3.0);
  float c = clamp(min(vP.x + hw, xr) - max(vP.x - hw, xl), 0.0, 2.0 * hw) / (2.0 * hw);
  float a = vColor.a * c;
  o = vec4(vColor.rgb * a, a);
}`;

const MESH_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 aRect;
layout(location = 2) in vec4 aSlot;
layout(location = 3) in vec4 aTime;
layout(location = 4) in vec4 aMisc;
layout(location = 5) in vec4 aLife;
layout(location = 6) in uvec4 aIdx;
layout(location = 7) in uvec4 aSeed;
layout(location = 8) in uvec4 aIdx2;
layout(location = 9) in vec4 aNar;
layout(location = 10) in vec4 aLink;
layout(location = 11) in vec4 aMore;
layout(location = 12) in vec4 aWarp;
uniform vec2 uView;
out vec2 vP;
flat out vec4 vRect;
flat out vec4 vSlot;
flat out vec4 vTime;
flat out vec4 vMisc;
flat out vec4 vLife;
flat out uvec4 vIdx;
flat out uvec4 vSeed;
flat out uvec4 vIdx2;
flat out vec4 vNar;
flat out vec4 vLink;
flat out vec4 vMore;
flat out vec4 vWarp;
void main() {
  vec2 p = mix(aRect.xy, aRect.zw, corner);
  vP = p;
  vRect = aRect; vSlot = aSlot; vTime = aTime; vMisc = aMisc; vLife = aLife; vIdx = aIdx; vSeed = aSeed; vIdx2 = aIdx2; vNar = aNar; vLink = aLink; vMore = aMore; vWarp = aWarp;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

export const MESH_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${HASH_GLSL}
in vec2 vP;
flat in vec4 vRect;
flat in vec4 vSlot;   // xB0, bw, lw, fineA
flat in vec4 vTime;   // p0, T0, A, gBoff
flat in vec4 vMisc;   // alpha, mode, lane, tipR
flat in vec4 vLife;   // GL, Lm, nowRel, xG
flat in uvec4 vIdx;   // B0, lvl, nA, nB
flat in uvec4 vSeed;  // seedA, seedB, strideA, strideB
flat in uvec4 vIdx2;  // latSeed, foldA, foldB, gA
flat in vec4 vNar;    // colL, colR, narG, narR
flat in vec4 vLink;   // linkA, lambda, tauC, tauB
flat in vec4 vMore;   // baseA, -, -, -
flat in vec4 vWarp;   // sL, sR, sG, sP: the column's curve down the instance (mesh.ts meshFrame)
// The column's right edge and the green edge at this pixel's row, in the frame of the top row (main).
float gColR;
float gXG;
uniform float uKLog;
uniform float uNowPx;
uniform vec3 uPal[3];
out vec4 o;
const float LN2 = 0.6931471805599453;
const float TEX_FLOOR = ${TEX_FLOOR.toFixed(4)};
const float NAR_FLOOR = ${NAR_FLOOR.toFixed(4)};
const uint LAT_DEPTH = ${LAT_DEPTH}u;
const int LINK_LEVELS = ${LINK_LEVELS};
const uint LINK_P24 = ${Math.round(LINK_P * 16777216)}u;
float expm1s(float x) { return abs(x) < 1e-3 ? x * (1.0 + x * (0.5 + x / 6.0)) : exp(x) - 1.0; }
float log1ps(float x) { return abs(x) < 1e-3 ? x * (1.0 - x * (0.5 - x / 3.0)) : log(1.0 + x); }
float lineAA(float d, float lw) {
  float w = max(lw, 1.0);
  return clamp(w * 0.5 + 0.5 - d, 0.0, 1.0) * min(lw, 1.0);
}
// One individual: x = birth, y = life (years from its generation's start); z = alive now.
vec4 life(uint seed, uint i, float GL, float Lm, float nowRel) {
  uint h = mixh(seed, i);
  float birth = randFloat(h, 1u) * GL;
  float l = Lm * (randFloat(h, 2u) + randFloat(h, 3u));
  bool alive = birth <= nowRel && birth + l > nowRel;
  return vec4(birth, l, alive ? 1.0 : 0.0, 0.0);
}
// mesh.ts latticeBit: which half's line is block idx's at level l.
uint latBit(uint l, uint idx) { return lowbias32((idx * 0x9e3779b1u) ^ vIdx2.x ^ (l * 0x85ebca6bu)) >> 31u; }
int code(float lane, bool alive) {
  if (lane < 0.5) return alive ? 0 : 1;
  return alive ? -1 : 2;
}
// mesh.ts slotBase: generation's first member on slot K (stride S, n members).
uint slotBase(uint K, uint S, uint n) { return n == 0u ? 0u : (K % max(S, 1u)) % n; }
// One lane's look at one slot: colour and coverage (not premultiplied). mesh.ts shadeLane.
vec4 shadeLane(float lane, uint iA, uint iB, float d, vec2 p, float floorA, float lw, bool one) {
  float GL = vLife.x;
  float Lm = vLife.y;
  float nowRel = vLife.z;
  if (vMisc.y < 0.5) {
    float cov = 0.0;
    vec3 col = vec3(0.0);
    float ns = 0.0;
    for (int s = 0; s < 2; s++) {
      if (s == 1 && (one || !(vTime.w > 0.0))) break;
      ns += 1.0;
      uint n = s == 0 ? vIdx.z : vIdx.w;
      uint i0 = s == 0 ? iA : iB;
      if (n == 0u) continue;
      float gOff = s == 0 ? 0.0 : vTime.w * GL;
      uint fold = s == 0 ? vIdx2.y : vIdx2.z;
      uint st = s == 0 ? vSeed.z : vSeed.w;
      for (uint c = 0u; c < fold; c++) {
        uint i = i0 + c * st;
        if (c > 0u && i >= n) break;
        vec4 L = life(s == 0 ? vSeed.x : vSeed.y, i, GL, Lm, nowRel - gOff);
        int k = code(lane, L.z > 0.5);
        if (k < 0) continue;
        float cv = max(0.0, min(L.x + L.y, nowRel - gOff) - L.x);
        cov += cv;
        col += cv * uPal[k];
      }
    }
    if (!(cov > 0.0)) return vec4(0.0);
    return vec4(col / cov, (floorA + (1.0 - floorA) * min(1.0, cov / (ns * GL))) * lineAA(d, lw));
  }
  float best = 0.0;
  int bc = -1;
  for (uint c = 0u; c < vIdx2.y; c++) {
    uint i = iA + c * vSeed.z;
    if (c > 0u && i >= vIdx.z) break;
    vec4 L = life(vSeed.x, i, GL, Lm, nowRel);
    bool alive = L.z > 0.5;
    int k = code(lane, alive);
    if (k < 0) continue;
    float kl = LN2 * uKLog;
    float birthPx = vTime.x + log1ps((vTime.y - L.x) / vTime.z) / kl;
    float topPx = vTime.x + log1ps((vTime.y - min(L.x + L.y, nowRel)) / vTime.z) / kl;
    if (!alive) topPx = max(topPx, uNowPx + 3.0);
    if (topPx > birthPx) continue;
    float dy = max(0.0, max(topPx - p.y, p.y - birthPx));
    float dLine = length(vec2(d, dy)) - vSlot.z * 0.5;
    float dDot = length(vec2(d, p.y - topPx)) - vMisc.w;
    float a = clamp(0.5 - min(dLine, dDot), 0.0, 1.0);
    // The living glow softly.
    if (k == 0) { float g = clamp(1.0 - dLine / 5.0, 0.0, 1.0); a = max(a, 0.35 * g * g); }
    if (a > best) { best = a; bc = k; }
  }
  // The slot's own thread under its lives, over the generation's span (the dead stop short of now).
  float baseA = vMore.x;
  if (baseA > 0.0) {
    float kl = LN2 * uKLog;
    float y0 = vTime.x + log1ps((vTime.y - min(GL, nowRel)) / vTime.z) / kl;
    float y1 = vTime.x + log1ps(vTime.y / vTime.z) / kl;
    float top = lane < 0.5 ? y0 : max(y0, uNowPx + 3.0);
    float a = p.y >= top && p.y < y1 ? baseA * lineAA(d, vSlot.z) : 0.0;
    if (a > best) { best = a; bc = lane < 0.5 ? 1 : 2; }
  }
  if (bc < 0) return vec4(0.0);
  return vec4(uPal[bc], best);
}
// ---- cross-links (mesh.ts shadeLinks) ----
uint linkPair(uint l, uint B) { return lowbias32((B * 0x27d4eb2du) ^ vIdx2.x ^ ((l + 1u) * 0x165667b1u)); }
uint timeHash(uint P, int c, int a) { return lowbias32((uint(a) * 0x7feb352du) ^ P ^ (uint(c + 1) * 0x846ca68bu)); }
int timeBit(uint P, int i, int idx) {
  int c = (i - 1) / 5;
  int d = 5 * c + 5 - i;
  int pos = (1 << d) - 1 + (idx & ((1 << d) - 1));
  return int((timeHash(P, c, idx >> d) >> uint(pos)) & 1u);
}
// The generation representing node band of level tau, if in [lo, hi]; else NONE.
const int NONE = -2147483647 - 1;
int timeRep(uint P, int tau, int band, int lo, int hi) {
  int idx = band;
  int i = tau;
  while (i > 0) {
    int c = (i - 1) / 5;
    int top = 5 * c + 5;
    uint h = timeHash(P, c, idx >> (top - i));
    for (; i > 5 * c; i--) {
      if ((idx << i) > hi || ((idx + 1) << i) <= lo) return NONE;
      int d = top - i;
      idx = 2 * idx + int((h >> uint((1 << d) - 1 + (idx & ((1 << d) - 1)))) & 1u);
    }
  }
  return idx >= lo && idx <= hi ? idx : NONE;
}
int timeRank(uint P, int g, int from, int to) {
  int r = from;
  for (int i = from + 1; i <= to; i++) {
    if (timeBit(P, i, g >> i) != ((g >> (i - 1)) & 1)) break;
    r = i;
  }
  return r;
}
float smooth01(float t) { t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float linkWeight(float l, float lambda) {
  float s = l - lambda;
  return s < 0.0 ? smooth01(1.0 + s) : 1.0 - smooth01(s - 1.0);
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(1e-9, dot(ab, ab)), 0.0, 1.0);
  return length(p - a - t * ab);
}
// Block B's line at level l (dl above the instance's), as drawn (mesh.ts latticeWalk): screen x.
float lineAt(uint l, uint B, uint dl) {
  uint D = min(l, LAT_DEPTH);
  uint idx = B;
  uint off = 0u;
  for (uint k = l; k > l - D; k--) {
    uint bit = latBit(k, idx);
    idx = 2u * idx + bit;
    off = 2u * off + bit;
  }
  float bwl = vSlot.y * float(1u << dl);
  return vSlot.x + float(int((B << dl) - vIdx.x)) * vSlot.y + (float(off) + 0.5) * bwl / float(1u << D);
}
vec4 shadeLinks(vec2 p) {
  float linkA = vLink.x;
  if (!(linkA > 0.0)) return vec4(0.0);
  float k = LN2 * uKLog;
  // The pixel's time (from generation gA's start) and years per px there.
  float tp = vTime.y - vTime.z * expm1s(k * (p.y - vTime.x));
  float dtdy = (vTime.y - tp + vTime.z) * k;
  float lw = max(0.75, vSlot.z * 0.45);
  float reachT = (lw * 0.5 + 1.0) * dtdy;
  float GL = vLife.x;
  int gA = int(vIdx2.w);
  int lo = gA + int(floor((tp - reachT) / GL));
  int hi = gA + int(floor((tp + reachT) / GL));
  int tauB = int(vLink.w);
  float tauC = vLink.z;
  int top = min(tauB + 8, max(tauB, int(ceil(tauC)) + 1));
  int bfL = int(floor((p.x - vSlot.x) / vSlot.y));
  if (int(vIdx.x) + bfL < 0) return vec4(0.0);
  uint BL = uint(int(vIdx.x) + bfL);
  vec4 best = vec4(0.0);
  for (int dl = 0; dl < LINK_LEVELS; dl++) {
    uint l = vIdx.y + uint(dl);
    float w = linkWeight(float(l), vLink.y);
    if (!(w > 0.004)) continue;
    uint Bl = BL >> uint(dl);
    for (int c = -1; c <= 0; c++) {
      if (c < 0 && Bl == 0u) continue;
      uint Bp = c < 0 ? Bl - 1u : Bl;
      uint P = linkPair(l, Bp);
      int g = vMisc.y < 0.5 ? timeRep(P, tauB, gA >> tauB, lo, hi) : (gA >= lo && gA <= hi ? gA : NONE);
      if (g == NONE) continue;
      uint h = lowbias32(P ^ (uint(g) * 0x9e3779b9u) ^ 0x68e31da4u);
      if ((h >> 8u) >= LINK_P24) continue;
      float u = 0.4 + 0.6 * (float(h & 127u) + 0.5) / 128.0;
      uint dir = (h >> 7u) & 1u;
      float tb = (float(g - gA) + u) * GL;
      float tpar = tb - GL / 3.0;
      if (tp < tpar - reachT || tp > tb + reachT) continue;
      float wt = smooth01(float(timeRank(P, g, tauB, top)) - tauC);
      if (!(wt > 0.0)) continue;
      // The pair's two lines, left and right.
      float xa = lineAt(l, Bp, uint(dl));
      float xb = lineAt(l, Bp + 1u, uint(dl));
      if (gColR > vNar.x && (xa < vNar.x || xb > gColR)) continue;
      float xC = dir == 0u ? xb : xa;
      float xP = dir == 0u ? xa : xb;
      float yC = p.y + (tp - tb) / dtdy;
      float yP = p.y + (tp - tpar) / dtdy;
      float a = lineAA(segDist(p, vec2(xP, yP), vec2(xC, yC)), lw) * w * wt * linkA * vMisc.x;
      if (a > best.a) {
        int cd = xC < gXG ? 1 : 2;
        best = vec4(uPal[cd], a);
      }
    }
  }
  return best;
}
void main() {
  // The pixel in the column's frame at the top row: the lattice rides the left edge and scales with the pitch (mesh.ts meshFrame).
  vec2 p = vP;
  {
    float dy = p.y - vRect.y;
    float k = max(1e-6, 1.0 + vWarp.w * dy);
    float colL = vNar.x;
    float xl = colL + vWarp.x * dy;
    p.x = colL + (vP.x - xl) / k;
    gColR = colL + (vNar.y + vWarp.y * dy - xl) / k;
    gXG = colL + (vLife.w + vWarp.z * dy - xl) / k;
    float pad = vMisc.y < 0.5 ? 1.0 : max(vMisc.w, max(vSlot.z, 1.0) * 0.5 + 5.0) + 1.0;
    if (vWarp != vec4(0.0) && (p.x < colL - pad || p.x > gColR + pad)) discard;
  }
  float xG = gXG;
  uint L = vIdx.y;
  float bw = vSlot.y;
  // Nothing to draw this far from a line (before any shading: most pixels stop here).
  // (Only the living glow, and they are only in the green lane.)
  float reach = vMisc.y < 0.5 ? max(vSlot.z, 1.0) * 0.5 + 0.5 : max(vMisc.w, max(vSlot.z, 1.0) * 0.5 + (xG > vRect.x ? 5.0 : 0.0)) + 0.5;
  float bf = floor((p.x - vSlot.x) / bw);
  uint D = min(L, LAT_DEPTH);
  vec4 best = vec4(0.0);
  // The lines of this block and its neighbours (each block's line is anywhere in it): mesh.ts shadeMesh, latticeWalk.
  for (int c = -1; c <= 1; c++) {
    float bb = bf + float(c);
    if (bb < 0.0) continue;
    uint B = vIdx.x + uint(bb);
    uint idx = B;
    uint off = 0u;
    float x0 = vSlot.x + bb * bw;
    float sub = bw;
    bool far = false;
    for (uint l = L; l > L - D; l--) {
      // The line is inside the current sub-block: too far from it, it is too far from the line.
      if (p.x < x0 - reach || p.x > x0 + sub + reach) { far = true; break; }
      uint bit = latBit(l, idx);
      idx = 2u * idx + bit;
      off = 2u * off + bit;
      sub *= 0.5;
      x0 += float(bit) * sub;
    }
    if (far) continue;
    float pp = bw / float(1u << D);
    float lineX = vSlot.x + bb * bw + (float(off) + 0.5) * pp;
    float d = abs(p.x - lineX);
    if (d > reach) continue;
    uint K = idx;
    uint iA = slotBase(K, vSeed.z, vIdx.z);
    uint iB = slotBase(K, vSeed.w, vIdx.w);
    float fine = (vSlot.w < 1.0 && latBit(L + 1u, B >> 1u) != (B & 1u)) ? vSlot.w : 1.0;
    // Where the lanes meet, the slot's colours blend by how much of it is in each.
    float wg = clamp((xG - lineX) / pp + 0.5, 0.0, 1.0);
    vec4 g = wg > 0.0 ? shadeLane(0.0, iA, iB, d, p, TEX_FLOOR, vSlot.z, false) : vec4(0.0);
    vec4 r = wg < 1.0 ? shadeLane(vMisc.z, iA, iB, d, p, TEX_FLOOR, vSlot.z, false) : vec4(0.0);
    float ag = g.a * wg;
    float ar = r.a * (1.0 - wg);
    float a = ag + ar;
    if (!(a > 0.0)) continue;
    vec3 col = (g.rgb * ag + r.rgb * ar) / a;
    a *= vMisc.x * fine;
    if (a > best.a) best = vec4(col, a);
  }
  vec4 lk = shadeLinks(p);
  if (lk.a > best.a) best = lk;
  // Lanes too narrow for their lines: the lane is one line its own width, lit by a representative's lives.
  if (vMisc.y < 0.5 && (vNar.z > 0.0 || vNar.w > 0.0)) {
    float colL = vNar.x;
    bool green = xG >= colL;
    float xGe = green ? max(xG, colL + 1.0) : colL;
    uint h = uint(int(floor(p.x - colL)));
    uint i = lowbias32((h * 0x2c1b3c6du) ^ vIdx2.x ^ 0x5bd1e995u);
    uint iA = slotBase(i, vSeed.z, vIdx.z);
    uint iB = slotBase(i, vSeed.w, vIdx.w);
    for (int k = 0; k < 2; k++) {
      float nar = k == 0 ? vNar.z : vNar.w;
      if (!(nar > 0.0) || (k == 0 && !green)) continue;
      float a0 = k == 0 ? colL : max(colL, xG);
      float a1 = k == 0 ? xGe : gColR;
      float cx = max(0.0, min(p.x + 0.5, a1) - max(p.x - 0.5, a0));
      if (!(cx > 0.0)) continue;
      vec4 c = shadeLane(k == 0 ? 0.0 : vMisc.z, iA, iB, 0.0, p, NAR_FLOOR, 1.0, true);
      c.a *= min(1.0, cx) * nar * vMisc.x;
      if (c.a > best.a) best = c;
    }
  }
  if (!(best.a > 0.0)) discard;
  o = vec4(best.rgb * best.a, best.a);
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
   * at y1 (straight between).
   */
  push(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a: number, dl = 0, dr = 0): void {
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
    this.f[o + 10] = 0;
    this.f[o + 11] = 0;
    this.n++;
  }
}

export class MeshBatch {
  f = new Float32Array(MESH_F * 256);
  u = new Uint32Array(MESH_U * 256);
  n = 0;
  /** Room for one more instance; returns its index. */
  next(): number {
    if ((this.n + 1) * MESH_F > this.f.length) {
      const nf = new Float32Array(this.f.length * 2);
      nf.set(this.f);
      this.f = nf;
      const nu = new Uint32Array(this.u.length * 2);
      nu.set(this.u);
      this.u = nu;
    }
    return this.n++;
  }
}

export class FanGL {
  readonly gl: WebGL2RenderingContext;
  private rectProg: WebGLProgram;
  private meshProg: WebGLProgram;
  private rectVao: WebGLVertexArrayObject;
  private meshVao: WebGLVertexArrayObject;
  private rectBuf: WebGLBuffer;
  private meshFBuf: WebGLBuffer;
  private meshUBuf: WebGLBuffer;
  private u: Record<string, WebGLUniformLocation | null> = {};
  /** Below the mesh: the lanes. Above it: lines that must stay on top (grid, "now"). */
  readonly under = new RectBatch();
  readonly mesh = new MeshBatch();
  readonly over = new RectBatch();
  /** Over the mesh: the cross-links between sister strands (bridge.ts, ToLaD#50). */
  readonly bridge: BridgeLayer;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('No WebGL2');
    this.gl = gl;
    this.rectProg = compile(gl, RECT_VS, RECT_FS);
    this.meshProg = compile(gl, MESH_VS, MESH_FS);
    this.bridge = new BridgeLayer(gl);
    for (const [prog, names] of [
      [this.rectProg, ['uView']],
      [this.meshProg, ['uView', 'uKLog', 'uNowPx', 'uPal']],
    ] as const) {
      for (const n of names) this.u[`${prog === this.rectProg ? 'r' : 'm'}.${n}`] = gl.getUniformLocation(prog, n);
    }
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    // Rects.
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
    // Mesh.
    this.meshVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.meshVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.meshFBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshFBuf);
    // Floats: aRect, aSlot, aTime, aMisc, aLife (locations 1–5), aNar (9), aLink (10), aMore (11) and aWarp (12).
    for (let k = 0; k < 9; k++) {
      const loc = k < 5 ? 1 + k : 4 + k;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, MESH_F * 4, k * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
    this.meshUBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshUBuf);
    for (let k = 0; k < 3; k++) {
      gl.enableVertexAttribArray(6 + k);
      gl.vertexAttribIPointer(6 + k, 4, gl.UNSIGNED_INT, MESH_U * 4, k * 16);
      gl.vertexAttribDivisor(6 + k, 1);
    }
    gl.bindVertexArray(null);
  }

  begin(): void {
    this.under.n = 0;
    this.mesh.n = 0;
    this.over.n = 0;
    this.bridge.n = 0;
  }

  private rects(b: RectBatch, w: number, h: number): void {
    if (!b.n) return;
    const gl = this.gl;
    gl.useProgram(this.rectProg);
    gl.uniform2f(this.u['r.uView'], w, h);
    gl.bindVertexArray(this.rectVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, b.f.subarray(0, b.n * 12), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.n);
  }

  /** Draw the frame: background, lanes, mesh, overlay lines. w, h in CSS px. */
  end(w: number, h: number, dpr: number, bg: [number, number, number], kLog: number, nowPx: number, pal: Palette): void {
    const gl = this.gl;
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    // Transparent: the page's background (a lit gradient) shows through.
    void bg;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.rects(this.under, w, h);
    if (this.mesh.n) {
      gl.useProgram(this.meshProg);
      gl.uniform2f(this.u['m.uView'], w, h);
      gl.uniform1f(this.u['m.uKLog'], kLog);
      gl.uniform1f(this.u['m.uNowPx'], nowPx);
      gl.uniform3fv(this.u['m.uPal'], new Float32Array(pal.flat()));
      gl.bindVertexArray(this.meshVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshFBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.mesh.f.subarray(0, this.mesh.n * MESH_F), gl.STREAM_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshUBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.mesh.u.subarray(0, this.mesh.n * MESH_U), gl.STREAM_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.mesh.n);
    }
    this.bridge.draw(w, h, kLog, pal);
    this.rects(this.over, w, h);
    gl.bindVertexArray(null);
  }
}

/** '#rrggbb' → [r, g, b] in 0–1. */
export function rgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
