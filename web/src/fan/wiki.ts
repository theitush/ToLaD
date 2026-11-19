// Wikipedia link, Wikimedia Commons picture (ToLaD#182) and range map (ToLaD#196) per species, from the data's
// sidecar data/mammals/wiki.json (pipeline `make wiki`), filtered to the fan's species at
// build time (vite.config.ts, `wiki` of `virtual:panthera-data`).
//
// The pictures are hotlinked, never copied (Ita, 2026-10-12). Where they cannot load (no
// network, the Claude artifact's CSP, a dead file), the card has no picture and the tree's
// discs show the stub for no photo (drawPic, ToLaD#351, #400).

import { wiki as WIKI } from 'virtual:panthera-data';
import { mammalCardLoaded, mammalData, mammalsLoaded } from './mammals-data';

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
  /**
   * Where there is no photo, a PhyloPic outline (ToLaD#577, data/<tree>/phylopic.json, pipeline `make phylopic`): its
   * own, else its nearest relative's up the dated tree. `ol`, the image's id on images.phylopic.org (its 192 px square
   * thumbnail, hotlinked, black on transparent; the page tints it); `olw` (the card's), the group it stands for, its
   * rank, the taxon the image shows, and the image's credit as "raster size|artist|contributor|licence|licence URL"
   * (outlineRec reads them).
   */
  ol?: string;
  olw?: [string, string, string, string];
}

/** A species' Wikipedia and Commons URLs, or null when Wikidata has neither. */
export function wikiOf(sci: string): WikiRec | null {
  // (The first table is empty in the page, ToLaD#418: mammals.json holds every species'. Tests and dev have the carnivores' there.)
  return (WIKI as Record<string, WikiRec | null>)[sci] ?? (mammalsLoaded() ? mammalData().wiki[sci] : null) ?? null;
}

/** `?thumbs=0` turns the name pills' thumbnails off. */
export const thumbsOn = typeof location === 'undefined' || new URLSearchParams(location.search).get('thumbs') !== '0';

/**
 * The pictures (ToLaD#577, `?outlines=off`): photos, and a PhyloPic outline where there is none (the page), or photos
 * only (the old look, the stub where there is none). The photo always wins where there is one.
 */
export type PicLook = 'outlines' | 'photos';
let picLookNow: PicLook = 'outlines';
export const picLook = (): PicLook => picLookNow;
export const setPicLook = (m: PicLook): void => {
  picLookNow = m;
  aheadKey = '';
};

/** PhyloPic's image host: an image's files under its id. */
export const OUTLINE_HOST = 'https://images.phylopic.org/images/';
/** An outline's 192 px square thumbnail (the tree's disc): the smallest of PhyloPic's steps (64, 128, 192) that covers a 50 px disc at devicePixelRatio 3. */
export const outlineThumb = (id: string): string => `${OUTLINE_HOST}${id}/thumbnail/192x192.png`;

/** A species' outline as the card shows it (ToLaD#577): its URLs, what it stands for, and its credit. */
export interface Outline {
  id: string;
  thumb: string;
  /** The raster (the card's box), 512 px wide (a tall one taller); the thumbnail before the card's data is in. */
  big: string;
  /** The group it stands for (the species itself, its genus, a split above it) and its rank; absent before the card's data is in. */
  of?: string;
  rank?: string;
  /** The taxon the image shows: a relative's, where it is not its own. */
  shows?: string;
  /** The artist (else the contributor), the licence and its URL. */
  by?: string;
  lic?: string;
  licUrl?: string;
}

/** A record's outline, read (WikiRec `ol`, `olw`); null when it has none. */
export function outlineRec(w: WikiRec | null | undefined): Outline | null {
  if (!w?.ol) return null;
  const [of, rank, shows, credit] = w.olw ?? [];
  const [r, a, c, l, u] = credit ? credit.split('|') : [];
  const thumb = outlineThumb(w.ol);
  return { id: w.ol, thumb, big: r ? `${OUTLINE_HOST}${w.ol}/raster/${r}.png` : thumb, of, rank, shows, by: a || c || undefined, lic: l || undefined, licUrl: u || undefined };
}

/**
 * Whether a species with no photo may yet have an outline (ToLaD#577): its `ol` is in the card's file (mammals-card.json,
 * WIKI_CARD_KINDS), fetched after the first frame so the open pays nothing for it; until it is in, its disc holds the
 * placeholder, not the stub. (The dev and test table, `virtual:panthera-data`'s, has the whole record.)
 */
