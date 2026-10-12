import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bigSrcOf, SpeciesCard, WikiPic } from './FanApp';
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
