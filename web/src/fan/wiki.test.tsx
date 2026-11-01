import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bigSrcOf, RangeMap, SpeciesCard, WikiPic } from './FanApp';
import { FELIDAE } from './panthera';
import { drawPic, PIC_CAP, PIC_FADE_MS, PicLoader, picSrcOf, wikiOf } from './wiki';

const lion = FELIDAE.species.find((s) => s.sci === 'Panthera leo')!;

describe('wiki sidecar (ToLaD#182)', () => {
  it('loads the fan species from data/mammals/wiki.json', () => {
    const w = wikiOf('Panthera leo');
    expect(w?.wp).toBe('https://en.wikipedia.org/wiki/Lion');
    expect(w?.img).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/.+\/330px-/);
    expect(w?.file).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    expect(FELIDAE.species.filter((s) => wikiOf(s.sci)?.wp).length).toBeGreaterThan(FELIDAE.species.length * 0.8);
    expect(wikiOf('Not a species')).toBeNull();
  });

  it('links the card name to Wikipedia in a new tab', () => {
    const html = renderToStaticMarkup(<SpeciesCard sp={lion} onClose={() => {}} />);
    expect(html).toContain('<a class="wp" href="https://en.wikipedia.org/wiki/Lion" target="_blank" rel="noopener">Lion</a>');
  });

  it('draws no picture without a URL, before it loads, or after it fails', () => {
    expect(renderToStaticMarkup(<WikiPic w={null} />)).toBe('');
    expect(renderToStaticMarkup(<WikiPic w={{ wp: 'https://en.wikipedia.org/wiki/X' }} />)).toBe('');
    const w = { img: 'https://upload.wikimedia.org/x/330px-a.jpg', file: 'https://commons.wikimedia.org/wiki/File:a.jpg' };
    expect(renderToStaticMarkup(<WikiPic w={w} initial="failed" />)).toBe('');
    const loading = renderToStaticMarkup(<WikiPic w={w} />);
    expect(loading).toContain('class="pic loading"');
    expect(loading).toContain('loading="lazy"');
    expect(loading).toMatch(/referrerPolicy="no-referrer"/i);
    expect(loading).toContain('alt=""');
    expect(loading).not.toContain('Wikimedia Commons');
    const ok = renderToStaticMarkup(<WikiPic w={w} initial="ok" />);
    expect(ok).toContain('<a href="https://commons.wikimedia.org/wiki/File:a.jpg" target="_blank" rel="noopener">Wikimedia Commons</a>');
  });
});

