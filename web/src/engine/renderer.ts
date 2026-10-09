// Raw WebGL2 renderer: instanced tapered bands with analytic anti-aliasing.
//
// Each instance is one trapezoid (bottom edge lb..rb, top edge lt..rt) with a
// green/gray lane boundary mb..mt, in some local space mapped to the screen by
// a per-draw transform u_xf = (ox, kx, oy, kt):  x = ox + kx*X,  y = oy - kt*T.
// Chunks draw with their composed (float64 → float32) transform; the near path
// draws with an identity transform because it is already in screen px.
//
// Coverage is computed in the fragment shader from the exact edge lines
// (flat varyings in framebuffer px), so there is no MSAA and edges stay crisp
// at DPR 2-3. Horizontal edges are left aliased on purpose: stacked
// trapezoids (taper-in, body, taper-out) then partition pixels exactly and
// never show seams.

import { INST_FLOATS, type Chunk, type SceneBuilder } from './scene';

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 a_x;   // lb rb lt rt (local X)
layout(location = 1) in vec4 a_mt;  // mb mt tb tt (lane X, local T)
layout(location = 2) in vec4 a_s;   // tint flags - -
uniform vec4 u_xf;   // ox kx oy kt  (CSS px)
uniform vec2 u_fb;   // framebuffer size (px)
uniform float u_px;  // framebuffer px per CSS px
flat out vec4 v_x;   // lb rb lt rt (fb px)
flat out vec2 v_m;   // mb mt (fb px)
flat out vec2 v_y;   // yb yt (fb px, y down)
flat out vec4 v_s;
void main() {
  int c = gl_VertexID;
  // two triangles: (0,0) (1,0) (0,1) / (0,1) (1,0) (1,1) as (side, end)
  float side = (c == 1 || c == 4 || c == 5) ? 1.0 : 0.0;
  float end = (c == 2 || c == 3 || c == 5) ? 1.0 : 0.0;
  vec4 xs = (u_xf.x + u_xf.y * a_x) * u_px;
  vec2 ms = (u_xf.x + u_xf.y * a_mt.xy) * u_px;
  vec2 ys = (u_xf.z - u_xf.w * a_mt.zw) * u_px;
  float pad = 1.5;
  float xl = end < 0.5 ? xs.x : xs.z;
  float xr = end < 0.5 ? xs.y : xs.w;
  float x = side < 0.5 ? min(xl, xr) - pad : max(xl, xr) + pad;
  float y = end < 0.5 ? ys.x : ys.y;
  gl_Position = vec4(x / u_fb.x * 2.0 - 1.0, 1.0 - y / u_fb.y * 2.0, 0.0, 1.0);
  v_x = xs;
  v_m = ms;
  v_y = ys;
  v_s = a_s;
}`;

const FS = `#version 300 es
precision highp float;
flat in vec4 v_x;
flat in vec2 v_m;
flat in vec2 v_y;
flat in vec4 v_s;
uniform vec2 u_fb;
uniform float u_px;
out vec4 o;
const vec3 GREEN = vec3(0.20, 0.74, 0.40);
const vec3 GRAY = vec3(0.40, 0.43, 0.46);
const vec3 OUTLINE = vec3(1.0, 0.55, 0.15);
void main() {
  float x = gl_FragCoord.x;
  float y = u_fb.y - gl_FragCoord.y;
  float h = v_y.y - v_y.x;              // top - bottom (negative: y grows down)
  h = h > -1e-6 ? -1e-6 : h;
  float u = clamp((y - v_y.x) / h, 0.0, 1.0);
  float L = mix(v_x.x, v_x.z, u);
  float R = mix(v_x.y, v_x.w, u);
  float sL = (v_x.z - v_x.x) / h;
  float sR = (v_x.w - v_x.y) / h;
  float dl = (x - L) * inversesqrt(1.0 + sL * sL);
  float dr = (R - x) * inversesqrt(1.0 + sR * sR);
  float cov = clamp(min(dl, 0.5) + min(dr, 0.5), 0.0, 1.0);
  if (cov <= 0.0) discard;
  float flags = v_s.y;
  if (flags >= 1.5) {
    // debug outline of a chunk's bounds
    float e = min(min(dl, dr), min(abs(y - v_y.x), abs(y - v_y.y)));
    float a = 1.0 - smoothstep(0.75 * u_px, 1.75 * u_px, e);
    if (a <= 0.0) discard;
    o = vec4(OUTLINE * a * 0.9, a * 0.9);
    return;
  }
  float M = mix(v_m.x, v_m.y, u);
  // 1 px green floor for any clade with something alive.
  if (flags > 0.5) M = max(M, L + min(u_px, R - L));
  float g = clamp(M - x + 0.5, 0.0, 1.0);
  vec3 col = mix(GRAY, GREEN, g) * (0.8 + 0.32 * v_s.x);
  // Subtle darkening along the side edges so nested bands read as nested.
  float w = R - L;
  float edge = (1.0 - smoothstep(0.0, 1.25 * u_px, min(dl, dr))) * smoothstep(3.0 * u_px, 9.0 * u_px, w);
  col *= 1.0 - 0.45 * edge;
  o = vec4(col * cov, cov);
}`;

interface GpuChunk {
  buf: WebGLBuffer;
  vao: WebGLVertexArrayObject;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uXf: WebGLUniformLocation;
  private uFb: WebGLUniformLocation;
  private uPx: WebGLUniformLocation;
  private nearBuf: WebGLBuffer;
  private nearVao: WebGLVertexArrayObject;
  private dbgBuf: WebGLBuffer;
  private dbgVao: WebGLVertexArrayObject;
  private nearCap = 0;
  private dbgCap = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.prog = link(gl, VS, FS);
    this.uXf = gl.getUniformLocation(this.prog, 'u_xf')!;
    this.uFb = gl.getUniformLocation(this.prog, 'u_fb')!;
    this.uPx = gl.getUniformLocation(this.prog, 'u_px')!;
    [this.nearBuf, this.nearVao] = this.makeVao();
    [this.dbgBuf, this.dbgVao] = this.makeVao();
  }

  private makeVao(): [WebGLBuffer, WebGLVertexArrayObject] {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const stride = INST_FLOATS * 4;
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, stride, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
    return [buf, vao];
  }

  private upload(buf: WebGLBuffer, data: Float32Array, count: number, cap: number): number {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const n = count * INST_FLOATS;
    if (n > cap) {
      cap = Math.max(n, cap * 2, INST_FLOATS * 256);
      gl.bufferData(gl.ARRAY_BUFFER, cap * 4, gl.DYNAMIC_DRAW);
    }
    if (n > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n);
    return cap;
  }

  release(c: Chunk): void {
    const g = c.gpu as GpuChunk | null;
    if (!g) return;
    this.gl.deleteBuffer(g.buf);
    this.gl.deleteVertexArray(g.vao);
    c.gpu = null;
    c.gpuEpoch = -1;
  }

  render(scene: SceneBuilder, pxScale: number, debug: { data: Float32Array; count: number } | null): void {
    const gl = this.gl;
    const fbW = this.canvas.width;
    const fbH = this.canvas.height;
    gl.viewport(0, 0, fbW, fbH);
    gl.clearColor(0.043, 0.059, 0.051, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.uniform2f(this.uFb, fbW, fbH);
    gl.uniform1f(this.uPx, pxScale);

    // Near path first: these are always ancestors of (or disjoint from) chunk draws.
    if (scene.near.count > 0) {
      this.nearCap = this.upload(this.nearBuf, scene.near.data, scene.near.count, this.nearCap);
      gl.bindVertexArray(this.nearVao);
      gl.uniform4f(this.uXf, 0, 1, 0, -1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, scene.near.count);
    }
    for (const d of scene.draws) {
      const c = d.chunk;
      let g = c.gpu as GpuChunk | null;
      if (!g) {
        const [buf, vao] = this.makeVao();
        g = { buf, vao };
        c.gpu = g;
      }
      if (c.gpuEpoch !== c.epoch) {
        gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
        gl.bufferData(gl.ARRAY_BUFFER, c.data, gl.STATIC_DRAW);
        c.gpuEpoch = c.epoch;
      }
      gl.bindVertexArray(g.vao);
      gl.uniform4f(this.uXf, d.f.ox, d.f.kx, d.f.oy, d.f.kt);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, c.count);
    }
    if (debug && debug.count > 0) {
      this.dbgCap = this.upload(this.dbgBuf, debug.data, debug.count, this.dbgCap);
      gl.bindVertexArray(this.dbgVao);
      gl.uniform4f(this.uXf, 0, 1, 0, -1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, debug.count);
    }
    gl.bindVertexArray(null);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
  return s;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program link failed');
  return p;
}
