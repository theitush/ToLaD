import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bigSrcOf, RangeMap, SpeciesCard, WikiPic } from './FanApp';
import { FELIDAE } from './panthera';
import { labelThumb, wikiOf } from './wiki';

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

  it('the sidecar carries it for the lion, and the card shows it under the name', () => {
    expect(wikiOf('Panthera leo')?.range).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/.+\/500px-/);
    expect(wikiOf('Panthera leo')?.rangeFile).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    const html = renderToStaticMarkup(<SpeciesCard sp={lion} onClose={() => {}} />);
    const at = html.indexOf('class="range loading"');
    expect(at).toBeGreaterThan(html.indexOf('class="t"'));
    expect(html).toContain(`src="${wikiOf('Panthera leo')!.range!.replace(/&/g, '&amp;')}"`);
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

describe('label thumbnails (ToLaD#182)', () => {
  class FakeImage {
    static made: FakeImage[] = [];
    src = '';
    crossOrigin = '';
    referrerPolicy = '';
    decoding = '';
    complete = false;
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      FakeImage.made.push(this);
    }
  }
  afterEach(() => vi.unstubAllGlobals());

  it('is nothing until loaded, nothing on error, and asks for one redraw on load', () => {
    vi.stubGlobal('Image', FakeImage);
    const request = vi.fn();
    const sp = FELIDAE.species.filter((s) => wikiOf(s.sci)?.img);
    const [a, b] = [sp[0].sci, sp[1].sci];
    expect(labelThumb(a, request)).toBeNull();
    expect(labelThumb(b, request)).toBeNull();
    const [ia, ib] = FakeImage.made;
    expect(ia.crossOrigin).toBe('anonymous');
    expect(ia.src).toBe(wikiOf(a)!.img);
    Object.assign(ia, { complete: true, naturalWidth: 330, naturalHeight: 220 });
    ia.onload!();
    expect(request).toHaveBeenCalledTimes(1);
    expect(labelThumb(a, request)).toBe(ia);
    ib.onerror!();
    expect(labelThumb(b, request)).toBeNull();
    expect(FakeImage.made.length).toBe(2); // cached: no second load
    const none = FELIDAE.species.find((s) => !wikiOf(s.sci)?.img);
    if (none) expect(labelThumb(none.sci, request)).toBeNull();
    expect(FakeImage.made.length).toBe(2);
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
