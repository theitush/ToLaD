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
//
// Nested river bands stack 20-30 deep, so painting every band back to front
// costs that much overdraw. Instead each frame runs two passes: opaque band
// interiors (inset past the AA ramp) front to back with a depth buffer whose
// level is the node's tree depth, then the thin anti-aliased edge strips
// blended back to front against that depth. Most pixels are shaded once.

import { INST_FLOATS, reverseInstances, type Chunk, type SceneBuilder } from './scene';

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 a_x;   // lb rb lt rt (local X)
layout(location = 1) in vec4 a_mt;  // mb mt tb tt (lane X, local T)
layout(location = 2) in vec4 a_s;   // tint flags gb gt (ghost lane boundary, local X)
uniform vec4 u_xf;   // ox kx oy kt  (CSS px)
uniform vec2 u_fb;   // framebuffer size (px)
uniform float u_px;  // framebuffer px per CSS px
flat out vec4 v_x;   // lb rb lt rt (fb px)
flat out vec2 v_m;   // mb mt (fb px)
flat out vec2 v_y;   // yb yt (fb px, y down)
flat out vec4 v_s;   // tint flags gb gt (gb gt in fb px)
flat out float v_full; // interior pass: fully covered
uniform int u_pass;  // 0 = single pass, 1 = opaque interiors (depth write), 2 = AA edge strips
void main() {
  int c = gl_VertexID % 6;
  int strip = gl_VertexID / 6;
  // two triangles: (0,0) (1,0) (0,1) / (0,1) (1,0) (1,1) as (side, end)
  float side = (c == 1 || c == 4 || c == 5) ? 1.0 : 0.0;
  float end = (c == 2 || c == 3 || c == 5) ? 1.0 : 0.0;
  vec4 xs = (u_xf.x + u_xf.y * a_x) * u_px;
  vec2 ms = (u_xf.x + u_xf.y * a_mt.xy) * u_px;
  vec2 ys = (u_xf.z - u_xf.w * a_mt.zw) * u_px;
  float xl = end < 0.5 ? xs.x : xs.z;
  float xr = end < 0.5 ? xs.y : xs.w;
  float x = side < 0.5 ? min(xl, xr) - 1.5 : max(xl, xr) + 1.5;
  bool hide = false;
  if (u_pass != 0) {
    // Horizontal extent of each side edge's anti-aliasing ramp.
    float hh = ys.y - ys.x;
    hh = abs(hh) < 1e-6 ? -1e-6 : hh;
    float sl = (xs.z - xs.x) / hh;
    float sr = (xs.w - xs.y) / hh;
    float insL = 0.5 * sqrt(1.0 + sl * sl) + 0.5;
    float insR = 0.5 * sqrt(1.0 + sr * sr) + 0.5;
    bool thin = min(xs.y - xs.x, xs.w - xs.z) < insL + insR + 1.0;
    if (u_pass == 1) {
      // Exact trapezoid, inset so every pixel is fully covered: opaque, depth-tested.
      hide = thin;
      x = side < 0.5 ? xl + insL : xr - insR;
    } else if (thin) {
      hide = strip == 1;
    } else if (strip == 0) {
      x = side < 0.5 ? xl - insL - 0.5 : xl + insL;
    } else {
      x = side < 0.5 ? xr - insR : xr + insR + 0.5;
    }
  }
  float y = end < 0.5 ? ys.x : ys.y;
  float level = floor(a_s.x);
  float z = 1.0 - 2.0 * (level + 1.0) / 4097.0;
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(x / u_fb.x * 2.0 - 1.0, 1.0 - y / u_fb.y * 2.0, z, 1.0);
  v_x = xs;
  v_m = ms;
  v_y = ys;
  v_s = vec4(fract(a_s.x), a_s.y, (u_xf.x + u_xf.y * a_s.zw) * u_px);
  v_full = u_pass == 1 ? 1.0 : 0.0;
}`;

const FS = `#version 300 es
precision highp float;
flat in vec4 v_x;
flat in vec2 v_m;
flat in vec2 v_y;
flat in vec4 v_s;
flat in float v_full;
uniform vec2 u_fb;
uniform float u_px;
out vec4 o;
const vec3 GREEN = vec3(0.20, 0.74, 0.40);
const vec3 GRAY = vec3(0.40, 0.43, 0.46);
const vec3 OUTLINE = vec3(1.0, 0.55, 0.15);
const vec3 GHOST = vec3(0.47, 0.45, 0.57);
const vec3 SELECT = vec3(1.0, 0.86, 0.35);
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
  float cov = v_full > 0.5 ? 1.0 : clamp(min(dl, 0.5) + min(dr, 0.5), 0.0, 1.0);
  if (cov <= 0.0) discard;
  int fl = int(v_s.y + 0.5);
  if ((fl & 2) != 0) {
    // debug outline of a chunk's bounds
    float e = min(min(dl, dr), min(abs(y - v_y.x), abs(y - v_y.y)));
    float a = 1.0 - smoothstep(0.75 * u_px, 1.75 * u_px, e);
    if (a <= 0.0) discard;
    o = vec4(OUTLINE * a * 0.9, a * 0.9);
    return;
  }
  float M = mix(v_m.x, v_m.y, u);
  // 1 px green floor for any clade with something alive.
  bool alive = (fl & 1) != 0;
  if (alive) M = max(M, L + min(u_px, R - L));
  float g = clamp(M - x + 0.5, 0.0, 1.0);
  vec3 gray = GRAY;
  // Taxonomic fans (PBDB grafts / created groups): a slightly cooler, flatter gray.
  if ((fl & 4) != 0) gray = vec3(0.42, 0.44, 0.52);
  vec3 col = mix(gray, GREEN, g) * (0.8 + 0.32 * v_s.x);
  // Ghost lineages: the right-hand lane, desaturated violet with diagonal hatching.
  float G = mix(v_s.z, v_s.w, u);
  float gh = clamp(x - G + 0.5, 0.0, 1.0) * (1.0 - g);
  if (gh > 0.0) {
    float stripe = fract((x + y) / (7.0 * u_px));
    float hatch = smoothstep(0.0, 0.12, stripe) * (1.0 - smoothstep(0.42, 0.54, stripe));
    vec3 gc = GHOST * (0.8 + 0.2 * hatch) * (0.85 + 0.2 * v_s.x);
    col = mix(col, gc, gh);
  }
  // Subtle darkening along the side edges so nested bands read as nested.
  float w = R - L;
  float edge = (1.0 - smoothstep(0.0, 1.25 * u_px, min(dl, dr))) * smoothstep(3.0 * u_px, 9.0 * u_px, w);
  col *= 1.0 - 0.45 * edge;
  if ((fl & 32) != 0) {
    // Selected band: bright edge.
    float se = 1.0 - smoothstep(0.5 * u_px, 2.5 * u_px, min(dl, dr));
    col = mix(col * 1.12, SELECT, se);
  }
  o = vec4(col * cov, cov);
}`;

/** The browser could not create a WebGL2 context (disabled, blocklisted GPU, no hardware acceleration). */
export class NoWebGLError extends Error {
  constructor() {
    super('WebGL2 is not available');
    this.name = 'NoWebGLError';
  }
}

interface GpuChunk {
  buf: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  rbuf: WebGLBuffer;
  rvao: WebGLVertexArrayObject;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uXf: WebGLUniformLocation;
  private uFb: WebGLUniformLocation;
  private uPx: WebGLUniformLocation;
  private uPass: WebGLUniformLocation;
  private nearRevBuf: WebGLBuffer;
  private nearRevVao: WebGLVertexArrayObject;
  private nearRev = new Float32Array(0);
  private nearRevCap = 0;
  private nearBuf: WebGLBuffer;
  private nearVao: WebGLVertexArrayObject;
  private dbgBuf: WebGLBuffer;
  private dbgVao: WebGLVertexArrayObject;
  private nearCap = 0;
  /** Diagnostics: bit 1 = draw interiors, bit 2 = draw edge strips. */
  passes = 3;
  private dbgCap = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new NoWebGLError();
    this.gl = gl;
    this.prog = link(gl, VS, FS);
    this.uXf = gl.getUniformLocation(this.prog, 'u_xf')!;
    this.uFb = gl.getUniformLocation(this.prog, 'u_fb')!;
    this.uPx = gl.getUniformLocation(this.prog, 'u_px')!;
    this.uPass = gl.getUniformLocation(this.prog, 'u_pass')!;
    [this.nearBuf, this.nearVao] = this.makeVao();
    [this.nearRevBuf, this.nearRevVao] = this.makeVao();
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
    this.gl.deleteBuffer(g.rbuf);
    this.gl.deleteVertexArray(g.rvao);
    c.gpu = null;
    c.gpuEpoch = -1;
  }

  render(scene: SceneBuilder, pxScale: number, debug: { data: Float32Array; count: number } | null): void {
    const gl = this.gl;
    const fbW = this.canvas.width;
    const fbH = this.canvas.height;
    gl.viewport(0, 0, fbW, fbH);
    gl.clearColor(0.043, 0.059, 0.051, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(this.uFb, fbW, fbH);
    gl.uniform1f(this.uPx, pxScale);

    // Upload what changed.
    const near = scene.near;
    if (near.count > 0) {
      this.nearCap = this.upload(this.nearBuf, near.data, near.count, this.nearCap);
      this.nearRev = reverseInstances(near.data, near.count, this.nearRev);
      this.nearRevCap = this.upload(this.nearRevBuf, this.nearRev, near.count, this.nearRevCap);
    }
    for (const d of scene.draws) {
      const c = d.chunk;
      let g = c.gpu as GpuChunk | null;
      if (!g) {
        const [buf, vao] = this.makeVao();
        const [rbuf, rvao] = this.makeVao();
        g = { buf, vao, rbuf, rvao };
        c.gpu = g;
      }
      if (c.gpuEpoch !== c.version) {
        gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
        gl.bufferData(gl.ARRAY_BUFFER, c.data, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.rbuf);
        gl.bufferData(gl.ARRAY_BUFFER, c.rev, gl.STATIC_DRAW);
        c.gpuEpoch = c.version;
      }
    }

    // Pass 1: opaque band interiors, deepest first, writing depth (level = tree depth),
    // so nested bands hide their ancestors and each pixel is shaded about once.
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.uniform1i(this.uPass, 1);
    for (let i = this.passes & 1 ? scene.draws.length - 1 : -1; i >= 0; i--) {
      const d = scene.draws[i];
      const g = d.chunk.gpu as GpuChunk;
      gl.bindVertexArray(g.rvao);
      gl.uniform4f(this.uXf, d.f.ox, d.f.kx, d.f.oy, d.f.kt);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, d.chunk.count);
    }
    if (near.count > 0 && this.passes & 1) {
      gl.bindVertexArray(this.nearRevVao);
      gl.uniform4f(this.uXf, 0, 1, 0, -1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, near.count);
    }

    // Pass 2: anti-aliased side-edge strips (and whole thin bands), blended back to
    // front, depth-tested against the interiors but not writing depth.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.uniform1i(this.uPass, 2);
    if (near.count > 0 && this.passes & 2) {
      gl.bindVertexArray(this.nearVao);
      gl.uniform4f(this.uXf, 0, 1, 0, -1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, near.count);
    }
    for (const d of this.passes & 2 ? scene.draws : []) {
      const g = d.chunk.gpu as GpuChunk;
      gl.bindVertexArray(g.vao);
      gl.uniform4f(this.uXf, d.f.ox, d.f.kx, d.f.oy, d.f.kt);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, d.chunk.count);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.uniform1i(this.uPass, 0);
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

export function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program link failed');
  return p;
}
