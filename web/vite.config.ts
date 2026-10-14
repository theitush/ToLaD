/// <reference types="vitest/config" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { MAMMALS_FILE } from './src/fan/mammals-data';
import { GLOBE_FILE } from './src/fan/globe-data';
import { loadAll, loadClade, trimToFan } from './src/fan/panthera-extract';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '..', 'data', 'mammals');

/** The dataset's files (the cat and carnivore extracts read them; their change rebuilds them in dev). */
function dataFiles(): string[] {
  return ['skeleton.tld', ...readdirSync(join(DATA, 't')).filter((f) => f.endsWith('.tld')).map((f) => `t/${f}`)];
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
      // The card's globe (ToLaD#267): every species' range cells and the land, fetched when a card first shows a map.
      server.middlewares.use('/' + GLOBE_FILE, (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(globeJson());
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: MAMMALS_FILE, source: await mammalsJson(true) });
      this.emitFile({ type: 'asset', fileName: GLOBE_FILE, source: globeJson() });
    },
  };
}

/**
 * mammals.json (fan/mammals-data.ts MammalData): every mammal under the whole dated tree, only the species the fan
 * draws, and the pictures of those the carnivore page leaves out.
 */
function mammalsJson(): string;
function mammalsJson(seeded: true): Promise<string>;
function mammalsJson(seeded = false): string | Promise<string> {
  const clade = trimToFan(loadAll((rel) => readFileSync(join(DATA, rel))));
  const carn = new Set(trimToFan(loadClade((rel) => readFileSync(join(DATA, rel)), 'Carnivora')).species.map((s) => s.sci));
  const wiki = wikiFor(clade.species.map((s) => s.sci).filter((s) => !carn.has(s)));
  if (!seeded) return JSON.stringify({ clade, wiki });
  // The build's: with the level's default layout worked out here (fan/mammals-seed.ts, ToLaD#255), on the clade as the
  // page reads it (through JSON). Dev serves it without: the page works it out.
  return mammalsSeed(JSON.parse(JSON.stringify(clade))).then((seed) => JSON.stringify({ clade, wiki, seed }));
}

/** fan/mammals-seed.ts run in node through a vite server of its own (the virtual data modules resolved). */
async function mammalsSeed(clade: unknown): Promise<unknown> {
  const server = await createServer({
    configFile: false,
    root: here,
    logLevel: 'error',
    plugins: [pantheraData()],
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const m = (await server.ssrLoadModule('/src/fan/mammals-seed.ts')) as { mammalsSeed(c: unknown): Promise<unknown> };
    return await m.mammalsSeed(clade);
  } finally {
    await server.close();
  }
}

/**
 * globe.json (fan/globe-data.ts GlobeData): data/mammals/ranges.json (pipeline `make globe`: PHYLACINE 1.2.1's range
 * cells per species) and the land (src/fan/globe-land.json: Natural Earth 1:110m, public domain, via world-atlas@2.0.2
 * land-110m.json, rings rounded to 0.1 degree; 55 kB, 19 kB gzipped). Without ranges.json, no ranges (every card
 * falls back to the Wikimedia map).
 */
function globeJson(): string {
  const p = join(DATA, 'ranges.json');
  const r = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as { grid: unknown; ranges: unknown }) : { grid: null, ranges: {} };
  const land = JSON.parse(readFileSync(resolve(here, 'src', 'fan', 'globe-land.json'), 'utf8')) as unknown;
  return JSON.stringify({ grid: r.grid, land, ranges: r.ranges });
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
        // Only the entry is inlined; a lazily imported chunk (the card's globe, ToLaD#267) stays a sibling file.
        if (b.type === 'chunk' && name.endsWith('.js') && b.isEntry) {
          // (Vite fills a dynamic import's preload list after this hook; with modulePreload off it is none: void 0.)
          const code = b.code.replace(/<\/script/gi, '<\\/script').replace(/__VITE_PRELOAD__/g, 'void 0');
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
    plugins: [react(), pantheraData(), ...(single ? [inlineAll()] : [])],
    build: single
      ? {
          outDir: 'dist-single',
          assetsInlineLimit: 1e9,
          cssCodeSplit: false,
          modulePreload: false,
          // The lazy globe chunk by a fixed name next to index.html (pages.yml stages it: globe-draw.js). The entry is
          // inlined into index.html, so it too is named at the top level: its import of the chunk is then ./, not ../.
          rollupOptions: { output: { chunkFileNames: '[name].js', entryFileNames: '[name].js' } },
        }
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
      environment: 'node',
      testTimeout: 120_000,
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  };
});
