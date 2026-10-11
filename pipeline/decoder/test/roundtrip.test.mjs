// Round-trip test: decode data/mammals/*.tld and compare with the JSON debug
// dump (unquantized values) within the quantization tolerances of FORMAT.md.
//   node --test pipeline/decoder/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFile, describe, profileEdges, Q, KIND_SKELETON, KIND_TILE, HIST_KINDS } from '../tolad-decoder.js';

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

// ---- v1.1: HIST (curated population history) ------------------------------

test('HIST round-trips against debug_top.json history', () => {
  assert.ok(Array.isArray(dump.history) && dump.history.length >= 40, 'history list in debug_top.json');
  // modelled range-loss records (v1.3) are not indexed; the dump keeps a sample of them. Modelled
  // genomic records (ToLaD#64, ~100) are indexed and all in the dump
  assert.equal(sk.meta.hist_index.length, dump.history.filter((h) => h.modelled !== 'rangeloss').length);
  const files = new Map([[-1, sk]]);
  for (const h of dump.history) {
    const w = h.species;
    if (!files.has(h.tile)) files.set(h.tile, load(`t/${h.tile}.tld`));
    const f = files.get(h.tile);
    assert.equal(f.gid(h.row), h.gid, `${w} gid`);
    const got = f.history(h.row);
    assert.ok(got, `${w}: no HIST entry at tile ${h.tile} row ${h.row}`);
    assert.equal(got.species, h.species);
    assert.equal(got.modelled ?? null, h.modelled ?? null, `${w} modelled`);
    // the genomic deep past's join, as a sentence for the card (ToLaD#80)
    assert.equal(got.deep_join ?? null, h.deep_join ?? null, `${w} deep_join`);
    if (h.points.some((p) => p.kind === 'genomic')) assert.match(got.deep_join, /^(First cited point \([^)]*\) is after 1900, so not used as the deep past's level\. )?Genomic curve /, `${w} deep_join`);
    assert.ok(Math.abs(got.G / h.G - 1) < 1e-6, `${w} G`);
    assert.equal(got.points.length, h.points.length, `${w} points`);
    h.points.forEach((p, k) => {
      const q = got.points[k];
      assert.equal(q.year, p.year, `${w} point ${k} year`);
      closeLog(q.n, p.n, LOG_TOL, `${w} point ${k} n`);
      closeLog(q.lo, p.lo, LOG_TOL, `${w} point ${k} lo`);
      closeLog(q.hi, p.hi, LOG_TOL, `${w} point ${k} hi`);
      assert.equal(q.grade, p.grade);
      assert.equal(q.kind, p.kind);
      assert.equal(q.baseline, p.baseline);
      assert.deepEqual(sk.meta.hist_sources[q.cite], { cite: p.cite, url: p.url }, `${w} point ${k} cite`);
    });
    assert.equal(got.segments.length, h.segments.length, `${w} segments`);
    h.segments.forEach((s, k) => {
      const q = got.segments[k];
      assert.ok(Math.abs(q.year0 - s.year0) <= Math.abs(s.year0) * 1e-6 + 1e-3, `${w} seg ${k} year0`);
      assert.ok(Math.abs(q.generations - s.gens) <= s.gens * 1e-6, `${w} seg ${k} gens`);
      closeLog(q.startSize, s.start, LOG_TOL, `${w} seg ${k} start`);
      closeLog(q.endSize, s.end, LOG_TOL, `${w} seg ${k} end`);
      assert.equal(q.grade, s.grade);
      assert.equal(q.kind, s.kind);
    });
  }
});

test('a v1.0 decoder (skips unknown sections) still decodes v1.1 files', async () => {
  const old = await import('./fixtures/tolad-decoder-v1.0.js');
  const paths = ['skeleton.tld', ...new Set(dump.history.filter((h) => h.tile >= 0).map((h) => `t/${h.tile}.tld`))];
  for (const p of paths) {
    const bytes = new Uint8Array(readFileSync(join(DATA, p)));
    const a = old.decodeFile(bytes);
    const b = load(p);
    assert.equal(a.n, b.n, p);
    for (const c of ['CHLD', 'EVER', 'ALIV', 'FLAG', 'GID_', 'PROF']) assert.deepEqual(a.col[c], b.col[c], `${p} ${c}`);
    for (let i = 0; i < Math.min(a.n, 50); i++) assert.equal(a.name(i), b.name(i));
  }
});

// ---- v1.2: NATB (natural, pre-human baseline) -------------------------------

test('NATB round-trips against debug_top.json natural', () => {
  assert.ok(Array.isArray(dump.natural) && dump.natural.length >= 30, 'natural list in debug_top.json');
  const m = sk.meta.natural;
  assert.equal(m.grade, 'D');
  assert.equal(m.kind, 'reconstruction');
  assert.deepEqual(m.fields, ['n', 'lo', 'hi', 'km2_natural', 'km2_current']);
  const files = new Map([[-1, sk]]);
  const names = new Set();
  for (const h of dump.natural) {
    const w = h.species;
    names.add(w);
    if (!files.has(h.tile)) files.set(h.tile, load(`t/${h.tile}.tld`));
    const f = files.get(h.tile);
    assert.equal(f.gid(h.row), h.gid, `${w} gid`);
    assert.equal(f.name(h.row), w);
    assert.equal(f.col.NATB.length, 5 * f.n, `${w}: NATB has 5 codes per row`);
    const got = f.natural(h.row);
    assert.ok(got, `${w}: no NATB entry at tile ${h.tile} row ${h.row}`);
    closeLog(got.n, h.n, LOG_TOL, `${w} n`);
    closeLog(got.lo, h.lo, LOG_TOL, `${w} lo`);
    closeLog(got.hi, h.hi, LOG_TOL, `${w} hi`);
    closeLog(got.km2Natural, h.km2_natural, LOG_TOL, `${w} km2 natural`);
    if (h.km2_current > 0) closeLog(got.km2Current, h.km2_current, LOG_TOL, `${w} km2 current`);
    else assert.equal(got.km2Current, 0);
    assert.ok(got.lo <= got.n && got.n <= got.hi, `${w} lo <= n <= hi`);
  }
  for (const sp of ['Panthera leo', 'Panthera tigris', 'Panthera pardus', 'Panthera onca', 'Panthera uncia']) {
    assert.ok(names.has(sp), `${sp} has a natural baseline`);
  }
  // internal nodes carry none
  for (let i = 0; i < sk.n; i++) if (sk.col.CHLD[i] > 0) assert.equal(sk.natural(i), null);
});

test('HIST: wild species without a cited baseline start at the natural baseline where one exists', () => {
  const nat = new Map(dump.natural.map((h) => [h.species, h]));
  let n = 0;
  let g = 0;
  for (const h of dump.history) {
    if (h.use !== 'counts' || h.component !== 'wild') continue;
    const first = h.segments[0];
    const cited = h.points.some((p) => p.baseline);
    const genomic = h.points.some((p) => p.kind === 'genomic');
    if (genomic) {
      // a genomic deep past beats the natural baseline: its oldest level is held to the band start
      assert.ok(h.segments.every((s) => s.kind !== 'natural'), `${h.species}: genomic beats natural`);
      assert.equal(first.kind, 'held', `${h.species}: oldest genomic level held to the band start`);
      const oldest = h.points.find((p) => p.kind === 'genomic');
      closeLog(first.start * h.L / h.G, oldest.n, LOG_TOL, `${h.species} genomic level`);
      g++;
    } else if (cited) assert.notEqual(first.kind, 'natural', `${h.species}: a cited baseline wins`);
    else if (nat.has(h.species)) {
      assert.equal(first.kind, 'natural', `${h.species}: natural baseline before the first point`);
      assert.equal(first.grade, 'D');
      closeLog(first.start * h.L / h.G, nat.get(h.species).n, LOG_TOL, `${h.species} natural level`);
      n++;
    }
  }
  assert.ok(n >= 5, `${n} curated species start at the natural baseline`);
  // the five Panthera (hand-written [deep]) and the bulk curves of ToLaD#64 (Bergman et al. 2023)
  assert.ok(g >= 100, `${g} species start at their genomic deep past`);
  for (const sp of ['Panthera leo', 'Panthera tigris', 'Panthera pardus', 'Panthera onca', 'Panthera uncia']) {
    const h = dump.history.find((x) => x.species === sp);
    assert.ok(h.points.some((p) => p.kind === 'genomic' && p.cite.startsWith('Armstrong')), `${sp}: Armstrong 2025`);
  }
});

// ---- v1.3: modelled range-loss trend (HIST kind 11) -------------------------

test('HIST: modelled range-loss records run natural -> log-linear -> today, grade D', () => {
  assert.equal(HIST_KINDS[11], 'rangeloss');
  assert.deepEqual(sk.meta.hist_kinds, HIST_KINDS);
  const t = sk.meta.natural.trend;
  assert.equal(t.kind, 'rangeloss');
  assert.equal(t.from_year, 1500);
  const rl = dump.history.filter((h) => h.modelled === 'rangeloss');
  assert.ok(rl.length >= 10, `${rl.length} range-loss records in the dump`);
  for (const h of rl) {
    const w = h.species;
    assert.equal(h.points.length, 2, `${w}: two points`);
    assert.equal(h.points[0].kind, 'rangeloss');
    assert.equal(h.points[0].year, 1500);
    assert.equal(h.points[0].grade, 'D');
    assert.equal(h.segments[0].kind, 'natural', `${w}: natural level held first`);
    closeLog(h.segments[0].start * h.L / h.G, h.points[0].n, LOG_TOL, `${w} natural level`);
    const trend = h.segments.filter((s) => s.kind === 'rangeloss');
    assert.ok(trend.length >= 1, `${w}: a rangeloss span`);
    assert.ok(trend.every((s) => s.grade === 'D'), `${w}: the trend is grade D`);
    const i = h.segments.findIndex((s) => s.kind === 'rangeloss');
    assert.ok(h.segments.slice(0, i).every((s) => s.kind === 'natural'), `${w}: natural, then the trend`);
    assert.equal(h.segments.length - i, trend.length, `${w}: only rangeloss segments after it`);
    const last = h.segments[h.segments.length - 1];
    closeLog(last.end * h.L / h.G, h.points[1].n, 0.05, `${w} ends at today's count`);
    const f = h.tile < 0 ? sk : load(`t/${h.tile}.tld`);
    assert.equal(f.history(h.row).modelled, 'rangeloss', `${w}: META.hist marks it modelled`);
  }
});
