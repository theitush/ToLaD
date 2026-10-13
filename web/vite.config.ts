/// <reference types="vitest/config" />
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { MAMMALS_FILE } from './src/fan/mammals-data';
import { loadAll, loadClade, trimToFan } from './src/fan/panthera-extract';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '..', 'data', 'mammals');
const VIRTUAL = 'virtual:tolad-data';

function dataFiles(): string[] {
  return ['skeleton.tld', ...readdirSync(join(DATA, 't')).filter((f) => f.endsWith('.tld')).map((f) => `t/${f}`)];
}

function base64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Serves ../data/mammals at /data/mammals in dev and copies it into the build
 * (no committed duplicate). In single-file mode the files are inlined as base64
 * through `virtual:tolad-data` instead.
 */
function toladData(single: boolean): Plugin {
  return {
    name: 'tolad-data',
    resolveId(id) {
      return id === VIRTUAL ? '\0' + VIRTUAL : null;
    },
    load(id) {
      if (id !== '\0' + VIRTUAL) return null;
      if (!single) return 'export const inlineData = null;';
      const obj: Record<string, string> = {};
      for (const f of dataFiles()) obj[f] = base64(readFileSync(join(DATA, f)));
      return `export const inlineData = ${JSON.stringify(obj)};`;
    },
    configureServer(server) {
      server.middlewares.use('/data/mammals', (req, res, next) => {
        const rel = decodeURIComponent(((req as { url?: string }).url ?? "/").split("?")[0]);
        const p = join(DATA, rel);
        if (!p.startsWith(DATA) || !existsSync(p) || statSync(p).isDirectory()) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(p).pipe(res);
      });
    },
    generateBundle() {
      if (single) return;
      for (const f of dataFiles()) this.emitFile({ type: 'asset', fileName: `data/mammals/${f}`, source: readFileSync(join(DATA, f)) });
    },
  };
}

const PANTHERA = 'virtual:panthera-data';
const CARNIVORA = 'virtual:carnivora-data';

/**
 * The cat family (Felidae) subtree, decoded from ../data/mammals at build time with the v1
 * decoder (src/fan/panthera-extract.ts), so the fan's numbers and curated
 * histories are always the dataset's own.
 */
function pantheraData(): Plugin {
  // The order the cats sit in (ToLaD#146): only the species the fan draws (the tile's subspecies and synonym rows left out).
  const ids: Record<string, () => unknown> = {
    [PANTHERA]: () => loadClade((rel) => readFileSync(join(DATA, rel)), 'Felidae'),
    [CARNIVORA]: () => trimToFan(loadClade((rel) => readFileSync(join(DATA, rel)), 'Carnivora')),
  };
  return {
    name: 'panthera-data',
    resolveId(id) {
      return id in ids ? '\0' + id : null;
    },
    load(id) {
      const make = id.startsWith('\0') ? ids[id.slice(1)] : undefined;
      if (!make) return null;
      for (const f of dataFiles()) this.addWatchFile(join(DATA, f));
      if (existsSync(join(DATA, 'wiki.json'))) this.addWatchFile(join(DATA, 'wiki.json'));
      // The pictures and links (ToLaD#182) for every species either level draws.
      const sci = (k: string) => (ids[k]() as { species: { sci: string }[] }).species.map((s) => s.sci);
      const wiki = id === '\0' + PANTHERA ? `\nexport const wiki = ${JSON.stringify(wikiFor(sci(CARNIVORA)))};` : '';
      return `export default ${JSON.stringify(make())};${wiki}`;
    },
    // The mammal level (ToLaD#247) is a sibling file the page fetches when the level opens (fan/mammals-data.ts),
    // not in the page: the default (carnivores) page stays small. Served at /mammals.json in dev, emitted next to
    // index.html in both builds.
    configureServer(server) {
      server.middlewares.use('/' + MAMMALS_FILE, (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(mammalsJson());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: MAMMALS_FILE, source: mammalsJson() });
    },
  };
}

/**
 * mammals.json (fan/mammals-data.ts MammalData): every mammal under the whole dated tree, only the species the fan
 * draws, and the pictures of those the carnivore page leaves out.
 */
function mammalsJson(): string {
  const clade = trimToFan(loadAll((rel) => readFileSync(join(DATA, rel))));
  const carn = new Set(trimToFan(loadClade((rel) => readFileSync(join(DATA, rel)), 'Carnivora')).species.map((s) => s.sci));
  const wiki = wikiFor(clade.species.map((s) => s.sci).filter((s) => !carn.has(s)));
  return JSON.stringify({ clade, wiki });
}

/**
 * The clade's rows of the Wikipedia/Commons sidecar (data/mammals/wiki.json, ToLaD#182): only
 * the species the fan has, so the page does not carry the whole tree's. {} when there is none.
 */
function wikiFor(names: string[]): Record<string, unknown> {
  const p = join(DATA, 'wiki.json');
  if (!existsSync(p)) return {};
  const all = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  return Object.fromEntries(names.filter((n) => n in all).map((n) => [n, all[n]]));
}

/** Single-file build: inline the JS and CSS chunks into index.html. */
function inlineAll(): Plugin {
  return {
    name: 'tolad-inline',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const html = Object.values(bundle).find((b) => b.type === 'asset' && b.fileName.endsWith('.html'));
      if (!html || html.type !== 'asset') return;
      let src = String(html.source);
      for (const [name, b] of Object.entries(bundle)) {
        if (b.type === 'chunk' && name.endsWith('.js')) {
          const code = b.code.replace(/<\/script/gi, '<\\/script');
          const re = new RegExp(`<script[^>]*src="[^"]*${escapeRe(name)}"[^>]*></script>`);
          src = src.replace(re, () => `<script type="module">${code}</script>`);
          src = src.replace(new RegExp(`<link[^>]*href="[^"]*${escapeRe(name)}"[^>]*>`), '');
          delete bundle[name];
        } else if (b.type === 'asset' && name.endsWith('.css')) {
          const re = new RegExp(`<link[^>]*href="[^"]*${escapeRe(name)}"[^>]*>`);
          src = src.replace(re, () => `<style>${String(b.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = src;
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [react(), toladData(single), pantheraData(), ...(single ? [inlineAll()] : [])],
    build: single
      ? { outDir: 'dist-single', assetsInlineLimit: 1e9, cssCodeSplit: false, modulePreload: false }
      : {},
    server: {
      // `npm run dev -- --host` exposes the dev server on the LAN.
      // allowedHosts: true lets tunnel hostnames (cloudflared, ngrok) through.
      allowedHosts: true,
      port: 5173,
    },
    preview: {
      allowedHosts: true,
      port: 4173,
    },
    test: {
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      environment: 'node',
      testTimeout: 120_000,
    },
  };
});
