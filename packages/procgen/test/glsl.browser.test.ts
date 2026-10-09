/**
 * Runs HASH_GLSL on the GPU (WebGL2, headless Chromium via Playwright) and reads
 * the results back with transform feedback, then compares them with the TS hash.
 * Browser project only.
 */
import { describe, expect, it } from 'vitest';
import { HASH_GLSL } from '../src/glsl.ts';
import { hash3, lowbias32, mix, rand, randFloat } from '../src/hash.ts';
import fixture from './golden.json';
import { HASH_INPUTS } from './golden-cases.ts';

const VS = `#version 300 es
precision highp float;
precision highp int;
${HASH_GLSL}
uniform uint u_seed;
uniform uint u_base;
flat out uvec4 v_out;
flat out uint v_float;
void main() {
  uint i = u_base + uint(gl_VertexID) * 2654435761u;
  v_out = uvec4(lowbias32(i), mixh(i, u_seed), rand(u_seed, i), hash3(i, u_seed, 7u));
  v_float = floatBitsToUint(randFloat(u_seed, i));
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'compile failed');
  return sh;
}

/** Evaluate the shader for `count` vertices; returns 5 uints per vertex. */
function runGpu(gl: WebGL2RenderingContext, seed: number, base: number, count: number): Uint32Array {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.transformFeedbackVaryings(prog, ['v_out', 'v_float'], gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
  gl.useProgram(prog);
  gl.uniform1ui(gl.getUniformLocation(prog, 'u_seed'), seed);
  gl.uniform1ui(gl.getUniformLocation(prog, 'u_base'), base);

  const bytes = count * 5 * 4;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buf);
  gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, bytes, gl.STATIC_READ);
  const tf = gl.createTransformFeedback();
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf);
  gl.enable(gl.RASTERIZER_DISCARD);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, count);
  gl.endTransformFeedback();
  gl.disable(gl.RASTERIZER_DISCARD);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

  const out = new Uint32Array(count * 5);
  gl.bindBuffer(gl.COPY_READ_BUFFER, buf);
  gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, out);
  return out;
}

const f32bits = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0]!;

describe('GLSL hash == TS hash (WebGL2 readback)', () => {
  const gl = document.createElement('canvas').getContext('webgl2');

  it('has a WebGL2 context', () => {
    expect(gl, 'WebGL2 unavailable in this headless browser').not.toBeNull();
    const dbg = gl!.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? gl!.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl!.getParameter(gl!.RENDERER);
    console.log('WebGL2 renderer:', renderer, '|', gl!.getParameter(gl!.VERSION));
  });

  for (const [seed, base] of [
    [0, 0],
    [0xc0ffee, 12345],
    [0xffffffff, 0xfffff000],
  ] as const) {
    it(`matches on 65536 inputs (seed ${seed}, base ${base})`, () => {
      const count = 65536;
      const got = runGpu(gl!, seed, base, count);
      let mismatches = 0;
      for (let v = 0; v < count; v++) {
        const i = (base + Math.imul(v, 2654435761)) >>> 0;
        const want = [lowbias32(i), mix(i, seed), rand(seed, i), hash3(i, seed, 7), f32bits(randFloat(seed, i))];
        for (let c = 0; c < 5; c++) if (got[v * 5 + c] !== want[c]) mismatches++;
      }
      expect(mismatches).toBe(0);
    });
  }

  it('GPU reproduces the committed golden fixture', () => {
    // one vertex per HASH_INPUT: base = input, VertexID = 0
    const lb: number[] = [];
    const mx: number[] = [];
    for (const x of HASH_INPUTS) {
      const r = runGpu(gl!, 0x12345678, x, 1);
      lb.push(r[0]!);
      mx.push(r[1]!);
    }
    expect(lb).toEqual(fixture.lowbias32);
    expect(mx).toEqual(fixture.mix);
  });
});
