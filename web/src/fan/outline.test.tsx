// PhyloPic outlines where there is no photo (ToLaD#577): drawn in the photo's place on the tree and the card, never over
// a photo; the card says what the outline stands for and credits it; a chip keeps the old look (photos only).
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addressWith, chosenIn } from './ChoiceChip';
import { OutlinePic, outlineWords, PIC_CHOICES, WikiPic } from './FanApp';
import { FELIDAE } from './panthera';
import { packMammals, type MammalData } from './mammals-data';
import { SOURCES } from './sources';
import { drawPic, outlineOf, outlineRec, PicLoader, picLook, prefetchPics, setPicLook, wikiOf, type Outline, type WikiRec } from './wiki';

const REC: WikiRec = {
  ol: 'u-1',
  olw: ['Felis', 'genus', 'Felis silvestris', '512x300|Ann Artist|Up Loader|CC BY 3.0|https://creativecommons.org/licenses/by/3.0/'],
};
const OL: Outline = outlineRec(REC)!;

afterEach(() => setPicLook('outlines'));

describe('the sidecar (ToLaD#577)', () => {
  it('gives the felids with no photo an outline, and none to a species with one', () => {
    const ol = FELIDAE.species.filter((s) => wikiOf(s.sci)?.ol);
    expect(ol.length).toBeGreaterThan(10);
    for (const s of ol) {
      const w = wikiOf(s.sci)!;
      expect(w.img).toBeUndefined(); // the photo always wins
      expect(outlineOf(s.sci)).toMatch(/^https:\/\/images\.phylopic\.org\/images\/[0-9a-f-]{36}\/thumbnail\/192x192\.png$/);
    }
    const lion = wikiOf('Panthera leo')!;
    expect(lion.img).toBeTruthy();
    expect(lion.ol).toBeUndefined();
    expect(outlineOf('Panthera leo')).toBeUndefined();
  });
});

describe('the tree draws the outline where the stub was (ToLaD#577)', () => {
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
          if (ok) Object.assign(this, { naturalWidth: 192, naturalHeight: 192 });
          (ok ? res : rej)();
        };
      });
    }
    constructor() {
      FakeImage.made.push(this);
    }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const fresh = () => {
    FakeImage.made = [];
    return new PicLoader(() => new FakeImage() as unknown as HTMLImageElement, () => 1e6);
  };
  const ctxRec = () => {
    const drawn: { w: number }[] = [];
    let dashes = 0;
    const ctx = {
      globalAlpha: 1,
      save() {},
      restore() {},
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
      fill() {},
      fillText() {},
      drawImage(...a: number[]) {
        drawn.push({ w: a[a.length - 2] });
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn, stubs: () => dashes };
  };
  const bare = FELIDAE.species.find((s) => wikiOf(s.sci)?.ol)!.sci;
  const photo = 'Panthera leo';

  it('a species with no photo: its outline loaded and drawn inside the disc, never the stub', async () => {
    const L = fresh();
    const r = ctxRec();
    const request = vi.fn();
    drawPic(r.ctx, bare, 50, 50, 50, request, L);
    expect(FakeImage.made.map((i) => i.src)).toEqual([outlineOf(bare)]);
    expect(FakeImage.made[0].crossOrigin).toBe('anonymous');
    expect(r.stubs()).toBe(0);
    FakeImage.made[0].settle(true);
    await tick();
    drawPic(r.ctx, bare, 50, 50, 50, request, L);
    expect(r.drawn).toHaveLength(1);
    expect(r.drawn[0].w).toBeLessThan(47); // fitted inside the ring, not across the disc as a photo is
    expect(r.stubs()).toBe(0);
  });

  it('a species with a photo: the photo, never its outline', () => {
    const L = fresh();
    const r = ctxRec();
    drawPic(r.ctx, photo, 50, 50, 50, () => {}, L);
    expect(FakeImage.made).toHaveLength(1);
    expect(FakeImage.made[0].src).not.toContain('phylopic');
  });

  it('an outline that fails: the stub; photos only: the stub at once, nothing loaded', async () => {
    let L = fresh();
    const r = ctxRec();
    drawPic(r.ctx, bare, 50, 50, 50, () => {}, L);
    FakeImage.made[0].settle(false);
    await tick();
    drawPic(r.ctx, bare, 50, 50, 50, () => {}, L);
    expect(r.stubs()).toBe(1);
    setPicLook('photos');
    L = fresh();
    drawPic(r.ctx, bare, 50, 50, 50, () => {}, L);
    expect(FakeImage.made).toHaveLength(0);
    expect(r.stubs()).toBe(2);
    expect(outlineOf(bare)).toBeUndefined();
    prefetchPics([bare]); // (no loader in node: nothing to fetch, nothing thrown)
  });
});

