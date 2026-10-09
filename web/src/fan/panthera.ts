// The Panthera subtree of data/mammals (tile t/10.tld, gid 17681), extracted with
// the v1 decoder. Counts, ranges, grades and dates are the dataset's own values
// (EVER/ALIV are dequantized, so they are the numbers the river shows too).
// Internal nodes of the subtree are flattened: this slice shows Panthera as one
// polytomy. `order` keeps the tree's left-to-right order so sisters stay adjacent.
//
// Generation lengths are not in the v1 tiles. Living species use the IUCN Red
// List assessment values (≈ Pacifici et al. 2013); fossil species are derived
// from a body-mass estimate with GL ∝ mass^0.25, anchored on the lion
// (7 y at 160 kg). Both are marked in `genSource`.

export type Grade = 'A' | 'B' | 'C' | 'D';

export interface SpeciesRec {
  gid: number;
  sci: string;
  common: string;
  /** Individuals ever lived (central estimate) and its range. */
  ever: number;
  everLo: number;
  everHi: number;
  /** Individuals alive now. */
  alive: number;
  grade: Grade;
  /** First and last appearance, millions of years ago (t1 = 0: still alive). */
  t0: number;
  t1: number;
  extinct: boolean;
  dateSource: string;
  /** Generation length in years. */
  genYears: number;
  genSource: string;
  /** Sister group index, from the tree (species sharing it are sisters). */
  clade: number;
}

export interface CladeRec {
  gid: number;
  sci: string;
  common: string;
  ever: number;
  everLo: number;
  everHi: number;
  alive: number;
  grade: Grade;
  t0: number;
  t1: number;
  species: SpeciesRec[];
}

const IUCN = 'IUCN generation length';
const mass = (kg: number) => `derived from ~${kg} kg body mass`;
const glFromMass = (kg: number) => Math.round(7 * Math.pow(kg / 160, 0.25) * 10) / 10;

export const PANTHERA: CladeRec = {
  gid: 17681,
  sci: 'Panthera',
  common: 'Big cats',
  ever: 529663443891.6581,
  everLo: 1056817509.2136586,
  everHi: 187931681680326.88,
  alive: 216271.85237270244,
  grade: 'D',
  t0: 4.909078761526029,
  t1: 0,
  species: [
    {
      gid: 17683, sci: 'Panthera tigris', common: 'Tiger',
      ever: 2944421633.7987695, everLo: 294442163.379877, everHi: 29444216337.987694,
      alive: 3917.4187710778306, grade: 'C', t0: 3.0060763026282293, t1: 0, extinct: false,
      dateSource: 'interpolated', genYears: 7.7, genSource: IUCN, clade: 0,
    },
    {
      gid: 17684, sci: 'Panthera uncia', common: 'Snow leopard',
      ever: 5636376558.259561, everLo: 563637655.8259561, everHi: 56363765582.595604,
      alive: 7498.942093324558, grade: 'C', t0: 3.0060763026282293, t1: 0, extinct: false,
      dateSource: 'interpolated', genYears: 8, genSource: IUCN, clade: 0,
    },
    {
      gid: 17686, sci: 'Panthera pardus', common: 'Leopard',
      ever: 92469817393.82248, everLo: 4634469197.362891, everHi: 1845015419179.4783,
      alive: 108642.56236170644, grade: 'C', t0: 3.9567019164833632, t1: 0, extinct: false,
      dateSource: 'interpolated', genYears: 7.3, genSource: IUCN, clade: 1,
    },
    {
      gid: 17688, sci: 'Panthera leo', common: 'Lion',
      ever: 40179081084.89392, everLo: 4017908108.4893923, everHi: 401790810848.9392,
      alive: 31988.95109691404, grade: 'C', t0: 3.761259808878079, t1: 0, extinct: false,
      dateSource: 'interpolated', genYears: 7, genSource: IUCN, clade: 2,
    },
    {
      gid: 17689, sci: 'Panthera onca', common: 'Jaguar',
      ever: 49090787615.26019, everLo: 4909078761.526019, everHi: 490907876152.6019,
      alive: 63973.48354826469, grade: 'C', t0: 3.761259808878079, t1: 0, extinct: false,
      dateSource: 'interpolated', genYears: 7, genSource: IUCN, clade: 2,
    },
    {
      gid: 17690, sci: 'Panthera spelaea', common: 'Cave lion',
      ever: 73282453313.89014, everLo: 260015956.31652614, everHi: 20653801558105.223,
      alive: 0, grade: 'D', t0: 3.9567019164833632, t1: 0.011699482891272067, extinct: true,
      dateSource: 'interpolated', genYears: glFromMass(300), genSource: mass(300), clade: 3,
    },
    {
      gid: 17691, sci: 'Panthera balamoides', common: 'Yucatán cave cat',
      ever: 4591980128.368676, everLo: 8165823.713585907, everHi: 2582260190634.5903,
      alive: 0, grade: 'D', t0: 0.1290228606427681, t1: 0.011699482891272067, extinct: true,
      dateSource: 'fossil-range', genYears: glFromMass(150), genSource: mass(150), clade: 4,
    },
    {
      gid: 17692, sci: 'Panthera zdanskyi', common: 'Longdan tiger',
      ever: 70794578438.41402, everLo: 125892541.17941713, everHi: 39810717055349.85,
      alive: 0, grade: 'D', t0: 2.580278993104113, t1: 0.7738676044649041, extinct: true,
      dateSource: 'fossil-range', genYears: glFromMass(80), genSource: mass(80), clade: 5,
    },
    {
      gid: 17693, sci: 'Panthera gombaszoegensis', common: 'European jaguar',
      ever: 139636836105.59363, everLo: 248313310.5295568, everHi: 78523563461007.1,
      alive: 0, grade: 'D', t0: 3.9567019164833632, t1: 0.39279564737919476, extinct: true,
      dateSource: 'fossil-range', genYears: glFromMass(110), genSource: mass(110), clade: 6,
    },
  ],
};
