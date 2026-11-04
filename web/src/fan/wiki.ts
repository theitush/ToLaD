// Wikipedia link, Wikimedia Commons picture (ToLaD#182) and range map (ToLaD#196) per species, from the data's
// sidecar data/mammals/wiki.json (pipeline `make wiki`), filtered to the fan's species at
// build time (vite.config.ts, `wiki` of `virtual:panthera-data`).
//
// The pictures are hotlinked, never copied (Ita, 2026-10-12). Where they cannot load (no
// network, the Claude artifact's CSP, a dead file), the card has no picture and the tree's
// discs show the stub for no photo (drawPic, ToLaD#351, #400).

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

/** `?thumbs=0` turns the name pills' thumbnails off. */
export const thumbsOn = typeof location === 'undefined' || new URLSearchParams(location.search).get('thumbs') !== '0';

/** Whether the species has a picture to show (thumbs on and a URL): its disc's place is kept whether it has loaded or not. */
export function hasPic(sci: string): boolean {
  return thumbsOn && !!wikiOf(sci)?.img;
}

/**
 * The thumbnail width asked of Wikimedia (ToLaD#351): the smallest of its standard widths (20, 40, 60, 120, 250, 330,
 * 500, 960 …; any other is refused with a 400) whose short side still covers a 50 px disc at devicePixelRatio 3
 * (47 px inside its ring: 141 device px; a 3:2 landscape at 250 px is 167 px high).
 */
export const PIC_W = 250;

/** The stored thumbnail URL asked at PIC_W wide instead (never wider than stored); unsized URLs unchanged. */
export function picSrcOf(src: string): string {
  return src.replace(/([/-])(\d+)px-([^/]+)$/, (m, pre: string, w: string, rest: string) => (+w > PIC_W ? `${pre}${PIC_W}px-${rest}` : m));
}

/** How long a loaded picture fades in over its placeholder (ms); after it, no further redraws. */
export const PIC_FADE_MS = 150;
/** The stub's dashes round its ring; its ink (the palette's INK3), the slash's (INK2) and what cuts them (the disc's dark). */
const STUB_DASHES = 10;
const STUB_INK = '#7d8e84';
const STUB_SLASH = '#a9b8ae';
const STUB_CUT = '#0c1714';
/** Most pictures loading at once. */
export const PIC_CAP = 6;

type PicState = 'idle' | 'queued' | 'loading' | 'ready' | 'failed';
interface Pic {
  /** The URLs to try in turn: PIC_W wide, then the stored one. */
  srcs: string[];
  state: PicState;
  img: HTMLImageElement | null;
  /** When it became ready (the fade's start). */
  at: number;
  /** Queued among those on screen. */
  now: boolean;
}

/**
 * The pictures' loader (ToLaD#351): one image per stored URL for the page's life; at most `cap` loading at once, the
 * ones on screen (`want`) before the ones fetched ahead (`ahead`, the last list given replacing the one before);
 * decoded off the main thread (`img.decode()`) before they count as loaded; a URL that fails falls back to the next,
 * the last failing for good (its disc turns to the stub). `onChange` is called when one is ready or has failed for good.
 */
export class PicLoader {
  private readonly pics = new Map<string, Pic>();
  private readonly now: Pic[] = [];
  private later: Pic[] = [];
  private loading = 0;
  onChange: (() => void) | null = null;
  constructor(
    private readonly make: () => HTMLImageElement,
    private readonly clock: () => number,
    readonly cap = PIC_CAP,
  ) {}

  private pic(url: string): Pic {
    let p = this.pics.get(url);
    if (!p) {
      const small = picSrcOf(url);
      this.pics.set(url, (p = { srcs: small === url ? [url] : [small, url], state: 'idle', img: null, at: 0, now: false }));
    }
    return p;
  }

  /** The picture at `url` wanted on screen now: queued before those fetched ahead, if not loading or loaded yet. */
  want(url: string): void {
    const p = this.pic(url);
    if (p.state === 'idle' || (p.state === 'queued' && !p.now)) {
      p.state = 'queued';
      p.now = true;
      this.now.push(p);
      this.pump();
    }
  }

  /** The pictures likely wanted next (what a tap would show), queued after those on screen; replaces the last list. */
  ahead(urls: readonly string[]): void {
    for (const p of this.later) if (p.state === 'queued' && !p.now) p.state = 'idle';
    this.later = [];
    for (const u of urls) {
      const p = this.pic(u);
      if (p.state === 'idle') {
        p.state = 'queued';
        this.later.push(p);
      }
    }
    this.pump();
  }

  /** How many are loading now (≤ cap). */
  get inFlight(): number {
    return this.loading;
  }

  /** The image once loaded and decoded, with how far its fade has gone (0..1); null before that or when it failed. */
  ready(url: string): { img: HTMLImageElement; fade: number } | null {
    const p = this.pics.get(url);
    return p?.state === 'ready' && p.img ? { img: p.img, fade: Math.min(1, Math.max(0, (this.clock() - p.at) / PIC_FADE_MS)) } : null;
  }

  /** Whether the picture failed for good (its disc shows the stub). */
  failed(url: string): boolean {
    return this.pics.get(url)?.state === 'failed';
  }

  private pump(): void {
    while (this.loading < this.cap) {
      const p = this.next();
      if (!p) return;
      this.loading++;
      p.state = 'loading';
      this.load(p, 0);
    }
  }

  private next(): Pic | null {
    for (const q of [this.now, this.later]) {
      while (q.length) {
        const p = q.shift()!;
        if (p.state === 'queued') return p;
      }
    }
    return null;
  }

