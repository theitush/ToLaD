// Wikipedia link, Wikimedia Commons picture (ToLaD#182) and range map (ToLaD#196) per species, from the data's
// sidecar data/mammals/wiki.json (pipeline `make wiki`), filtered to the fan's species at
// build time (vite.config.ts, `wiki` of `virtual:panthera-data`).
//
// The pictures are hotlinked, never copied (Ita, 2026-10-12). Where they cannot load (no
// network, the Claude artifact's CSP, a dead file), nothing is drawn: the card has no
// picture and the name pills are exactly as without them.

import { wiki as WIKI } from 'virtual:panthera-data';
import { mammalData, mammalsLoaded } from './mammals-data';

export interface WikiRec {
  /** The English Wikipedia article. */
  wp?: string;
  /** A 330 px thumbnail on upload.wikimedia.org (hotlinked). */
  img?: string;
  /** The picture's Commons file page (its credit and licence). */
  file?: string;
  /** The range map (Wikidata P181, ToLaD#196): a 500 px thumbnail on upload.wikimedia.org (hotlinked). */
  range?: string;
  /** The range map's Commons file page (its credit and licence). */
  rangeFile?: string;
}

/** A species' Wikipedia and Commons URLs, or null when Wikidata has neither. */
export function wikiOf(sci: string): WikiRec | null {
  // (The carnivores' rows, then every other mammal's: ToLaD#247.)
  return (WIKI as Record<string, WikiRec | null>)[sci] ?? (mammalsLoaded() ? mammalData().wiki[sci] : null) ?? null;
}

// One image per URL for the page's life: loading, loaded, or failed (null).
const cache = new Map<string, HTMLImageElement | null>();
let redraw: (() => void) | null = null;

/**
 * The species' picture for its name pill, once it has loaded; null before that, on error,
 * with no picture, or with thumbs off. The first ask starts the load; when it arrives the
 * view is asked to redraw once (`request`). Loaded with CORS (upload.wikimedia.org sends
 * `Access-Control-Allow-Origin: *`) so the canvas is never tainted; an image without the
 * header fails and is simply not drawn.
 */
export function labelThumb(sci: string, request: () => void): HTMLImageElement | null {
  const url = wikiOf(sci)?.img;
  if (!url || typeof Image === 'undefined') return null;
  redraw = request;
  const have = cache.get(url);
  if (have !== undefined) return have && have.complete && have.naturalWidth > 0 ? have : null;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  cache.set(url, img);
  img.onload = () => redraw?.();
  img.onerror = () => cache.set(url, null);
  img.src = url;
  return null;
}

/** Draws a loaded thumbnail as a circle of diameter `d` centred at (cx, cy), cropped to a square. */
export function drawThumb(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, d: number): void {
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - s) / 2;
  // Portraits keep their top (heads), landscapes their centre.
  const sy = img.naturalHeight > img.naturalWidth ? (img.naturalHeight - s) * 0.25 : (img.naturalHeight - s) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,23,20,0.8)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2 - 1.5, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, sx, sy, s, s, cx - d / 2 + 1.5, cy - d / 2 + 1.5, d - 3, d - 3);
  ctx.restore();
}
