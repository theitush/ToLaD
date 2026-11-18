/// <reference types="vitest/config" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { packMammals, treeFiles, TREES, type MammalCardFile, type MammalFile, type TreeName } from './src/fan/mammals-data';
import { GLOBE_FILE } from './src/fan/globe-data';
import { loadAll, loadClade, trimToFan, type Fossils } from './src/fan/panthera-extract';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '..', 'data', 'mammals');
/** A tree's dataset (ToLaD#539): data/mammals, or data/amniotes (the mammals grafted in unchanged). */
const dataOf = (tree: TreeName) => resolve(here, '..', 'data', tree);

/** The dataset's files (the cat and carnivore extracts read them; their change rebuilds them in dev). */
function dataFiles(): string[] {
  return ['skeleton.tld', ...readdirSync(join(DATA, 't')).filter((f) => f.endsWith('.tld')).map((f) => `t/${f}`)];
}

/** The test fixtures' fossils (Felidae, Carnivora): what the page shows, every fossil, or the old look with TOLAD_FOSSILS=old (mammals-node.ts reads it too, ToLaD#279). */
const FIXTURE_FOSSILS: Fossils = process.env.TOLAD_FOSSILS === 'old' ? 'phylogeny' : 'all';

const PANTHERA = 'virtual:panthera-data';
const CARNIVORA = 'virtual:carnivora-data';

/**
 * The cat family (Felidae) subtree, decoded from ../data/mammals at build time with the v1
 * decoder (src/fan/panthera-extract.ts), so the fan's numbers and curated
 * histories are always the dataset's own.
 */
function pantheraData(): Plugin {
  let building = false;
  // The order the cats sit in (ToLaD#146): only the species the fan draws (the tile's subspecies and synonym rows left out).
  const ids: Record<string, () => unknown> = {
    [PANTHERA]: () => loadClade((rel) => readFileSync(join(DATA, rel)), 'Felidae', FIXTURE_FOSSILS),
    [CARNIVORA]: () => trimToFan(loadClade((rel) => readFileSync(join(DATA, rel)), 'Carnivora', FIXTURE_FOSSILS)),
  };
  return {
    name: 'panthera-data',
    configResolved(c) {
      building = c.command === 'build';
    },
    resolveId(id) {
      return id in ids ? '\0' + id : null;
    },
    load(id) {
      const make = id.startsWith('\0') ? ids[id.slice(1)] : undefined;
      if (!make) return null;
      for (const f of dataFiles()) this.addWatchFile(join(DATA, f));
      if (existsSync(join(DATA, 'wiki.json'))) this.addWatchFile(join(DATA, 'wiki.json'));
      // The clades are fixtures for tests now (ToLaD#418): the page reaches neither default export, and its bundle
      // drops them (their consumers are marked pure). What it does read from here: the natural level's source, and no
      // pictures (mammals.json holds them all, ToLaD#182); tests and dev keep the carnivores' rows here.
      if (id !== '\0' + PANTHERA) return `export default ${JSON.stringify(make())};`;
      const data = make() as { naturalMeta?: unknown };
      const carn = (ids[CARNIVORA]() as { species: { sci: string }[] }).species.map((s) => s.sci);
      return [
        `export default ${JSON.stringify(data)};`,
        `export const naturalMeta = ${JSON.stringify(data.naturalMeta ?? null)};`,
        `export const wiki = ${JSON.stringify(building ? {} : wikiFor(carn))};`,
      ].join('\n');
    },
    // The mammals (ToLaD#247) are sibling files the page fetches (fan/mammals-data.ts), not in the page, so the page
    // paints before they come: mammals.json on open, mammals-card.json after the first frame (ToLaD#502). Served at
    // /mammals.json and /mammals-card.json in dev, emitted next to index.html in both builds. The same pair with every
    // fossil (mammals-all.json, mammals-all-card.json) is what `?fossils=all` fetches instead (ToLaD#279).
    // The amniotes' pairs the same way (ToLaD#539, `?tree=amniotes`): amniotes.json, amniotes-card.json, amniotes-all.json, amniotes-all-card.json.
    configureServer(server) {
      for (const tree of TREES)
        for (const fossils of ['phylogeny', 'all'] as const) {
          const { open, card } = treeFiles(tree, fossils === 'all');
          const at = (name: string, part: keyof MammalFiles) =>
            server.middlewares.use('/' + name, (_req, res) => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(mammalFiles(fossils, tree)[part]));
            });
          at(open, 'open');
          at(card, 'card');
        }
      // The card's globe (ToLaD#267): every species' range cells and the land, fetched when a card first shows a map.
      server.middlewares.use('/' + GLOBE_FILE, (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(globeJson());
      });
    },
    async generateBundle() {
      for (const tree of TREES)
        for (const fossils of ['phylogeny', 'all'] as const) {
          const f = await mammalFiles(fossils, tree, true);
          const name = treeFiles(tree, fossils === 'all');
          this.emitFile({ type: 'asset', fileName: name.open, source: JSON.stringify(f.open) });
          this.emitFile({ type: 'asset', fileName: name.card, source: JSON.stringify(f.card) });
        }
      this.emitFile({ type: 'asset', fileName: GLOBE_FILE, source: globeJson() });
    },
  };
}

