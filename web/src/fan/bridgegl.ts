// WebGL2 program for the cross-links between sister strands (bridge.ts, whose
// shadeBridge it mirrors line for line), drawn over the mesh by FanGL.

import { HASH_GLSL } from '../../../packages/procgen/src/glsl.ts';
import { BRIDGE_BAND_PX, BRIDGE_F, BRIDGE_GAP0, BRIDGE_GAP1, BRIDGE_J, BRIDGE_P, BRIDGE_U } from './bridge';
import type { Palette } from './mesh';

const BRIDGE_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 aRect;
layout(location = 2) in vec4 aEdge;
layout(location = 3) in vec4 aW;
layout(location = 4) in vec4 aTime;
layout(location = 5) in vec4 aKeep;
layout(location = 6) in vec4 aReach;
layout(location = 7) in vec4 aMore;
layout(location = 8) in uvec4 aIdx;
uniform vec2 uView;
out vec2 vP;
flat out vec4 vRect;
flat out vec4 vEdge;
flat out vec4 vW;
flat out vec4 vTime;
flat out vec4 vKeep;
flat out vec4 vReach;
flat out vec4 vMore;
flat out uvec4 vIdx;
void main() {
  vec2 p = mix(aRect.xy, aRect.zw, corner);
  vP = p;
  vRect = aRect; vEdge = aEdge; vW = aW; vTime = aTime; vKeep = aKeep; vReach = aReach; vMore = aMore; vIdx = aIdx;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

const BRIDGE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${HASH_GLSL}
in vec2 vP;
flat in vec4 vRect;
flat in vec4 vEdge;   // xa, xb, sa, sb
flat in vec4 vW;      // wa, wb, lw, alpha
flat in vec4 vTime;   // p0, T0, A, GL
flat in vec4 vKeep;   // k0, k1, amp, rmax
flat in vec4 vReach;  // h0, h1, cL, cR
flat in vec4 vMore;   // hIn, -, -, -
flat in uvec4 vIdx;   // P, gA, J, -
uniform float uKLog;
uniform vec3 uPal[3];
out vec4 o;
const float LN2 = 0.6931471805599453;
const uint LINK_P24 = ${Math.round(BRIDGE_P * 16777216)}u;
const float BAND_PX = ${BRIDGE_BAND_PX.toFixed(6)};
const int NONE = -2147483647 - 1;
float expm1s(float x) { return abs(x) < 1e-3 ? x * (1.0 + x * (0.5 + x / 6.0)) : exp(x) - 1.0; }
float lineAA(float d, float lw) {
  float w = max(lw, 1.0);
  return clamp(w * 0.5 + 0.5 - d, 0.0, 1.0) * min(lw, 1.0);
}
float smooth01(float t) { t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(1e-9, dot(ab, ab)), 0.0, 1.0);
  return length(p - a - t * ab);
}
// mesh.ts timeHash / timeBit / timeRep / timeRank.
uint timeHash(uint P, int c, int a) { return lowbias32((uint(a) * 0x7feb352du) ^ P ^ (uint(c + 1) * 0x846ca68bu)); }
int timeBit(uint P, int i, int idx) {
  int c = (i - 1) / 5;
  int d = 5 * c + 5 - i;
  int pos = (1 << d) - 1 + (idx & ((1 << d) - 1));
  return int((timeHash(P, c, idx >> d) >> uint(pos)) & 1u);
}
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
float keepAt(float gr) {
  return gr < vKeep.x ? 1.0 : vKeep.z * (1.0 - smooth01((gr - vKeep.x) / max(1e-6, vKeep.y - vKeep.x)));
}
float reachAt(float gr) {
  if (!(vKeep.w > 0.0)) return 0.0;
  return vKeep.w * smooth01((gr - vMore.x) / max(1e-6, vReach.x - vMore.x)) * (1.0 - smooth01((gr - vReach.x) / max(1e-6, vReach.y - vReach.x)));
}
void main() {
  vec2 p = vP;
  float k = LN2 * uKLog;
  float tp = vTime.y - vTime.z * expm1s(k * (p.y - vTime.x));
  float dtdy = (vTime.y - tp + vTime.z) * k;
  float lw = max(0.75, vW.z * 0.45);
  float reachT = (lw * 0.5 + 1.0) * dtdy;
  float GL = vTime.w;
  int gA = int(vIdx.y);
  int lo = gA + int(floor((tp - reachT) / GL));
  int hi = gA + int(floor((tp + reachT) / GL));
  float tauC = log2(BAND_PX * dtdy / GL);
  int tauB = max(0, int(ceil(tauC)));
  int top = tauB + 1;
  float gap = vEdge.y + vEdge.w * (p.y - vRect.y) - (vEdge.x + vEdge.z * (p.y - vRect.y));
  float gapA = 1.0 - smooth01((gap / max(1e-6, vW.x + vW.y) - ${BRIDGE_GAP0.toFixed(6)}) / ${(BRIDGE_GAP1 - BRIDGE_GAP0).toFixed(6)});
  if (!(gapA > 0.0)) discard;
  vec4 best = vec4(0.0);
  for (int j = 0; j < ${BRIDGE_J}; j++) {
    if (j >= int(vIdx.z)) break;
    uint P = j == 0 ? vIdx.x : lowbias32(vIdx.x + uint(j) * 0x9e3779b9u);
    int b0 = lo >> tauB;
    int b1 = min(hi >> tauB, b0 + 2);
    for (int band = b0; band <= b1; band++) {
      int g = timeRep(P, tauB, band, lo, hi);
      if (g == NONE) continue;
      uint h = lowbias32(P ^ (uint(g) * 0x9e3779b9u) ^ 0x68e31da4u);
      if ((h >> 8u) >= LINK_P24) continue;
      uint h2 = lowbias32(P ^ (uint(g) * 0x85ebca6bu) ^ 0x3c6ef372u);
      float gr = float(g - gA) + 0.5;
      if (!(float(h2 >> 8u) / 16777216.0 < keepAt(gr))) continue;
      float u = 0.4 + 0.6 * (float(h & 127u) + 0.5) / 128.0;
      uint dir = (h >> 7u) & 1u;
      float tb = (float(g - gA) + u) * GL;
      float tpar = tb - GL / 3.0;
      if (tp < tpar - reachT || tp > tb + reachT) continue;
      float wt = smooth01(float(timeRank(P, g, tauB, top)) - tauC);
      if (!(wt > 0.0)) continue;
      float r = reachAt(gr);
      uint h3 = lowbias32(h2);
      float ra = (float(h3 & 0xffffu) + 0.5) / 65536.0;
      float rb = (float(h3 >> 16u) + 0.5) / 65536.0;
      float yC = p.y + (tp - tb) / dtdy;
      float yP = p.y + (tp - tpar) / dtdy;
      float yL = dir == 0u ? yP : yC;
      float yR = dir == 0u ? yC : yP;
      float xL = vEdge.x + vEdge.z * (yL - vRect.y) - r * ra * vW.x;
      float xR = vEdge.y + vEdge.w * (yR - vRect.y) + r * rb * vW.y;
      float a = lineAA(segDist(p, vec2(xL, yL), vec2(xR, yR)), lw) * wt * gapA * vW.w;
      if (a > best.a) {
        int cd = int(dir == 0u ? vReach.w : vReach.z);
        best = vec4(uPal[cd], a);
      }
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
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`bridge shader: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`bridge link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

/** One frame's bridge instances and the program that draws them. */
export class BridgeLayer {
  f = new Float32Array(BRIDGE_F * 64);
  u = new Uint32Array(BRIDGE_U * 64);
  n = 0;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private fBuf: WebGLBuffer;
  private uBuf: WebGLBuffer;
  private uView: WebGLUniformLocation | null;
  private uKLog: WebGLUniformLocation | null;
  private uPal: WebGLUniformLocation | null;

  constructor(readonly gl: WebGL2RenderingContext) {
    this.prog = compile(gl, BRIDGE_VS, BRIDGE_FS);
    this.uView = gl.getUniformLocation(this.prog, 'uView');
    this.uKLog = gl.getUniformLocation(this.prog, 'uKLog');
    this.uPal = gl.getUniformLocation(this.prog, 'uPal');
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.fBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fBuf);
    for (let k = 0; k < 7; k++) {
      gl.enableVertexAttribArray(1 + k);
      gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, BRIDGE_F * 4, k * 16);
      gl.vertexAttribDivisor(1 + k, 1);
    }
    this.uBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uBuf);
    gl.enableVertexAttribArray(8);
    gl.vertexAttribIPointer(8, 4, gl.UNSIGNED_INT, BRIDGE_U * 4, 0);
    gl.vertexAttribDivisor(8, 1);
    gl.bindVertexArray(null);
  }

  /** Room for one more instance; returns its index. */
  next(): number {
    if ((this.n + 1) * BRIDGE_F > this.f.length) {
      const nf = new Float32Array(this.f.length * 2);
      nf.set(this.f);
      this.f = nf;
      const nu = new Uint32Array(this.u.length * 2);
      nu.set(this.u);
      this.u = nu;
    }
    return this.n++;
  }

  /** Draw this frame's instances (blending as set by FanGL.end), then empty the batch. */
  draw(w: number, h: number, kLog: number, pal: Palette): void {
    if (!this.n) return;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniform2f(this.uView, w, h);
    gl.uniform1f(this.uKLog, kLog);
    gl.uniform3fv(this.uPal, new Float32Array(pal.flat()));
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.f.subarray(0, this.n * BRIDGE_F), gl.STREAM_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.u.subarray(0, this.n * BRIDGE_U), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
    gl.bindVertexArray(null);
    this.n = 0;
  }
}
