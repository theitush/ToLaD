/// <reference types="vitest/config" />
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { loadClade } from './src/fan/panthera-extract';

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

/**
 * The carnivores (Carnivora) subtree, with the cat family's own row (ToLaD#146), decoded from ../data/mammals at build time with the v1
 * decoder (src/fan/panthera-extract.ts), so the fan's numbers and curated
 * histories are always the dataset's own.
 */
function pantheraData(): Plugin {
  return {
    name: 'panthera-data',
    resolveId(id) {
      return id === PANTHERA ? '\0' + PANTHERA : null;
    },
    load(id) {
      if (id !== '\0' + PANTHERA) return null;
      for (const f of dataFiles()) this.addWatchFile(join(DATA, f));
      const clade = loadClade((rel) => readFileSync(join(DATA, rel)), 'Carnivora', ['Felidae']);
      return `export default ${JSON.stringify(clade)};`;
    },
  };
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