  private load(p: Pic, k: number): void {
    const img = this.make();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    const done = (ok: boolean) => {
      if (!ok && k + 1 < p.srcs.length) return this.load(p, k + 1);
      this.loading--;
      if (ok) Object.assign(p, { state: 'ready', img, at: this.clock() });
      else p.state = 'failed';
      this.pump();
      this.onChange?.();
    };
    img.src = p.srcs[k];
    // (Decoded off the main thread before it counts as loaded, so its first draw does not stall a frame.)
    if (typeof img.decode === 'function') img.decode().then(() => done(true), () => done(false));
    else {
      img.onload = () => done(true);
      img.onerror = () => done(false);
    }
  }
}

let loader: PicLoader | null = null;
function picLoader(): PicLoader | null {
  if (!loader && typeof Image !== 'undefined') loader = new PicLoader(() => new Image(), () => performance.now());
  return loader;
}

let aheadKey = '';
/**
 * Fetch these species' pictures ahead (ToLaD#351): the view gives what a tap would show next; they load after the
 * pictures on screen, a few at a time. The same list again does nothing.
 */
export function prefetchPics(scis: readonly (string | null | undefined)[]): void {
  const urls = thumbsOn ? scis.flatMap((s) => (s ? (wikiOf(s)?.img ?? []) : [])) : [];
  const key = urls.join('\n');
  if (key === aheadKey) return;
  aheadKey = key;
  picLoader()?.ahead(urls);
}

/** How many of a group's photos its disc tries before its stub (ToLaD#400): a dead file has a relative behind it, a dead network does not walk the whole group. */
export const PIC_TRIES = 3;

/** Whether the species has a photo to show that has not failed for good. */
export function livePic(sci: string, L = picLoader()): boolean {
  return hasPic(sci) && !L?.failed(wikiOf(sci)!.img!);
}

/**
 * The stub for no photo (ToLaD#400): a dashed ring and a camera struck through, all in proportion to `d`, so that it
 * reads as a statement at 22 px and at 50 px, where the loading disc is a plain fill in a whole ring. Paths only.
 */
function drawStub(ctx: CanvasRenderingContext2D, cx: number, cy: number, d: number): void {
  const r = d / 2 - 1.5;
  const line = Math.max(1, d * 0.03);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  // (A whole number of dashes, so that the ring closes on one.)
  const dash = (Math.PI * r) / STUB_DASHES;
  ctx.setLineDash([dash, dash]);
  ctx.strokeStyle = STUB_INK;
  ctx.lineWidth = line;
  ctx.stroke();
  ctx.setLineDash([]);
  // The camera: a body with its viewfinder's hump, the lens cut out.
  const [w, h, hump] = [d * 0.5, d * 0.33, d * 0.065];
  const [x0, y0] = [cx - w / 2, cy - h / 2 + hump / 2];
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, d * 0.05);
  ctx.moveTo(cx - w * 0.22, y0 + h * 0.1);
  ctx.lineTo(cx - w * 0.13, y0 - hump);
  ctx.lineTo(cx + w * 0.13, y0 - hump);
  ctx.lineTo(cx + w * 0.22, y0 + h * 0.1);
  ctx.closePath();
  ctx.fillStyle = STUB_INK;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, y0 + h / 2, h * 0.27, 0, Math.PI * 2);
  ctx.fillStyle = STUB_CUT;
  ctx.fill();
  // The slash: the disc's dark around a line in the name's ink, across the camera and short of the ring.
  const s = r * 0.62;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s, cy + s);
  ctx.lineTo(cx + s, cy - s);
  ctx.strokeStyle = STUB_CUT;
  ctx.lineWidth = line * 2.6;
  ctx.stroke();
  ctx.strokeStyle = STUB_SLASH;
  ctx.lineWidth = line * 1.2;
  ctx.stroke();
}

/**
 * A species' picture as a disc of diameter `d` centred at (cx, cy) (ToLaD#351): its placeholder at once, at its final
 * size and place (a quiet disc in its ring), and the picture fading in over it once loaded (PIC_FADE_MS; `request` is
 * asked for the fade's frames, then never again). With no photo, or one that failed for good, the stub (ToLaD#400):
 * never while one may yet come, and the wiki's rows are in by then (the carnivores' are in the page, the rest arrive
 * with the data any other species is drawn from). Thumbnails off, the placeholder alone. `L` for tests.
 */
export function drawPic(ctx: CanvasRenderingContext2D, sci: string, cx: number, cy: number, d: number, request: () => void, L = picLoader()): void {
  const url = thumbsOn ? wikiOf(sci)?.img : undefined;
  if (url && L) {
    L.onChange = request;
    L.want(url);
  }
  const got = url && L ? L.ready(url) : null;
  const none = thumbsOn && (!url || !!L?.failed(url));
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,23,20,0.8)';
  ctx.fill();
  if (none) {
    drawStub(ctx, cx, cy, d);
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2 - 1.5, 0, Math.PI * 2);
  if (!got || got.fade < 1) {
    // The placeholder: a quiet fill and ring in the app's palette (INK3, #7d8e84).
    ctx.fillStyle = 'rgba(125,142,132,0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(125,142,132,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // (Plain: an initial was tried, ToLaD#351, but a group's face is one species, so its letter, the bats' "E", misleads.)
  }
  if (got) {
    const { img, fade } = got;
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - s) / 2;
    // Portraits keep their top (heads), landscapes their centre.
    const sy = img.naturalHeight > img.naturalWidth ? (img.naturalHeight - s) * 0.25 : (img.naturalHeight - s) / 2;
    ctx.clip();
    ctx.globalAlpha *= fade;
    ctx.drawImage(img, sx, sy, s, s, cx - d / 2 + 1.5, cy - d / 2 + 1.5, d - 3, d - 3);
    if (fade < 1) request();
  }
  ctx.restore();
}