/**
 * mammals.json and mammals-card.json (fan/mammals-data.ts MammalData, split by what the open reads, ToLaD#502): every
 * mammal under the whole dated tree, only the species the fan draws, and their pictures; with `fossils` 'all', the
 * same with every fossil (mammals-all.json, mammals-all-card.json, ToLaD#279).
 */
type MammalFiles = { open: MammalFile; card: MammalCardFile };
function mammalFiles(fossils: Fossils, tree: TreeName): MammalFiles;
function mammalFiles(fossils: Fossils, tree: TreeName, seeded: true): Promise<MammalFiles>;
function mammalFiles(fossils: Fossils, tree: TreeName, seeded = false): MammalFiles | Promise<MammalFiles> {
  const dir = dataOf(tree);
  const clade = trimToFan(loadAll((rel) => readFileSync(join(dir, rel)), fossils));
  const wiki = wikiFor(clade.species.map((s) => s.sci), dir);
  if (!seeded) return packMammals(JSON.parse(JSON.stringify({ clade, wiki })));
  // (Each column of numbers written the way that gzips smaller: the bytes the page downloads.)
  const gz = (s: string) => gzipSync(s).length;
  // The build's: with the level's default layout worked out here (fan/mammals-seed.ts, ToLaD#255), on the clade as the
  // page reads it (through JSON). Dev serves it without: the page works it out.
  // (The dated tree goes in built, splits.ts mammaliaTree: the clade's raw one is left out.)
  return mammalsSeed(JSON.parse(JSON.stringify(clade))).then((ahead) =>
    packMammals(JSON.parse(JSON.stringify({ clade: { ...clade, dated: undefined, datedMeta: undefined }, wiki, ...(ahead as object) })), gz),
  );
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
 * Another dataset's (`dir`, ToLaD#539) is its own wiki.json over data/mammals': data/amniotes/wiki.json (pipeline
 * `make wiki-amniotes`) has the birds and reptiles, and the mammals' rows copied as they are; a species in neither
 * has none. A species with no photo carries its PhyloPic outline from phylopic.json beside it (ToLaD#577), the same way.
 */
function wikiFor(names: string[], dir = DATA): Record<string, unknown> {
  const read = <T,>(d: string, f = 'wiki.json'): Record<string, T> => {
    const p = join(d, f);
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, T>) : {};
  };
  const all = dir === DATA ? read<unknown>(DATA) : { ...read<unknown>(DATA), ...read<unknown>(dir) };
  // Where there is no photo, the PhyloPic outline (ToLaD#577, data/<tree>/phylopic.json, pipeline `make phylopic`; the photo
  // always wins): `ol`, the image's id (the tree's disc), and `olw`, what the card says of it (fan/wiki.ts outlineRec).
  const pp = (d: string): Outlines => ({ images: {}, species: {}, ...read<unknown>(d, 'phylopic.json') }) as Outlines;
  const [m, t] = [pp(DATA), dir === DATA ? null : pp(dir)];
  const images = { ...m.images, ...t?.images };
  const ols = { ...m.species, ...t?.species };
  const rec = (n: string): unknown => {
    const w = (all[n] ?? null) as Record<string, unknown> | null;
    const o = ols[n];
    if (!o || w?.img) return w;
    const [id, group, rank, shows] = o;
    const im = images[id];
    const credit = [im.r, im.a, im.c, im.l, im.u];
    if (credit.some((x) => x.includes('|'))) throw new Error(`phylopic.json: a "|" in image ${id}'s credit`);
    return { ...w, ol: id, olw: [group, rank, shows, credit.join('|')] };
  };
  return Object.fromEntries(names.filter((n) => n in all || n in ols).map((n) => [n, rec(n)]));
}

/** data/<tree>/phylopic.json (pipeline/tolad_pipeline/phylopic.py `sidecar`): each image once, each species its image's id, group, rank and the taxon shown. */
interface Outlines {
  images: Record<string, { r: string; a: string; c: string; l: string; u: string }>;
  species: Record<string, [string, string, string, string]>;
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
