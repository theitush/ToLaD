import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Alone, AloneImg, AloneView, aloneTapper } from './Alone';
import { bigSrcOf, RangeMap, SpeciesCard, WikiPic } from './FanApp';
import { hookHarness } from './hookharness';
import { FELIDAE } from './panthera';
import { drawPic, livePic, PIC_CAP, PIC_FADE_MS, PicLoader, picSrcOf, wikiOf, type WikiRec } from './wiki';

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

  it("without a URL or after it fails, the tree's stub in its box (ToLaD#492); loading, its box and credit are held (ToLaD#479)", () => {
    const stub = '<figure class="pic stub"><canvas></canvas><span class="cap">No photo</span></figure>';
    expect(renderToStaticMarkup(<WikiPic w={null} />)).toBe(stub);
    expect(renderToStaticMarkup(<WikiPic w={{ wp: 'https://en.wikipedia.org/wiki/X' }} />)).toBe(stub);
    const w = { img: 'https://upload.wikimedia.org/x/330px-a.jpg', file: 'https://commons.wikimedia.org/wiki/File:a.jpg' };
    expect(renderToStaticMarkup(<WikiPic w={w} initial="failed" />)).toBe(stub);
    const credit = '<a href="https://commons.wikimedia.org/wiki/File:a.jpg" target="_blank" rel="noopener">Wikimedia Commons</a>';
    const loading = renderToStaticMarkup(<WikiPic w={w} />);
    expect(loading).toContain('class="pic loading"');
    expect(loading).not.toContain('loading="lazy"'); // (shown in its box, fetched at once)
    expect(loading).toMatch(/referrerPolicy="no-referrer"/i);
    expect(loading).toContain('alt=""');
    expect(loading).toContain(credit); // (hidden by app.css while loading: the box is its loaded height)
    const ok = renderToStaticMarkup(<WikiPic w={w} initial="ok" />);
    expect(ok).toContain('class="pic ok"');
    expect(ok).toContain(credit);
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

  it('renders when set: no referrer, no alt text, its credit held from the start (ToLaD#479)', () => {
    const loading = renderToStaticMarkup(<RangeMap w={w} />);
    expect(loading).toContain('class="range loading"');
    expect(loading).toContain(`src="${w.range}"`);
    expect(loading).not.toContain('loading="lazy"');
    expect(loading).toMatch(/referrerPolicy="no-referrer"/i);
    expect(loading).toContain('alt=""');
    expect(loading).toContain('Range map · Wikimedia Commons');
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

  it('an image error removes it; a tap shows it alone at the 960 px thumbnail, a tap there closes it (ToLaD#506)', () => {
    const { render } = hookHarness();
    type Img = React.ReactElement<{ src: string; onClick: () => void; onLoad: () => void; onError: () => void }>;
    type Fig = React.ReactElement<{ className: string; children: [Img, React.ReactElement, React.ReactElement<AloneProps> | false] }>;
    const map = () => render(() => RangeMap({ w })) as Fig | null;
    let el = map()!;
    expect(el.props.className).toBe('range loading');
    el.props.children[0].props.onLoad();
    el = map()!;
    expect(el.props.className).toBe('range ok');
    expect(el.props.children[2]).toBe(false);
    el.props.children[0].props.onClick(); // a tap: alone, full screen; the card's figure itself unchanged
    el = map()!;
    expect(el.props.className).toBe('range ok');
    const alone = el.props.children[2] as React.ReactElement<AloneProps>;
    expect(alone.type).toBe(Alone);
    const html = renderToStaticMarkup(<AloneView {...alone.props} />);
    expect(html).toContain(`src="${bigSrcOf(w.range)}"`);
    expect(bigSrcOf(w.range)).toContain('/960px-M.svg.png');
    expect(html).toContain('Range map · Wikimedia Commons');
    alone.props.onClose(); // a tap on it (no history here): closed, back to the card
    el = map()!;
    expect(el.props.children[2]).toBe(false);
    el.props.children[0].props.onError(); // the map itself failed: gone, its `none` (here none) in its place
    expect(map()).toBeNull();
  });
});

type AloneProps = { credit: React.ReactNode; onClose: () => void; children: React.ReactNode };

describe('the picture, map or globe alone, full screen (ToLaD#506)', () => {
  const w = {
    img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/PZ_lion_pride.jpg/330px-PZ_lion_pride.jpg',
    file: 'https://commons.wikimedia.org/wiki/File:PZ_lion_pride.jpg',
  } as WikiRec;

  it('a tap on the picture opens it alone, the large thumbnail and its credit and nothing else; a second tap closes it', () => {
    const { render } = hookHarness();
    type Fig = React.ReactElement<{ className: string; children: [React.ReactElement<{ onClick: () => void; onLoad: () => void }>, unknown, React.ReactElement<AloneProps> | false] }>;
    const pic = () => render(() => WikiPic({ w })) as Fig;
    pic().props.children[0].props.onLoad();
    expect(pic().props.children[2]).toBe(false);
    pic().props.children[0].props.onClick(); // first tap
    const alone = pic().props.children[2] as React.ReactElement<AloneProps>;
    expect(alone.type).toBe(Alone);
    // (The server renderer's own image preloads aside.)
    const html = renderToStaticMarkup(<AloneView {...alone.props} />).replace(/<link rel="preload"[^>]*\/>/g, '');
    // Only the picture (the card's thumbnail at once, the 960 px one over it) and the credit: no name, no facts.
    expect(html).toBe(
      '<div class="alone"><div class="alone-it">' +
        `<img src="${w.img}" alt="" decoding="async" referrerPolicy="no-referrer"/>` +
        `<img class="big loading" src="${bigSrcOf(w.img!)}" alt="" decoding="async" referrerPolicy="no-referrer"/>` +
        `</div><div class="alone-credit"><a href="${w.file}" target="_blank" rel="noopener">Wikimedia Commons</a></div></div>`,
    );
    // The second tap, as the view sees it: down and up in place.
    const t = aloneTapper(alone.props.onClose);
    t.down({ id: 1, x: 200, y: 400, t: 0, link: false });
    t.up({ id: 1, x: 202, y: 401, t: 120, link: false });
    expect(pic().props.children[2]).toBe(false);
  });

  it('the large thumbnail shows once it arrives; if it fails, the card one stays', () => {
    const { render } = hookHarness();
    type Big = React.ReactElement<{ className: string; onLoad: () => void; onError: () => void }>;
    type Imgs = React.ReactElement<{ children: [React.ReactElement, Big | false] }>;
    const big = bigSrcOf(w.img!);
    const bigImg = () => (render(() => AloneImg({ src: w.img!, big })) as Imgs).props.children[1];
    expect((bigImg() as Big).props.className).toBe('big loading');
    (bigImg() as Big).props.onLoad();
    expect((bigImg() as Big).props.className).toBe('big ok');
    (bigImg() as Big).props.onError();
    expect(bigImg()).toBe(false);
    // An unsized URL has no larger one: only the card's.
    expect(render(() => AloneImg({ src: 'x.jpg', big: 'x.jpg' })).props.children[1]).toBe(false);
  });

  it('only a tap closes it: not a drag (the globe turned), a hold, a pinch, or a tap on the credit', () => {
    let closed = 0;
    const t = aloneTapper(() => closed++);
    const p = (id: number, x: number, y: number, ms: number, link = false) => ({ id, x, y, t: ms, link });
    t.down(p(1, 100, 100, 0)); // a drag that comes back where it started
    t.move(p(1, 160, 100, 50));
    t.up(p(1, 101, 100, 200));
    t.down(p(1, 100, 100, 1000)); // a hold
    t.up(p(1, 100, 100, 1900));
    t.down(p(1, 100, 100, 3000)); // a pinch
    t.down(p(2, 200, 200, 3010));
    t.up(p(1, 100, 100, 3100));
    t.up(p(2, 200, 200, 3110));
    t.down(p(1, 100, 820, 4000, true)); // the credit
    t.up(p(1, 100, 820, 4080, true));
    expect(closed).toBe(0);
    t.down(p(1, 100, 100, 5000));
    t.move(p(1, 104, 103, 5040));
    t.up(p(1, 104, 103, 5100));
    expect(closed).toBe(1);
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
    let dashes = 0;
    const saved: number[] = [];
    const ctx = {
      globalAlpha: 1,
      save() {
        saved.push(ctx.globalAlpha);
      },
      restore() {
        ctx.globalAlpha = saved.pop()!;
      },
      beginPath() {},
      arc() {},
      clip() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      roundRect() {},
      setLineDash(d: number[]) {
        if (d.length) dashes++;
      },
      fill() {
        fills++;
      },
      fillText() {},
      drawImage() {
        drawn.push(ctx.globalAlpha);
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn, fills: () => fills, stubs: () => dashes };
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
    expect(r.stubs()).toBe(0); // loading is not "no photo"
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
    expect(request).toHaveBeenCalledTimes(1); // one redraw, for the stub
    expect(r.stubs()).toBe(0);
    expect(livePic(sp[0], L)).toBe(false); // a group's disc moves on to a relative
    expect(livePic(sp[1], L)).toBe(true);
    drawPic(r.ctx, sp[0], 50, 50, 50, request, L);
    expect(r.drawn).toEqual([]);
    expect(r.stubs()).toBe(1); // failed for good: the stub, every frame
    expect(FakeImage.made.length).toBe(2); // not asked again
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('draws the stub at once for a species with no photo, at both sizes, and loads nothing (ToLaD#400)', () => {
    const L = fresh();
    const request = vi.fn();
    const r = ctxRec();
    drawPic(r.ctx, 'Not a species', 50, 50, 50, request, L);
    drawPic(r.ctx, 'Not a species', 50, 50, 22, request, L);
    expect(r.stubs()).toBe(2);
    expect(r.drawn).toEqual([]);
    expect(FakeImage.made.length).toBe(0);
    expect(request).not.toHaveBeenCalled();
    expect(livePic('Not a species', L)).toBe(false);
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
