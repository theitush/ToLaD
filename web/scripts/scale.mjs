// The scale yardstick, one command (ToLaD#343): the synthetic tree (src/fan/synthetic.ts) at each size, opened and
// moved in node (src/fan/scaleperf.test.ts, one process per size and label mode) and in the phone proxy
// (scripts/phoneperf.mjs SYNTH_N, 4x throttle), then each step's growth with N fitted (the exponent b of t ~ N^b).
// On demand only, by hand for speed work: never in the suite, never per change.
//
//   npm run build:single && flock /tmp/tolad-browser.lock node scripts/scale.mjs
//
// Env: NS=7000,70000 (sizes; 1M only by hand, NS=1000000, and it needs tens of GB: research/scale-yardstick.md), MODES=default,cut (cut: ?labels=cut&frame=cut; noorders: ?orders=0), NODE=0 / PHONE=0 (skip one side),
// PHONE_NS=7000,70000 (the phone's sizes; default NS), LOAD_TIMEOUT=ms (phone: a size that has not opened by then is
// recorded as never opening), OUT=<dir> (default scale-out/): node-<n>-<labels>.json, phone-<n>[-load].json, scale.json.
// Run times on this machine, per mode: node 7k ~1 min (~1 GB); 70k ~1 min load only (SCALE_GESTURES=0) but 40-60 min
// with the gestures, its frames ~0.5 s each, and ~6 GB; the phone proxy 7k ~1 min a load, a few with the gestures.
// 1M does not fit (research/scale-yardstick.md).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WEB = resolve(import.meta.dirname, '..');
const OUT = resolve(process.env.OUT || join(WEB, 'scale-out'));
mkdirSync(OUT, { recursive: true });
const NS = (process.env.NS || '7000,70000').split(',').map(Number);
const PHONE_NS = process.env.PHONE_NS ? process.env.PHONE_NS.split(',').map(Number) : NS;
// (Modes: default; cut = ?labels=cut&frame=cut; noorders = ?orders=0, the tree's orders not registered, synthetic-level.ts.)
const LABELS = (process.env.MODES || process.env.LABELS || 'default,cut').split(',');
const NODE_ENV = { default: {}, cut: { TOLAD_LABELS: 'cut', TOLAD_FRAME: 'cut' }, noorders: { SCALE_ORDERS: '0' } };
const PAGE_Q = { default: {}, cut: { Q: 'labels=cut&frame=cut' }, noorders: { Q: 'orders=0' } };
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const run = (cmd, args, env, ms) => {
  const t = Date.now();
  try {
    execFileSync(cmd, args, { cwd: WEB, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit'], timeout: ms });
  } catch (e) {
    console.log(`  (${cmd} ${args.join(' ')}: ${e.signal === 'SIGTERM' ? `stopped after ${ms / 1000} s` : 'failed'})`);
  }
  return (Date.now() - t) / 1000;
};

const res = { node: {}, phone: {}, runSecs: {} };
if (process.env.NODE !== '0')
  for (const n of NS)
    for (const lab of LABELS) {
      const f = join(OUT, `node-${n}-${lab}.json`);
      console.log(`node: n=${n} labels=${lab}`);
      const env = { SCALEPERF: f, SCALE_N: String(n), ...NODE_ENV[lab] };
      res.runSecs[`node-${n}-${lab}`] = run('npx', ['vitest', 'run', 'src/fan/scaleperf.test.ts'], env, 3600e3);
      res.node[`${n}-${lab}`] = read(f);
    }
if (process.env.PHONE !== '0')
  for (const n of PHONE_NS)
    for (const lab of LABELS) {
      const q = PAGE_Q[lab];
      for (const loadOnly of [true, false]) {
        const f = join(OUT, `phone-${n}-${lab}${loadOnly ? '-load' : ''}.json`);
        console.log(`phone: n=${n} labels=${lab}${loadOnly ? ' (load)' : ''}`);
        const env = { SYNTH_N: String(n), JSON_OUT: f, ...q, ...(loadOnly ? { LOADONLY: '1', ONLY: `s${n}-home` } : {}) };
        res.runSecs[`phone-${n}-${lab}${loadOnly ? '-load' : ''}`] = run('node', ['scripts/phoneperf.mjs'], env, 3600e3);
        res.phone[`${n}-${lab}${loadOnly ? '-load' : ''}`] = read(f);
        // (A size that never opens: no gestures to time.)
        if (loadOnly && !(res.phone[`${n}-${lab}-load`] ?? [])[0]?.load) break;
      }
    }

// The exponent b of t ~ a N^b per step, least squares on log-log over the sizes measured.
const fit = (pts) => {
  const p = pts.filter(([n, t]) => n > 0 && t > 0);
  if (p.length < 2) return null;
  const xs = p.map(([n]) => Math.log(n));
  const ys = p.map(([, t]) => Math.log(t));
  const mx = xs.reduce((a, b) => a + b) / xs.length;
  const my = ys.reduce((a, b) => a + b) / ys.length;
  const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return +b.toFixed(2);
};
res.fits = {};
for (const lab of LABELS) {
  const rows = NS.map((n) => [n, res.node[`${n}-${lab}`]]).filter(([, r]) => r);
  const steps = new Set(rows.flatMap(([, r]) => Object.keys(r.load ?? {})));
  for (const s of steps) if (s !== 'bytes') res.fits[`node ${lab} load ${s}`] = fit(rows.map(([n, r]) => [n, r.load[s]]));
  for (const d of ['home', 'order', 'family'])
    for (const g of ['pinch', 'pan', 'flight']) res.fits[`node ${lab} ${d} ${g} p95`] = fit(rows.map(([n, r]) => [n, r.frames?.[d]?.[g]?.p95]));
  res.fits[`node ${lab} rss`] = fit(rows.map(([n, r]) => [n, r.rssMB]));
}
writeFileSync(join(OUT, 'scale.json'), JSON.stringify(res, null, 1));
console.log('\nexponents (t ~ N^b):');
for (const [k, b] of Object.entries(res.fits)) if (b !== null) console.log(`  ${k.padEnd(36)} ${b}`);
console.log(`\n${join(OUT, 'scale.json')}`);