export function outlineWaits(sci: string): boolean {
  if (!thumbsOn || picLookNow !== 'outlines' || sci in (WIKI as Record<string, unknown>)) return false;
  if (!mammalsLoaded() || mammalCardLoaded()) return false;
  const w = mammalData().wiki[sci];
  return !w?.img && !w?.ol;
}

/** The species' outline URL to draw: thumbs and outlines on, no photo, and an outline. */
export function outlineOf(sci: string): string | undefined {
  const w = thumbsOn && picLookNow === 'outlines' ? wikiOf(sci) : null;
  return w && !w.img && w.ol ? outlineThumb(w.ol) : undefined;
}

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
/** An outline's ink on the dark disc (ToLaD#577): the palette's INK2, light but under a photo's colour. */
export const OUTLINE_INK = '#a9b8ae';
/** The outline's square inside the disc, as a share of its inner diameter: the inscribed square (1/√2) and a little, so a long body's ends stay off the ring. */
export const OUTLINE_FIT = 0.74;
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
let aheadKey = '';
function picLoader(): PicLoader | null {
  if (!loader && typeof Image !== 'undefined') loader = new PicLoader(() => new Image(), () => performance.now());
  return loader;
}

/**
 * Fetch these species' pictures ahead (ToLaD#351): the view gives what a tap would show next; they load after the
 * pictures on screen, a few at a time. The same list again does nothing.
 */
export function prefetchPics(scis: readonly (string | null | undefined)[]): void {
  const urls = thumbsOn ? scis.flatMap((s) => (s ? (wikiOf(s)?.img ?? outlineOf(s) ?? []) : [])) : [];
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
 * The species card draws it too, in the picture's box (ToLaD#492).
 */
export function drawStub(ctx: CanvasRenderingContext2D, cx: number, cy: number, d: number): void {
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
  const photo = thumbsOn ? wikiOf(sci)?.img : undefined;
  // No photo: its PhyloPic outline (ToLaD#577), loaded like a photo, tinted light; with none, or once it fails, the stub.
  const ol = photo ? undefined : outlineOf(sci);
  const url = photo ?? ol;
  if (url && L) {
    L.onChange = request;
    L.want(url);
  }
  const got = url && L ? L.ready(url) : null;
  // (No URL while the card's file may yet bring an outline: the placeholder, not the stub, outlineWaits.)
  const none = thumbsOn && (url ? !!L?.failed(url) : !outlineWaits(sci));
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
  if (ol) {
    drawOutlineDisc(ctx, got, cx, cy, d, request);
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

/** The tinted copy of each outline (ToLaD#577): drawn once, its black turned to OUTLINE_INK; null where no canvas can be had. */
const tinted = new WeakMap<HTMLImageElement, CanvasImageSource | null>();
function tintOf(img: HTMLImageElement): CanvasImageSource | null {
  let t = tinted.get(img);
  if (t === undefined) {
    t = null;
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const g = c?.getContext('2d');
    if (c && g && img.naturalWidth) {
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = OUTLINE_INK;
      g.fillRect(0, 0, c.width, c.height);
      t = c;
    }
    tinted.set(img, t);
  }
  return t;
}

/**
 * An outline in its disc (ToLaD#577): on the photo's placeholder (its quiet fill and whole ring, kept under it), the
 * silhouette tinted and fitted inside (OUTLINE_FIT of the disc), fading in like a photo. Inside drawPic's save.
 */
function drawOutlineDisc(ctx: CanvasRenderingContext2D, got: { img: HTMLImageElement; fade: number } | null, cx: number, cy: number, d: number, request: () => void): void {
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2 - 1.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(125,142,132,0.16)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(125,142,132,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (!got) return;
  const { img, fade } = got;
  const src = tintOf(img) ?? img;
  const s = (d - 3) * OUTLINE_FIT;
  ctx.globalAlpha *= fade;
  ctx.drawImage(src, cx - s / 2, cy - s / 2, s, s);
  if (fade < 1) request();
}

/** An outline drawn into a canvas box (the card, ToLaD#577): the same tint, fitted to the box. */
export function drawOutline(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number): void {
  const src = tintOf(img) ?? img;
  const k = Math.min(w / (img.naturalWidth || 1), h / (img.naturalHeight || 1));
  const [iw, ih] = [img.naturalWidth * k, img.naturalHeight * k];
  ctx.drawImage(src, (w - iw) / 2, (h - ih) / 2, iw, ih);
}