describe('range map (ToLaD#196)', () => {
  const w = {
    range: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/M.svg/500px-M.svg.png',
    rangeFile: 'https://commons.wikimedia.org/wiki/File:M.svg',
  };
  afterEach(() => vi.restoreAllMocks());

  it("the sidecar carries it for the lion; under the name the card holds the globe's place (ToLaD#267)", () => {
    expect(wikiOf('Panthera leo')?.range).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/.+\/500px-/);
    expect(wikiOf('Panthera leo')?.rangeFile).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    // globe.json is not loaded here: the globe's disc, then the globe (or this map as its fallback: globe.test.tsx).
    const html = renderToStaticMarkup(<SpeciesCard sp={lion} onClose={() => {}} />);
    expect(html.indexOf('class="globe loading"')).toBeGreaterThan(html.indexOf('class="t"'));
  });

  it('renders when set: lazy, no referrer, no alt text, credit once loaded', () => {
    const loading = renderToStaticMarkup(<RangeMap w={w} />);
    expect(loading).toContain('class="range loading"');
    expect(loading).toContain(`src="${w.range}"`);
    expect(loading).toContain('loading="lazy"');
    expect(loading).toMatch(/referrerPolicy="no-referrer"/i);
    expect(loading).toContain('alt=""');
    expect(loading).not.toContain('Wikimedia Commons');
    const ok = renderToStaticMarkup(<RangeMap w={w} initial="ok" />);
    expect(ok).toContain('class="range ok"');
    expect(ok).toContain(`<a href="${w.rangeFile}" target="_blank" rel="noopener">Range map · Wikimedia Commons</a>`);
  });

  it('is nothing without a range', () => {
    expect(renderToStaticMarkup(<RangeMap w={null} />)).toBe('');
    expect(renderToStaticMarkup(<RangeMap w={{ wp: 'https://en.wikipedia.org/wiki/X', img: 'https://upload.wikimedia.org/x/330px-a.jpg' }} />)).toBe('');
    const none = FELIDAE.species.find((s) => wikiOf(s.sci) && !wikiOf(s.sci)?.range);
    expect(none).toBeDefined();
    expect(renderToStaticMarkup(<SpeciesCard sp={none!} onClose={() => {}} />)).not.toContain('class="range');
  });

  it('an image error removes it; a tap enlarges it to the 960 px thumbnail, whose error falls back', () => {
    // A hook harness: RangeMap called as a function, its state kept here (no DOM in these tests).
    const slots: unknown[] = [];
    let i = 0;
    // React 19's hook dispatcher, set for the call (there is no DOM renderer in these tests):
    // the same path React itself takes, so the component's own onLoad/onClick/onError run.
    const internals = (React as unknown as Record<string, { H: unknown }>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const useState = (init: unknown) => {
      const k = i++;
      if (!(k in slots)) slots[k] = init;
      return [slots[k], (v: unknown) => (slots[k] = typeof v === 'function' ? (v as (x: unknown) => unknown)(slots[k]) : v)];
    };
    type Img = React.ReactElement<{ src: string; onClick: () => void; onLoad: () => void; onError: () => void }>;
    const render = () => {
      i = 0;
      const prev = internals.H;
      internals.H = { useState };
      try {
        return RangeMap({ w }) as React.ReactElement<{ className: string; children: [Img, unknown] }> | null;
      } finally {
        internals.H = prev;
      }
    };
    let el = render()!;
    expect(el.props.className).toBe('range loading');
    el.props.children[0].props.onLoad();
    el = render()!;
    expect(el.props.className).toBe('range ok');
    el.props.children[0].props.onClick();
    el = render()!;
    expect(el.props.className).toBe('range ok big');
    expect(el.props.children[0].props.src).toBe(bigSrcOf(w.range));
    expect(el.props.children[0].props.src).toContain('/960px-M.svg.png');
    el.props.children[0].props.onError(); // the big one failed: back to the 500 px one, still shown
    el = render()!;
    expect(el.props.children[0].props.src).toBe(w.range);
    el.props.children[0].props.onError(); // the map itself failed: gone
    expect(render()).toBeNull();
  });
});

