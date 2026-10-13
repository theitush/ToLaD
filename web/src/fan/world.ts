// The world on the time axis (ToLaD#189): what the Earth was like at each age, in
// two layers Ita asked for ("Ice ages, Geological periods ... makem all
// togglable", 2026-10-12), each with its own switch (?periods=0&ice=0; the big-events
// layer was dropped in #229, an old ?events= is ignored):
//
// - the geological units, a thin strip at the left edge in the ICS chart's colours,
//   at the finest rank that fits (epochs near now, periods and eras deep);
// - the glacials, faint bluish bands across the background, under everything.
//
// Every row below is cited. Ages are years before present (or Ma where it says so).

/** A unit of the International Chronostratigraphic Chart. */
export type Rank = 'eon' | 'era' | 'period' | 'epoch';
export interface GeoUnit {
  name: string;
  rank: Rank;
  /** Base (older bound), Ma. */
  startMa: number;
  /** Top (younger bound), Ma. */
  endMa: number;
  /** The chart's colour. */
  color: string;
}

/*
 * Ages: ICS International Chronostratigraphic Chart v2024/12 (Cohen, Finney, Gibbard &
 * Fan 2013, updated; https://stratigraphy.org/ICSchart/ChronostratChart2024-12.pdf, read
 * 2026-10-12). Colours: the chart's CGMW colours as RGB, from Macrostrat's
 * "international intervals" (https://macrostrat.org/api/v2/defs/intervals?timescale_id=11,
 * CC-BY 4.0, read 2026-10-12), whose ages match v2024/12 row for row. (For the Precambrian
 * Macrostrat's pinks differ a little from the chart's printed ones; the axis fades out
 * below 300 Ma, so they are only ever seen faint.) The axis reaches 4000 Ma, inside the
 * Eoarchean: the Hadean is never on it.
 */
const U = (rank: Rank, name: string, endMa: number, startMa: number, color: string): GeoUnit => ({ name, rank, startMa, endMa, color });
export const GEO_UNITS: readonly GeoUnit[] = [
  U('eon', 'Phanerozoic', 0, 538.8, '#9AD9DD'),
  U('eon', 'Proterozoic', 538.8, 2500, '#FF70B8'),
  U('eon', 'Archean', 2500, 4031, '#FF3399'),
  U('era', 'Cenozoic', 0, 66.0, '#F2F91D'),
  U('era', 'Mesozoic', 66.0, 251.902, '#67C5CA'),
  U('era', 'Paleozoic', 251.902, 538.8, '#99C08D'),
  U('era', 'Neoproterozoic', 538.8, 1000, '#FF9BCD'),
  U('era', 'Mesoproterozoic', 1000, 1600, '#FF7EBF'),
  U('era', 'Paleoproterozoic', 1600, 2500, '#E665A6'),
  U('era', 'Neoarchean', 2500, 2800, '#FF5CAD'),
  U('era', 'Mesoarchean', 2800, 3200, '#E62E8A'),
  U('era', 'Paleoarchean', 3200, 3600, '#CC297A'),
  U('era', 'Eoarchean', 3600, 4031, '#B2246B'),
  U('period', 'Quaternary', 0, 2.58, '#F9F97F'),
  U('period', 'Neogene', 2.58, 23.04, '#FFE619'),
  U('period', 'Paleogene', 23.04, 66.0, '#FD9A52'),
  U('period', 'Cretaceous', 66.0, 143.1, '#7FC64E'),
  U('period', 'Jurassic', 143.1, 201.4, '#34B2C9'),
  U('period', 'Triassic', 201.4, 251.902, '#812B92'),
  U('period', 'Permian', 251.902, 298.9, '#F04028'),
  U('period', 'Carboniferous', 298.9, 358.86, '#67A599'),
  U('period', 'Devonian', 358.86, 419.62, '#CB8C37'),
  U('period', 'Silurian', 419.62, 443.1, '#B3E1B6'),
  U('period', 'Ordovician', 443.1, 486.85, '#009270'),
  U('period', 'Cambrian', 486.85, 538.8, '#7FA056'),
  U('period', 'Ediacaran', 538.8, 635, '#FFC3E1'),
  U('period', 'Cryogenian', 635, 720, '#FFAFD7'),
  U('period', 'Tonian', 720, 1000, '#FFA5D2'),
  U('period', 'Stenian', 1000, 1200, '#FFA5D2'),
  U('period', 'Ectasian', 1200, 1400, '#FF98CC'),
  U('period', 'Calymmian', 1400, 1600, '#FF8BC5'),
  U('period', 'Statherian', 1600, 1800, '#EE93C1'),
  U('period', 'Orosirian', 1800, 2050, '#E874AF'),
  U('period', 'Rhyacian', 2050, 2300, '#EB84B8'),
  U('period', 'Siderian', 2300, 2500, '#E874AF'),
  U('epoch', 'Holocene', 0, 0.0117, '#FEF2E0'),
  U('epoch', 'Pleistocene', 0.0117, 2.58, '#FFF2AE'),
  U('epoch', 'Pliocene', 2.58, 5.333, '#FFFF99'),
  U('epoch', 'Miocene', 5.333, 23.04, '#FFFF00'),
  U('epoch', 'Oligocene', 23.04, 33.9, '#FDC07A'),
  U('epoch', 'Eocene', 33.9, 56.0, '#FDB46C'),
  U('epoch', 'Paleocene', 56.0, 66.0, '#FDA75F'),
];