describe('the card (ToLaD#577)', () => {
  it('reads a record: the URLs from the image id, what it stands for, its credit', () => {
    expect(OL).toEqual({
      id: 'u-1',
      thumb: 'https://images.phylopic.org/images/u-1/thumbnail/192x192.png',
      big: 'https://images.phylopic.org/images/u-1/raster/512x300.png',
      of: 'Felis',
      rank: 'genus',
      shows: 'Felis silvestris',
      by: 'Ann Artist',
      lic: 'CC BY 3.0',
      licUrl: 'https://creativecommons.org/licenses/by/3.0/',
    });
    // Before the card's data is in: the thumbnail, no words of it yet.
    expect(outlineRec({ ol: 'u-1' })).toMatchObject({ big: OL.thumb, of: undefined, by: undefined });
    expect(outlineRec({ wp: 'x' })).toBeNull();
  });

  it('shows the outline in the picture box with what it stands for and its credit', () => {
    const html = renderToStaticMarkup(<WikiPic w={REC} />);
    expect(html).toContain('class="pic outline loading"');
    expect(html).toContain('<canvas>');
    expect(html).toContain('Outline of its genus, <i>Felis</i> (shows <i>F. silvestris</i>)');
    expect(html).toContain('<a href="https://www.phylopic.org/images/u-1" target="_blank" rel="noopener">PhyloPic · Ann Artist</a>');
    expect(html).toContain('<a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>');
    expect(renderToStaticMarkup(<OutlinePic o={OL} initial="failed" />)).toContain('class="pic stub"');
  });

  it('a photo wins over an outline; photos only, the stub', () => {
    const both = { ...REC, img: 'https://upload.wikimedia.org/x/330px-a.jpg', file: 'https://commons.wikimedia.org/wiki/File:a.jpg' };
    const html = renderToStaticMarkup(<WikiPic w={both} />);
    expect(html).toContain('upload.wikimedia.org');
    expect(html).not.toContain('Outline');
    setPicLook('photos');
    expect(renderToStaticMarkup(<WikiPic w={REC} />)).toContain('class="pic stub"');
  });

  it('says "Outline" for its own, names the group and what it shows otherwise', () => {
    const words = (o: Partial<Outline>) => renderToStaticMarkup(<>{outlineWords({ ...OL, ...o })}</>);
    expect(words({ of: 'Felis catus', rank: 'species', shows: 'Felis catus' })).toBe('Outline');
    expect(words({ of: 'Felidae', rank: 'family', shows: 'Lynx lynx' })).toBe('Outline of its family, Felidae (shows <i>Lynx lynx</i>)');
    expect(words({ of: 'Sauropodomorpha', rank: 'clade', shows: 'Sauropodomorpha' })).toBe('Outline of its clade, Sauropodomorpha');
    expect(words({ of: undefined })).toBe('Outline'); // (the card's data not in yet)
  });

  it('the sources list PhyloPic', () => {
    expect(SOURCES.some((s) => s.name === 'PhyloPic' && s.url === 'https://www.phylopic.org/')).toBe(true);
  });
});

describe('the open pays nothing for the outlines (ToLaD#577)', () => {
  it("an outline is the card file's whole, its image id too; the photo stays in the open's", () => {
    const d = { clade: { species: [] }, wiki: { 'Felis catus': REC, 'Felis silvestris': { img: 'https://upload.wikimedia.org/x/330px-a.jpg', wp: 'w' } } };
    const { open, card } = packMammals(d as unknown as MammalData);
    const [o, c] = [JSON.stringify(open.wiki), JSON.stringify(card.wiki)];
    expect(o).not.toContain('u-1');
    expect(o).toContain('upload.wikimedia.org');
    expect(c).toContain('u-1');
    expect(c).toContain('Ann Artist');
  });

  it("the card before its data is in: the outline's box held with the spinner, not the stub", () => {
    const html = renderToStaticMarkup(<WikiPic w={{ wp: 'https://en.wikipedia.org/wiki/X' }} pending />);
    expect(html).toBe('<figure class="pic outline loading" role="status" aria-label="loading"><canvas></canvas></figure>');
    setPicLook('photos');
    expect(renderToStaticMarkup(<WikiPic w={null} pending />)).toContain('class="pic stub"');
  });
});

describe('the pictures chip (ToLaD#577)', () => {
  it('photos + outlines by default; ?outlines=off is photos only, the old look', () => {
    expect(picLook()).toBe('outlines');
    expect(PIC_CHOICES.map((c) => c.short)).toEqual(['photos + outlines', 'photos only']);
    expect(chosenIn('?outlines=off', 'outlines', PIC_CHOICES)).toBe('photos');
    expect(chosenIn('', 'outlines', PIC_CHOICES)).toBeNull();
    expect(addressWith('https://x.org/ToLaD/?tree=amniotes', 'outlines', PIC_CHOICES, 'photos')).toBe('https://x.org/ToLaD/?tree=amniotes&outlines=off');
    expect(addressWith('https://x.org/ToLaD/?outlines=off', 'outlines', PIC_CHOICES, 'outlines')).toBe('https://x.org/ToLaD/');
  });
});
