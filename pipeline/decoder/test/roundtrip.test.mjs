// Round-trip test: decode data/mammals/*.tld and compare with the JSON debug
// dump (unquantized values) within the quantization tolerances of FORMAT.md.
//   node --test pipeline/decoder/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFile, describe, profileEdges, Q, KIND_SKELETON, KIND_TILE } from '../tolad-decoder.js';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.TOLAD_DATA || join(here, '..', '..', '..', 'data', 'mammals');
const load = (p) => decodeFile(new Uint8Array(readFileSync(join(DATA, p))));
const dump = JSON.parse(readFileSync(join(DATA, 'debug_top.json'), 'utf8'));
const sk = load('skeleton.tld');

const AGE_TOL = 1.5 / Q.AGE_STEPS_PER_DEX + 1e-6; // dex
const LOG_TOL = 1.5 / Q.LOG16_STEPS_PER_DEX + 1e-6; // dex
const LOHI_TOL = 1.5 / Q.LOHI_STEPS_PER_DEX + 1e-6; // dex
const PROF_TOL = 1.5 / Q.PROFILE_STEPS_PER_DEX + LOG_TOL; // dex

function closeLog(a, b, tol, what) {
  if (a === 0 || b === 0) {
    assert.ok(a === 0 && b === 0 || Math.abs(a - b) < 1e-300, `${what}: ${a} vs ${b}`);
    return;
  }
  const d = Math.abs(Math.log10(a) - Math.log10(b));
  assert.ok(d <= tol, `${what}: ${a} vs ${b} (|Δ|=${d.toFixed(5)} dex > ${tol})`);
}

test('skeleton header and META', () => {
  assert.equal(sk.kind, KIND_SKELETON);
  assert.equal(sk.meta.version, 1);
  assert.equal(sk.n, dump.nodes.length);
  assert.ok(sk.meta.tiles.length > 0);
  assert.equal(sk.meta.quant.profile_k, Q.PROFILE_K);
  assert.equal(sk.meta.quant.age_steps_per_dex, Q.AGE_STEPS_PER_DEX);
  assert.equal(sk.meta.quant.log16_steps_per_dex, Q.LOG16_STEPS_PER_DEX);
});

test('skeleton rows round-trip against debug_top.json', () => {
  for (let i = 0; i < sk.n; i++) {
    const j = dump.nodes[i];
    const w = `row ${i} (${j.name || j.representative})`;
    assert.equal(sk.gid(i), j.gid, w + ' gid');
    assert.equal(sk.name(i), j.name, w + ' name');
    assert.deepEqual(sk.names(i).slice(1), j.alt, w + ' alt');
    assert.equal(sk.col.CHLD[i], j.children, w + ' children');
    const p = sk.parent[i];
    assert.equal(p < 0 ? null : sk.gid(p), j.parent_gid, w + ' parent');
    closeLog(sk.t0(i), j.t0_Ma, AGE_TOL, w + ' t0');
    closeLog(sk.t1(i), j.t1_Ma, AGE_TOL, w + ' t1');
    closeLog(sk.ever(i), j.ever, LOG_TOL, w + ' ever');
    closeLog(sk.alive(i), j.alive, LOG_TOL, w + ' alive');
    closeLog(sk.ghost(i), j.ghost, LOG_TOL, w + ' ghost');
    closeLog(sk.everLo(i), j.ever_lo, LOG_TOL + LOHI_TOL, w + ' lo');
    closeLog(sk.everHi(i), j.ever_hi, LOG_TOL + LOHI_TOL, w + ' hi');
    assert.equal(sk.grade(i), j.grade, w + ' grade');
    assert.equal(sk.extinct(i), j.extinct, w + ' extinct');
    assert.equal(sk.taxonomic(i), j.topology_confidence === 'taxonomic', w + ' taxonomic');
    assert.equal(sk.dateSource(i), j.date_source, w + ' date source');
    assert.equal(sk.ntips(i), j.ntips, w + ' ntips');
    assert.equal(sk.ott(i), j.ott, w + ' ott');
    assert.equal(sk.pbdb(i), j.pbdb, w + ' pbdb');
    assert.equal(sk.isStub(i), j.stub_tile !== null, w + ' stub flag');
    if (j.stub_tile !== null) {
      assert.equal(sk.stubs.get(i).tile, j.stub_tile, w + ' stub tile');
      assert.equal(sk.representative(i), j.representative, w + ' representative');
    }
    const d = describe(sk.meta, sk, i);
    assert.equal(d.method, j.method, w + ' method');
    assert.deepEqual(d.sources, j.sources, w + ' sources');
    const prof = sk.profile(i);
    const peak = Math.max(...j.profile_births_per_yr);
    for (let k = 0; k < Q.PROFILE_K; k++) {
      const want = j.profile_births_per_yr[k];
      if (want < peak * 1e-12) { assert.ok(prof[k] <= peak * 1e-12 * 1.01 || prof[k] === 0, `${w} profile[${k}] ~0`); continue; }
      closeLog(prof[k], want, PROF_TOL, `${w} profile[${k}]`);
    }
  }
});