const RANKS: readonly Rank[] = ['eon', 'era', 'period', 'epoch'];
/** A unit's children: the units of the next rank inside it (none for the epochs, nor for the Archean eras and the Mesozoic and Paleozoic periods, which the chart splits no further here). */
export function childrenOf(u: GeoUnit): GeoUnit[] {
  const r = RANKS[RANKS.indexOf(u.rank) + 1];
  return r ? GEO_UNITS.filter((c) => c.rank === r && c.endMa >= u.endMa && c.startMa <= u.startMa) : [];
}

/**
 * The glacials: the even-numbered marine isotope stages of Lisiecki & Raymo 2005 (LR04
 * benthic δ18O stack, Paleoceanography 20, PA1003), stage boundaries from their table
 * (https://lorraine-lisiecki.com/LR04_MISboundaries.txt, read 2026-10-12), ka.
 * MIS 2 to MIS 104: back to the start of the Quaternary (2.58 Ma).
 *
 * All of them are shaded, the 41-kyr world before ~1 Ma (MIS 30 and older) at half
 * strength: those glacials were real (the northern ice sheets came and went every 41 kyr
 * from ~2.7 Ma) but smaller, LR04's δ18O swings about half the late ones'. Leaving them out
 * would say there were no ice ages before 1 Ma; shading them as strong would overstate them.
 */
const MIS_BOUNDS_KA = [
  14, 29, 57, 71, 130, 191, 243, 300, 337, 374, 424, 478, 533, 563, 621, 676, 712, 761, 790, 814, 866, 900, 917, 936, 959, 970, 982, 1014, 1031, 1062, 1081,
  1104, 1114, 1141, 1190, 1215, 1244, 1264, 1286, 1304, 1320, 1344, 1362, 1383, 1405, 1424, 1452, 1469, 1492, 1510, 1530, 1547.5, 1570, 1585, 1608, 1628.5,
  1642.5, 1670, 1697.5, 1715, 1743, 1758, 1782, 1802.5, 1816, 1826, 1832.5, 1849, 1859.5, 1875, 1898, 1915, 1941, 1965, 1990, 2017, 2043, 2088, 2103, 2125,
  2146, 2168, 2192, 2207.5, 2236, 2250, 2273, 2291, 2309, 2333, 2350, 2373, 2387, 2407, 2427, 2452, 2477, 2494, 2510, 2540, 2554, 2575, 2595, 2614,
];
/** MIS_BOUNDS_KA[k] is the boundary MIS (k+1)/(k+2); before this age (ka) the glacials are the 41-kyr ones. */
const FULL_SINCE_KA = 1000;
export interface Glacial {
  mis: number;
  /** Older bound, ka. */
  fromKa: number;
  /** Younger bound, ka. */
  toKa: number;
  /** 1: the 100-kyr world; 0.5: the 41-kyr world. */
  strength: number;
}
export const GLACIALS: readonly Glacial[] = (() => {
  const out: Glacial[] = [];
  for (let mis = 2; mis <= 104; mis += 2) {
    const toKa = MIS_BOUNDS_KA[mis - 2];
    const fromKa = MIS_BOUNDS_KA[mis - 1];
    out.push({ mis, fromKa, toKa, strength: toKa < FULL_SINCE_KA ? 1 : 0.5 });
  }
  return out;
})();
/** The Last Glacial Maximum: nearly all ice sheets at their largest from 26.5 ka to 19–20 ka (Clark et al. 2009, Science 325:710). */
export const LGM = { fromKa: 26.5, toKa: 19 };

// ---- the switches ----------------------------------------------------------------