describe('the tree pictures: placeholder at once, fetched ahead (ToLaD#351)', () => {
  // An image whose load the test settles: decode() resolves or rejects when told.
  class FakeImage {
    static made: FakeImage[] = [];
    src = '';
    crossOrigin = '';
    referrerPolicy = '';
    decoding = '';
    naturalWidth = 0;
    naturalHeight = 0;
    settle: (ok: boolean) => void = () => {};
    decode(): Promise<void> {
      return new Promise((res, rej) => {
        this.settle = (ok) => {
          if (ok) Object.assign(this, { naturalWidth: 250, naturalHeight: 167 });
          (ok ? res : rej)();
        };
      });
    }
    constructor() {
      FakeImage.made.push(this);
    }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let t = 0;
  const fresh = () => {
    FakeImage.made = [];
    t = 0;
    return new PicLoader(() => new FakeImage() as unknown as HTMLImageElement, () => t);
  };
  // A canvas that only records whether a picture was drawn, and at what alpha.
  const ctxRec = () => {
    const drawn: number[] = [];
    let fills = 0;
    const ctx = {
      globalAlpha: 1,
      save() {},
      restore() {},
      beginPath() {},
      arc() {},
      clip() {},
      stroke() {},
      fill() {
        fills++;
      },
      fillText() {},
      drawImage() {
        drawn.push(ctx.globalAlpha);
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn, fills: () => fills };
  };
  const sp = FELIDAE.species.filter((s) => wikiOf(s.sci)?.img).map((s) => s.sci);
  const url = (s: string) => wikiOf(s)!.img!;

  it('asks Commons for the 250 px thumbnail (its standard width sharp for a 50 px disc at 3×), any page prefix kept', () => {
    expect(picSrcOf('https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/A_b.png/330px-A_b.png')).toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/A_b.png/250px-A_b.png');
    expect(picSrcOf('https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/D.tif/lossy-page1-330px-D.tif.jpg')).toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/D.tif/lossy-page1-250px-D.tif.jpg');
    expect(picSrcOf('https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/A.png/120px-A.png')).toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/A.png/120px-A.png');
    expect(picSrcOf('https://upload.wikimedia.org/wikipedia/commons/b/b9/A.png')).toBe('https://upload.wikimedia.org/wikipedia/commons/b/b9/A.png');
  });

  it('draws the placeholder disc before the load, then fades the picture in over PIC_FADE_MS, then asks no more redraws', async () => {
    const L = fresh();
    const request = vi.fn();
    const r = ctxRec();
    drawPic(r.ctx, sp[0], 50, 50, 50, request, L);
    expect(r.drawn).toEqual([]); // placeholder only
    expect(r.fills()).toBe(2); // its ring's dark disc and its quiet fill
    const [img] = FakeImage.made;
    expect(img.src).toBe(picSrcOf(url(sp[0])));
    expect(img.crossOrigin).toBe('anonymous');
    t = 1000;
    img.settle(true);
    await tick();
    expect(request).toHaveBeenCalledTimes(1); // one redraw on load
    t = 1000 + PIC_FADE_MS / 2;
    drawPic(r.ctx, sp[0], 50, 50, 50, request, L);
    expect(r.drawn).toEqual([0.5]); // half faded in, over the placeholder
    expect(request).toHaveBeenCalledTimes(2); // the fade's next frame
    t = 1000 + PIC_FADE_MS;
    const n = r.fills();
    drawPic(r.ctx, sp[0], 50, 50, 50, request, L);
    expect(r.drawn).toEqual([0.5, 1]);
    expect(r.fills() - n).toBe(1); // the placeholder's fill no longer under it
    expect(request).toHaveBeenCalledTimes(2); // faded in: no further redraws
    expect(FakeImage.made.length).toBe(1); // loaded once
  });

  it('keeps at most PIC_CAP loading, the pictures on screen before those fetched ahead', async () => {
    const L = fresh();
    const ahead = sp.slice(0, 10).map(url);
    L.ahead(ahead);
    expect(L.inFlight).toBe(PIC_CAP);
    expect(FakeImage.made.map((i) => i.src)).toEqual(ahead.slice(0, PIC_CAP).map(picSrcOf));
    // One on screen jumps the queue: the next free slot is its.
    L.want(url(sp[12]));
    expect(L.inFlight).toBe(PIC_CAP);
    FakeImage.made[0].settle(true);
    await tick();
    expect(L.inFlight).toBe(PIC_CAP);
    expect(FakeImage.made[PIC_CAP].src).toBe(picSrcOf(url(sp[12])));
    // A new list ahead replaces the queued rest of the old one.
    L.ahead([url(sp[13])]);
    for (const i of FakeImage.made.slice(1)) i.settle(true);
    await tick();
    expect(FakeImage.made.slice(PIC_CAP + 1).map((i) => i.src)).toEqual([picSrcOf(url(sp[13]))]);
    FakeImage.made[PIC_CAP + 1].settle(true);
    await tick();
    expect(L.inFlight).toBe(0);
  });

  it('falls back to the stored URL, and a picture that fails stays a placeholder', async () => {
    const L = fresh();
    const request = vi.fn();
    const r = ctxRec();
    drawPic(r.ctx, sp[0], 50, 50, 50, request, L);
    FakeImage.made[0].settle(false); // the 250 px one refused
    await tick();
    expect(FakeImage.made[1].src).toBe(url(sp[0])); // the stored one tried
    FakeImage.made[1].settle(false);
    await tick();
    expect(L.failed(url(sp[0]))).toBe(true);
    expect(L.inFlight).toBe(0);
    drawPic(r.ctx, sp[0], 50, 50, 50, request, L);
    expect(r.drawn).toEqual([]);
    expect(r.fills()).toBe(4); // still the placeholder, every frame
    expect(FakeImage.made.length).toBe(2); // not asked again
    expect(request).not.toHaveBeenCalled();
  });
});

describe('the card picture opens larger on a tap (ToLaD#182)', () => {
  it('asks Commons for the 960 px thumbnail of the same file, and leaves an unsized URL alone', () => {
    expect(bigSrcOf('https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/PZ_lion_pride.jpg/330px-PZ_lion_pride.jpg')).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/PZ_lion_pride.jpg/960px-PZ_lion_pride.jpg',
    );
    expect(bigSrcOf('https://upload.wikimedia.org/wikipedia/commons/7/7e/PZ_lion_pride.jpg')).toBe('https://upload.wikimedia.org/wikipedia/commons/7/7e/PZ_lion_pride.jpg');
  });
});
