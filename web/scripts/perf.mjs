// Headless mobile-emulation performance run.
//
//   npm run build && npm run perf
//
// Serves dist/ with `vite preview`, opens it in headless Chromium (Playwright)
// with a 390x844 viewport, DPR 3, touch, and 4x CPU throttling via CDP, then
// scripts real touch pinches/pans (CDP Input.dispatchTouchEvent → Pointer
// Events) and animated dives down to 1000+ levels, recording every frame.
//
// Headless Chromium renders WebGL with SwiftShader (software GL), so GPU cost
// lands on the CPU and is NOT representative of a phone GPU. Treat the numbers
// as a CPU-side stress test; real-device testing is still required.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4179;
const OUT = process.env.PERF_OUT || 'perf-out';
const THROTTLE = Number(process.env.PERF_THROTTLE || 4);
/** PERF_SYNTH=1: the spike's synthetic 1000-level dives instead of the mammal data. */
const SYNTH = !!process.env.PERF_SYNTH;
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && resolve());
  server.on('exit', (c) => reject(new Error(`preview exited ${c}`)));
  setTimeout(() => reject(new Error('preview did not start')), 20000);
});

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let exitCode = 0;
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cdp = await context.newCDPSession(page);
  await page.goto(`http://localhost:${PORT}/${SYNTH ? '?synthetic&debug' : ''}`);
  await page.waitForFunction(() => !!window.__tolad, null, { timeout: 20000 });
  await sleep(SYNTH ? 500 : 2500);
  const glInfo = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no webgl2';
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.screenshot({ timeout: 120000, path: `${OUT}/0-${SYNTH ? 'root' : 'opening'}.png` });

  const W = 390;
  const H = 844;
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })),
    });

  /** Two-finger pinch about (cx, cy): finger spread goes d0 → d1 over `steps` moves. */
  async function pinch(cx, cy, d0, d1, steps = 24, angle = 1.2) {
    const pts = (d) => {
      const dx = (Math.cos(angle) * d) / 2;
      const dy = (Math.sin(angle) * d) / 2;
      return [
        [cx - dx, cy - dy],
        [cx + dx, cy + dy],
      ];
    };
    await touch('touchStart', pts(d0));
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', pts(d0 + ((d1 - d0) * i) / steps));
      await sleep(8);
    }
    await touch('touchEnd', []);
  }

  async function pan(x0, y0, x1, y1, steps = 16) {
    await touch('touchStart', [[x0, y0]]);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]);
      await sleep(8);
    }
    await touch('touchEnd', []);
  }

  const phases = [];
  async function phase(name, fn) {
    await page.evaluate(() => window.__tolad.startRecording());
    const t0 = Date.now();
    await fn();
    await sleep(400); // let inertia settle
    const rec = await page.evaluate(() => window.__tolad.stopRecording());
    const info = await page.evaluate(() => window.__tolad.info());
    const iv = rec.map((r) => r.interval).filter((v) => Number.isFinite(v));
    const cpu = rec.map((r) => r.cpu);
    const stat = (a) => {
      if (!a.length) return { avg: 0, p95: 0, max: 0 };
      const s = [...a].sort((x, y) => x - y);
      return { avg: s.reduce((x, y) => x + y, 0) / s.length, p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
    };
    const p = {
      name,
      seconds: (Date.now() - t0) / 1000,
      frames: rec.length,
      interval: stat(iv),
      cpu: stat(cpu),
      maxInstances: Math.max(0, ...rec.map((r) => r.instances)),
      depthRange: [Math.min(...rec.map((r) => r.depth)), Math.max(...rec.map((r) => r.depth))],
      endDepth: info.anchorDepth,
      zoomExp: [Number(info.xExp.toFixed(1)), Number(info.tExp.toFixed(1))],
      fb: info.fb,
    };
    phases.push(p);
    const f = (v) => v.toFixed(1).padStart(6);
    console.log(
      `${name.padEnd(28)} frames ${String(p.frames).padStart(5)}  interval avg ${f(p.interval.avg)} p95 ${f(p.interval.p95)}  ` +
        `cpu avg ${f(p.cpu.avg)} p95 ${f(p.cpu.p95)} ms  inst<=${p.maxInstances}  depth ${p.depthRange.join('..')}`,
    );
  }

  if (SYNTH) {
    await phase('pinch+pan at root', async () => {
      for (let i = 0; i < 3; i++) {
        await pinch(W / 2, H * 0.55, 80, 300);
        await pan(200, 600, 140, 420);
      }
    });
    await page.screenshot({ timeout: 120000, path: `${OUT}/1-shallow.png` });

    await phase('animated dive 0 -> ~60', async () => {
      await page.evaluate(() => window.__tolad.diveAnimated(60, 11));
    });
    await page.screenshot({ timeout: 120000, path: `${OUT}/2-depth60.png` });

    await page.evaluate(() => window.__tolad.diveInstant(940, 12));
    await sleep(300);

    await phase('pinch+pan at ~1000 levels', async () => {
      for (let i = 0; i < 4; i++) {
        await pinch(W / 2, H / 2, 80, 280);
        await pan(250, 500, 150, 380);
        await pinch(W / 2, H / 2, 260, 120);
      }
    });
    await page.screenshot({ timeout: 120000, path: `${OUT}/3-depth1000.png` });

    await phase('animated dive ~1000 -> ~1060', async () => {
      await page.evaluate(() => window.__tolad.diveAnimated(60, 13));
    });
    await page.screenshot({ timeout: 120000, path: `${OUT}/4-depth1060.png` });

    await phase('log/linear toggle + pinch deep', async () => {
      await page.evaluate(() => window.__tolad.setMode(1));
      await sleep(900);
      await pinch(W / 2, H / 2, 100, 260);
      await page.evaluate(() => window.__tolad.setMode(0));
      await sleep(900);
    });
  } else {
    const fly = async (name, file) => {
      const ok = await page.evaluate((n) => window.__toladApp.flyToName(n), name);
      if (!ok) errors.push(`flyToName(${name}) failed`);
      await sleep(2200);
      await page.screenshot({ timeout: 120000, path: `${OUT}/${file}` });
    };
    await phase('pinch+pan at root (Mammalia)', async () => {
      for (let i = 0; i < 3; i++) {
        await pinch(W / 2, H * 0.55, 80, 300);
        await pan(200, 600, 140, 420);
      }
    });
    await page.screenshot({ timeout: 120000, path: `${OUT}/1-after-pinch.png` });
    await phase('fly to Primates', () => fly('Primates', '2-primates.png'));
    await phase('pinch+pan in Primates', async () => {
      for (let i = 0; i < 2; i++) {
        await pinch(W / 2, H * 0.4, 80, 300);
        await pan(200, 300, 160, 500);
        await pinch(W / 2, H * 0.4, 260, 110);
      }
    });
    await fly('Homo sapiens', '3-homo-sapiens.png');
    await fly('Mammuthus', '4-mammuthus.png');
    await page.evaluate(() => window.__tolad.resetView());
    await sleep(1600);
    await page.screenshot({ timeout: 120000, path: `${OUT}/5-root-linear.png` });
    await phase('log/linear toggle at root', async () => {
      await page.evaluate(() => window.__tolad.setMode(1));
      await sleep(1000);
    });
    await page.screenshot({ timeout: 120000, path: `${OUT}/6-root-log.png` });
    await fly('Primates', '7-primates-log.png');
    await page.evaluate(() => window.__tolad.setMode(0));
    await page.evaluate(() => window.__tolad.resetView());
    await sleep(1600);
    await phase('animated dive root -> leaf', async () => {
      await page.evaluate(() => window.__tolad.diveAnimated(60, 11));
    });
    await page.screenshot({ timeout: 120000, path: `${OUT}/8-dive-leaf.png` });
    const tiles = await page.evaluate(() => [...window.__toladApp.source.files.keys()]);
    console.log(`tiles loaded: ${tiles.length - 1} of 15`);
  }

  // Single-file build from file:// with all network blocked.
  const single = resolve('dist-single/index.html');
  if (!SYNTH && existsSync(single)) {
    const p2 = await context.newPage();
    const blocked = [];
    await p2.route(/^(https?|wss?):/, (r) => {
      blocked.push(r.request().url());
      return r.abort();
    });
    p2.on('pageerror', (e) => errors.push('single: ' + String(e)));
    await p2.goto(pathToFileURL(single).href);
    await p2.waitForFunction(() => !!window.__tolad, null, { timeout: 20000 });
    await sleep(2500);
    const labels = await p2.evaluate(() => window.__tolad.labels?.count ?? 0);
    await p2.screenshot({ timeout: 120000, path: `${OUT}/9-single-file.png` });
    console.log(`single-file from file://: ok, ${labels} labels, ${blocked.length} network requests blocked`);
    if (blocked.length) errors.push('single-file made network requests: ' + blocked.join(', '));
    await p2.close();
  }

  const summary = { date: new Date().toISOString(), renderer: glInfo, throttle: THROTTLE, viewport: '390x844@3 (backing store capped at DPR 2)', phases, errors };
  writeFileSync(`${OUT}/perf.json`, JSON.stringify(summary, null, 2));
  console.log(`\nWebGL renderer: ${glInfo}`);
  console.log(`CPU throttling: ${THROTTLE}x. Screenshots and perf.json in ${OUT}/`);
  if (errors.length) {
    console.log('Page errors:\n' + errors.join('\n'));
    exitCode = 1;
  }
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
process.exit(exitCode);