export interface WorldLayers {
  periods: boolean;
  ice: boolean;
}
/**
 * The layers from the URL (?periods=0&ice=0). All on by default: each is quiet
 * (a strip 8 px wide, bands at a few % alpha, at most a handful of labels), and together
 * they are the point of the axis; one tap turns any of them off.
 */
export function worldFlags(search: string): WorldLayers {
  const q = new URLSearchParams(search);
  const on = (k: string) => q.get(k) !== '0' && q.get(k) !== 'off';
  return { periods: on('periods'), ice: on('ice') };
}

// ---- layout (pure) -----------------------------------------------------------------

/** The strip's width (px) at the left edge; the axis's labels move right by this much. */
export const STRIP_W = 8;
/** A unit is drawn only if its children are all at least this tall on screen (px); else the unit itself. */
const MIN_UNIT_PX = 5;

export interface StripCell {
  unit: GeoUnit;
  /** Screen y of its top (young) and bottom (old) edges, unclipped. */
  y0: number;
  y1: number;
}
/**
 * The strip's cells for a screen `h` px tall, where `syOf(ma)` is the screen y of an age:
 * from the eons down, each unit splits into its children where all of those on screen are
 * at least MIN_UNIT_PX tall (so the finest rank that fits shows: epochs near now, periods
 * and eras deep, never a gap or a mix of ranks inside one parent).
 */
export function stripCells(syOf: (ma: number) => number, h: number, bottomMa: number): StripCell[] {
  const out: StripCell[] = [];
  const visit = (u: GeoUnit) => {
    if (u.endMa >= bottomMa) return;
    const y0 = syOf(u.endMa);
    const y1 = syOf(Math.min(u.startMa, bottomMa));
    if (y1 < 0 || y0 > h) return;
    const kids = childrenOf(u);
    const shown = kids.filter((c) => c.endMa < bottomMa && syOf(Math.min(c.startMa, bottomMa)) >= 0 && syOf(c.endMa) <= h);
    if (shown.length && shown.every((c) => syOf(Math.min(c.startMa, bottomMa)) - syOf(c.endMa) >= MIN_UNIT_PX)) {
      for (const c of kids) visit(c);
    } else out.push({ unit: u, y0, y1 });
  };
  for (const u of GEO_UNITS) if (u.rank === 'eon') visit(u);
  return out;
}

/** A screen box [x0, y0, x1, y1]. */
export type Box = [number, number, number, number];
const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

export interface EventLabel {
  text: string;
  sy: number;
  box: Box;
}
/**
 * Where the labels go: at the left (x0), centred on their age; a label that
 * would touch an axis label (`taken`: the tick labels, "now", the scale note) slides right
 * past it, and is left out if it still clashes or would run past `maxX`. In priority
 * order, each clear of those before it. Never inside [top, bottom].
 */
export function placeEventLabels(
  items: { text: string; sy: number }[],
  taken: readonly Box[],
  measure: (t: string) => number,
  x0: number,
  maxX: number,
  top: number,
  bottom: number,
): EventLabel[] {
  const out: EventLabel[] = [];
  const busy = [...taken];
  for (const it of items) {
    if (it.sy - 8 < top || it.sy + 8 > bottom) continue;
    const w = measure(it.text);
    let box: Box = [x0, it.sy - 8, x0 + w, it.sy + 8];
    for (let tries = 0; tries < 4; tries++) {
      const b = busy.find((t) => hit(t, box));
      if (!b) break;
      box = [b[2] + 8, box[1], b[2] + 8 + w, box[3]];
    }
    if (box[2] > maxX || busy.some((t) => hit(t, box))) continue;
    busy.push([box[0] - 4, box[1] - 2, box[2] + 4, box[3] + 2]);
    out.push({ ...it, box });
  }
  return out;
}

// ---- drawing -----------------------------------------------------------------------

/** What the layers need of the view (FanView). */
export interface WorldHost {
  readonly ctx: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  readonly world: WorldLayers;
  /** The axis labels drawn this frame (screen boxes). */
  readonly axisBoxes: Box[];
  readonly fan: { time: { y(ageMa: number): number }; trunkBottom: { y: number } };
  toScreen(x: number, y: number): [number, number];
  under(x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number], a?: number): void;
}

const ICE: [number, number, number] = [0.42, 0.66, 1];
const ICE_A = 0.1;
const ICE_INK = '#9cc0f0';
const STRIP_A = 0.82;
/** The deepest age drawn (Ma): the bottom of the world (layout's STEM_BOTTOM_MA). */
const BOTTOM_MA = 4000;

