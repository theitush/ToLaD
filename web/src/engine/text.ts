// SDF text in WebGL2: glyphs are rasterised once with Canvas2D, turned into a
// signed distance field (Felzenszwalb EDT, the tiny-sdf method) and packed into
// a single-channel atlas. Every label, tick and rule on screen is then one
// instanced quad, all in one draw call per frame. Text can be horizontal or
// rotated to read bottom-to-top along a band.

const FONT_PX = 32; // glyph size in the atlas
const BUFFER = 4;
const RADIUS = 8;
const CUTOFF = 0.25;
const ATLAS_W = 1024;
const ATLAS_H = 512;
const FONT = `600 ${FONT_PX}px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const INF = 1e20;

interface Glyph {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bearing: offset of the bitmap's top-left from the pen at the baseline (atlas px). */
  left: number;
  top: number;
  advance: number;
}

/** Floats per text instance: pos(x,y,w,h) uv(u0,v0,u1,v1) color(r,g,b,a) xf(ox,oy,rot,halo). */
const TF = 16;

export class GlyphAtlas {
  readonly data = new Uint8Array(ATLAS_W * ATLAS_H);
  private glyphs = new Map<string, Glyph | null>();
  private ctx: CanvasRenderingContext2D;
  private shelfX = 0;
  private shelfY = 0;
  private shelfH = 0;
  dirty = true;
  /** A solid (fully inside) block for rules and ticks. */
  readonly solid: Glyph;
  private f = new Float64Array(64);
  private z = new Float64Array(65);
  private v = new Uint16Array(64);

  constructor() {
    const size = FONT_PX + BUFFER * 4;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    this.ctx = c.getContext('2d', { willReadFrequently: true })!;
    this.ctx.font = FONT;
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.textAlign = 'left';
    this.ctx.fillStyle = 'black';
    const s = this.alloc(4, 4)!;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) this.data[(s.y + y) * ATLAS_W + s.x + x] = 255;
    this.solid = { x: s.x + 1, y: s.y + 1, w: 2, h: 2, left: 0, top: 0, advance: 0 };
  }

  private alloc(w: number, h: number): { x: number; y: number } | null {
    if (this.shelfX + w + 1 > ATLAS_W) {
      this.shelfY += this.shelfH + 1;
      this.shelfX = 0;
      this.shelfH = 0;
    }
    if (this.shelfY + h > ATLAS_H) return null;
    const out = { x: this.shelfX, y: this.shelfY };
    this.shelfX += w + 1;
    this.shelfH = Math.max(this.shelfH, h);
    return out;
  }

  /** Pen advance of a string, in atlas px. */
  measure(s: string): number {
    let w = 0;
    for (const ch of s) w += this.get(ch)?.advance ?? FONT_PX * 0.5;
    return w;
  }

  get(ch: string): Glyph | null {
    let g = this.glyphs.get(ch);
    if (g !== undefined) return g;
    g = this.raster(ch);
    this.glyphs.set(ch, g);
    return g;
  }

  private raster(ch: string): Glyph | null {
    const ctx = this.ctx;
    const m = ctx.measureText(ch);
    const advance = m.width;
    const size = FONT_PX + BUFFER * 4;
    const top = Math.ceil(m.actualBoundingBoxAscent);
    const left = Math.floor(-m.actualBoundingBoxLeft) || 0;
    const gw = Math.max(0, Math.min(size - BUFFER, Math.ceil(m.actualBoundingBoxRight - left)));
    const gh = Math.min(size - BUFFER, top + Math.ceil(m.actualBoundingBoxDescent));
    if (gw <= 0 || gh <= 0) return { x: 0, y: 0, w: 0, h: 0, left: 0, top: 0, advance };
    const w = gw + 2 * BUFFER;
    const h = gh + 2 * BUFFER;
    const pos = this.alloc(w, h);
    if (!pos) return null;
    ctx.clearRect(0, 0, size, size);
    ctx.fillText(ch, BUFFER - left, BUFFER + top);
    const img = ctx.getImageData(0, 0, w, h).data;
    const len = w * h;
    const outer = new Float64Array(len);
    const inner = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      const a = img[4 * i + 3] / 255;
      if (a === 1) {
        outer[i] = 0;
        inner[i] = INF;
      } else if (a === 0) {
        outer[i] = INF;
        inner[i] = 0;
      } else {
        const d = 0.5 - a;
        outer[i] = d > 0 ? d * d : 0;
        inner[i] = d < 0 ? d * d : 0;
      }
    }
    this.edt(outer, w, h);
    this.edt(inner, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
        this.data[(pos.y + y) * ATLAS_W + pos.x + x] = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / RADIUS + CUTOFF))));
      }
    }
    this.dirty = true;
    return { x: pos.x, y: pos.y, w, h, left: left - BUFFER, top: top + BUFFER, advance };
  }

  private edt(grid: Float64Array, w: number, h: number): void {
    const n = Math.max(w, h);
    if (this.f.length < n) {
      this.f = new Float64Array(n);
      this.z = new Float64Array(n + 1);
      this.v = new Uint16Array(n);
    }
    for (let x = 0; x < w; x++) this.edt1d(grid, x, w, h);
    for (let y = 0; y < h; y++) this.edt1d(grid, y * w, 1, w);
  }

  private edt1d(grid: Float64Array, offset: number, stride: number, length: number): void {
    const { f, v, z } = this;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    f[0] = grid[offset];
    for (let q = 1, k = 0, s = 0; q < length; q++) {
      f[q] = grid[offset + q * stride];
      const q2 = q * q;
      do {
        const r = v[k];
        s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
      } while (s <= z[k] && --k > -1);
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    for (let q = 0, k = 0; q < length; q++) {
      while (z[k + 1] < q) k++;
      const r = v[k];
      const qr = q - r;
      grid[offset + q * stride] = f[r] + qr * qr;
    }
  }
}

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 a_pos;  // x y w h (text space, CSS px)
layout(location = 1) in vec4 a_uv;
layout(location = 2) in vec4 a_col;
layout(location = 3) in vec4 a_xf;   // ox oy rot halo
uniform vec2 u_view;                 // CSS px
out vec2 v_uv;
out vec4 v_col;
out float v_halo;
void main() {
  int c = gl_VertexID;
  float cx = (c == 1 || c == 4 || c == 5) ? 1.0 : 0.0;
  float cy = (c == 2 || c == 3 || c == 5) ? 1.0 : 0.0;
  vec2 p = a_pos.xy + vec2(cx, cy) * a_pos.zw;
  vec2 s = a_xf.z > 0.5 ? vec2(a_xf.x + p.y, a_xf.y - p.x) : a_xf.xy + p;
  gl_Position = vec4(s.x / u_view.x * 2.0 - 1.0, 1.0 - s.y / u_view.y * 2.0, 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, vec2(cx, cy));
  v_col = a_col;
  v_halo = a_xf.w;
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
in vec4 v_col;
in float v_halo;
out vec4 o;
void main() {
  float d = texture(u_tex, v_uv).r;
  float w = max(fwidth(d) * 0.75, 0.01);
  float a = smoothstep(0.75 - w, 0.75 + w, d) * v_col.a;
  float h = v_halo > 0.0 ? smoothstep(0.75 - v_halo - w, 0.75 - v_halo + w, d) * 0.82 : 0.0;
  vec3 halo = vec3(0.03, 0.05, 0.04);
  float outA = a + h * (1.0 - a);
  vec3 col = v_col.rgb * a + halo * h * (1.0 - a);
  o = vec4(col, outA);
}`;