test('profiles integrate to the ever count (within the profile quantization)', () => {
  for (let i = 0; i < Math.min(sk.n, 200); i++) {
    const e = profileEdges(sk.t0(i), sk.t1(i));
    const p = sk.profile(i);
    let s = 0;
    for (let k = 0; k < Q.PROFILE_K; k++) s += p[k] * (e[k + 1] - e[k]) * 1e6;
    if (sk.ever(i) > 0) closeLog(s, sk.ever(i), 0.1, `row ${i} ∫profile`);
  }
});

test('all tiles decode; stubs resolve to matching tile roots; node total adds up', () => {
  let total = 0;
  const files = [sk];
  for (const t of sk.meta.tiles) {
    const f = load(t.file);
    assert.equal(f.kind, KIND_TILE);
    assert.equal(f.n, t.nodes);
    assert.equal(f.gid(0), t.root_gid);
    assert.equal(f.meta.tile, t.id);
    files.push(f);
  }
  const byTile = new Map(sk.meta.tiles.map((t, k) => [t.id, files[k + 1]]));
  for (const f of files) {
    for (let i = 0; i < f.n; i++) if (!f.isStub(i)) total++;
    for (const [i, s] of f.stubs) {
      const tf = byTile.get(s.tile);
      assert.ok(tf, `stub -> missing tile ${s.tile}`);
      assert.equal(tf.gid(0), f.gid(i), 'stub gid == tile root gid');
      for (const c of ['T0__', 'T1__', 'EVER', 'ALIV', 'GHST', 'PPK_', 'NTIP', 'OTT_', 'PBDB', 'METH', 'SRCM']) {
        assert.equal(tf.col[c][0], f.col[c][i], `stub aggregate ${c}`);
      }
      assert.equal(tf.col.FLAG[0], f.col.FLAG[i] & ~(1 << 7), 'stub flags (minus STUB bit)');
    }
  }
  assert.equal(total, sk.meta.total_nodes);
  // species tips: the root's NTIP equals the number of species rows overall
  let species = 0;
  for (const f of files) for (let i = 0; i < f.n; i++) if (!f.isStub(i) && f.isSpecies(i)) species++;
  assert.equal(sk.ntips(0), species);
});

test('children ages nest inside parents in every file', () => {
  for (const f of [sk, ...sk.meta.tiles.map((t) => load(t.file))]) {
    for (let i = 1; i < f.n; i++) {
      const p = f.parent[i];
      assert.ok(f.col.T0__[i] <= f.col.T0__[p], `t0 child <= parent (row ${i})`);
    }
  }
});

test('MOCK individuals are flagged as mock in data and name', () => {
  const m = sk.meta.mock_individuals;
  assert.ok(m.length >= 3);
  for (const x of m) {
    assert.equal(x.mock, true);
    assert.ok(x.name.startsWith('MOCK'), x.name);
    const f = x.tile < 0 ? sk : load(`t/${x.tile}.tld`);
    assert.equal(f.name(x.index), x.species);
    assert.equal(f.gid(x.index), x.species_gid);
  }
});