const syAt = (v: WorldHost, ma: number) => v.toScreen(0, v.fan.time.y(ma))[1];

/** Under everything (the GPU layer's first rectangles, or the 2D canvas's first fills): the glacials. */
export function drawWorldUnder(v: WorldHost): void {
  if (!v.world.ice) return;
  for (const g of GLACIALS) {
    const y0 = syAt(v, g.toKa / 1e3);
    const y1 = syAt(v, g.fromKa / 1e3);
    if (y1 < 0 || y0 > v.h || y1 - y0 < 0.5) continue;
    v.under(0, Math.max(0, y0), v.w, Math.min(v.h, y1), ICE, ICE_A * g.strength);
  }
  const y0 = syAt(v, LGM.toKa / 1e3);
  const y1 = syAt(v, LGM.fromKa / 1e3);
  if (y1 >= 0 && y0 <= v.h) v.under(0, Math.max(0, y0), v.w, Math.min(v.h, y1), ICE, 0.08);
}

/** The inset the axis's labels move right by (the strip's width, when it is on). */
export function axisInset(v: { world: WorldLayers }): number {
  return v.world.periods ? STRIP_W + 3 : 0;
}

/** Over the branches, after the axis's labels: the strip and the glacial label. */
export function drawWorldOver(v: WorldHost): void {
  const ctx = v.ctx;
  ctx.save();
  if (v.world.periods) drawStrip(v);
  if (v.world.ice) drawEvents(v);
  ctx.restore();
}

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

function drawStrip(v: WorldHost): void {
  const ctx = v.ctx;
  const bottomY = Math.min(v.h, syAt(v, BOTTOM_MA));
  const cells = stripCells((ma) => syAt(v, ma), v.h, BOTTOM_MA);
  ctx.globalAlpha = STRIP_A;
  for (const c of cells) {
    const a = Math.max(0, c.y0);
    const b = Math.min(bottomY, c.y1);
    if (b - a < 0.3) continue;
    ctx.fillStyle = c.unit.color;
    ctx.fillRect(0, a, STRIP_W, b - a);
  }
  // A hairline of the ground between units, and on the strip's right edge.
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = 'rgba(12,23,20,0.85)';
  for (const c of cells) if (c.y0 > 0 && c.y0 < v.h) ctx.fillRect(0, Math.round(c.y0), STRIP_W, 1);
  const top = Math.max(0, syAt(v, 0));
  if (bottomY > top) ctx.fillRect(STRIP_W, top, 1, bottomY - top);
  // The names, rotated, centred in the unit's part on screen, where they fit.
  ctx.globalAlpha = 1;
  ctx.font = `700 8px 'Sofia Sans Condensed', 'Roboto Condensed', 'Arial Narrow', system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const c of cells) {
    const a = Math.max(2, c.y0);
    const b = Math.min(bottomY, v.h - 2, c.y1);
    const text = c.unit.name.toUpperCase();
    const tw = ctx.measureText(text).width;
    if (b - a < tw + 10) continue;
    ctx.fillStyle = lum(c.unit.color) > 0.55 ? 'rgba(12,23,20,0.85)' : 'rgba(255,255,255,0.9)';
    ctx.save();
    ctx.translate(STRIP_W / 2 + 0.5, (a + b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

function drawEvents(v: WorldHost): void {
  const ctx = v.ctx;
  const x0 = axisInset(v) + 6;
  const items: { text: string; sy: number }[] = [];
  if (v.world.ice) {
    const y0 = syAt(v, LGM.toKa / 1e3);
    const y1 = syAt(v, LGM.fromKa / 1e3);
    // Named only when the band is tall enough to be told from the label's line.
    if (y1 - y0 > 18) items.push({ text: 'last glacial maximum', sy: (Math.max(0, y0) + Math.min(v.h, y1)) / 2 });
  }
  if (!items.length) return;
  ctx.font = `600 11.5px 'Sofia Sans Condensed', 'Roboto Condensed', 'Arial Narrow', system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(12,23,20,0.9)';
  // Clear of the buttons at the top and the scale bar and key at the foot (as the axis's labels are).
  const placed = placeEventLabels(items, v.axisBoxes, (t) => ctx.measureText(t).width, x0, v.w * 0.62, 56, v.h - 74);
  for (const p of placed) {
    ctx.fillStyle = ICE_INK;
    ctx.strokeText(p.text, p.box[0], p.sy);
    ctx.fillText(p.text, p.box[0], p.sy);
  }
}