export type RGBA = [number, number, number, number];

/** Collects glyph / rule instances for one frame. */
export class TextBatch {
  data = new Float32Array(TF * 512);
  count = 0;
  constructor(readonly atlas: GlyphAtlas) {}

  reset(): void {
    this.count = 0;
  }

  private push(x: number, y: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number, col: RGBA, ox: number, oy: number, rot: number, halo: number): void {
    if ((this.count + 1) * TF > this.data.length) {
      const d = new Float32Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
    const o = this.count * TF;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = w;
    d[o + 3] = h;
    d[o + 4] = u0;
    d[o + 5] = v0;
    d[o + 6] = u1;
    d[o + 7] = v1;
    d[o + 8] = col[0];
    d[o + 9] = col[1];
    d[o + 10] = col[2];
    d[o + 11] = col[3];
    d[o + 12] = ox;
    d[o + 13] = oy;
    d[o + 14] = rot;
    d[o + 15] = halo;
    this.count++;
  }

  /** Width of a string at `size` CSS px. */
  width(s: string, size: number): number {
    return (this.atlas.measure(s) * size) / FONT_PX;
  }

  /**
   * Draw text with its baseline-left (or, if `center`, its middle) at (ox, oy).
   * rot = true: rotated to read bottom-to-top, the anchor is then the middle.
   */
  text(s: string, ox: number, oy: number, size: number, col: RGBA, opts: { center?: boolean; rot?: boolean; halo?: number } = {}): void {
    const k = size / FONT_PX;
    const tw = this.width(s, size);
    let pen = opts.center || opts.rot ? -tw / 2 : 0;
    // Vertical centring: cap height ≈ 0.7 size.
    const base = opts.center || opts.rot ? size * 0.35 : 0;
    const halo = opts.halo ?? 0.32;
    for (const ch of s) {
      const g = this.atlas.get(ch);
      if (!g) {
        pen += size * 0.5;
        continue;
      }
      if (g.w > 0) {
        const x = pen + g.left * k;
        const y = base - g.top * k;
        this.push(x, y, g.w * k, g.h * k, g.x / ATLAS_W, g.y / ATLAS_H, (g.x + g.w) / ATLAS_W, (g.y + g.h) / ATLAS_H, col, ox, oy, opts.rot ? 1 : 0, halo);
      }
      pen += g.advance * k;
    }
  }

  /** Solid axis-aligned rectangle (CSS px). */
  rect(x: number, y: number, w: number, h: number, col: RGBA): void {
    const g = this.atlas.solid;
    this.push(0, 0, w, h, g.x / ATLAS_W, g.y / ATLAS_H, (g.x + g.w) / ATLAS_W, (g.y + g.h) / ATLAS_H, col, x, y, 0, 0);
  }
}

export class TextRenderer {
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buf: WebGLBuffer;
  private tex: WebGLTexture;
  private uView: WebGLUniformLocation;
  private cap = 0;

  constructor(
    readonly gl: WebGL2RenderingContext,
    readonly atlas: GlyphAtlas,
    link: (gl: WebGL2RenderingContext, vs: string, fs: string) => WebGLProgram,
  ) {
    this.prog = link(gl, VS, FS);
    this.uView = gl.getUniformLocation(this.prog, 'u_view')!;
    this.buf = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, TF * 4, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  draw(batch: TextBatch, cssW: number, cssH: number): void {
    if (batch.count === 0) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (this.atlas.dirty) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, ATLAS_W, ATLAS_H, 0, gl.RED, gl.UNSIGNED_BYTE, this.atlas.data);
      this.atlas.dirty = false;
    }
    gl.useProgram(this.prog);
    gl.uniform2f(this.uView, cssW, cssH);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const n = batch.count * TF;
    if (n > this.cap) {
      this.cap = Math.max(n, this.cap * 2);
      gl.bufferData(gl.ARRAY_BUFFER, this.cap * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, n);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.count);
    gl.bindVertexArray(null);
  }
}
