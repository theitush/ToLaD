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

export class FanGL {
  readonly gl: WebGL2RenderingContext;
  private rectProg: WebGLProgram;
  private rectVao: WebGLVertexArrayObject;
  private rectBuf: WebGLBuffer;
  private uView: WebGLUniformLocation | null;
  /** The lanes; over them, lines that must stay on top (grid, "now"). */
  readonly under = new RectBatch();
  readonly over = new RectBatch();

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('No WebGL2');
    this.gl = gl;
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
    gl.bindVertexArray(null);
  }

  begin(): void {
    this.under.n = 0;
    this.over.n = 0;
  }

  private rects(b: RectBatch, w: number, h: number): void {
    if (!b.n) return;
    const gl = this.gl;
    gl.useProgram(this.rectProg);
    gl.uniform2f(this.uView, w, h);
    gl.bindVertexArray(this.rectVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, b.f.subarray(0, b.n * 12), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.n);
  }

  /** Draw the frame: lanes, then overlay lines. w, h in CSS px. */
  end(w: number, h: number, dpr: number): void {
    const gl = this.gl;
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
    this.rects(this.under, w, h);
    this.rects(this.over, w, h);
    gl.bindVertexArray(null);
  }
}

/** '#rrggbb' → [r, g, b] in 0–1. */
export function rgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
