// Wikipedia link, Wikimedia Commons picture (ToLaD#182) and range map (ToLaD#196) per species, from the data's
// sidecar data/mammals/wiki.json (pipeline `make wiki`), filtered to the fan's species at
// build time (vite.config.ts, `wiki` of `virtual:panthera-data`).
//
// The pictures are hotlinked, never copied (Ita, 2026-10-12). Where they cannot load (no
// network, the Claude artifact's CSP, a dead file), the card has no picture and the tree's
// discs stay placeholders (drawPic, ToLaD#351).

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
 * the last failing for good (its disc stays a placeholder). `onChange` is called when one is ready.
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

  /** Whether the picture failed for good (its disc stays a placeholder). */
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
      if (ok) this.onChange?.();
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

/** `?ph=initial` puts the species' initial on its placeholder disc (ToLaD#351, a variant to compare); plain otherwise. */
const phInitial = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ph') === 'initial';

/**
 * A species' picture as a disc of diameter `d` centred at (cx, cy) (ToLaD#351): its placeholder at once, at its final
 * size and place (a quiet disc in its ring), and the picture fading in over it once loaded (PIC_FADE_MS; `request` is
 * asked for the fade's frames, then never again). A picture that fails stays a placeholder. `L` for tests.
 */
export function drawPic(ctx: CanvasRenderingContext2D, sci: string, cx: number, cy: number, d: number, request: () => void, L = picLoader()): void {
  const url = thumbsOn ? wikiOf(sci)?.img : undefined;
  if (url && L) {
    L.onChange = request;
    L.want(url);
  }
  const got = url && L ? L.ready(url) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,23,20,0.8)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2 - 1.5, 0, Math.PI * 2);
  if (!got || got.fade < 1) {
    // The placeholder: a quiet fill and ring in the app's palette (INK3, #7d8e84).
    ctx.fillStyle = 'rgba(125,142,132,0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(125,142,132,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (phInitial && d >= 24) {
      ctx.fillStyle = 'rgba(125,142,132,0.75)';
      ctx.font = `600 ${Math.round(d * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sci[0], cx, cy + 1);
    }
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

