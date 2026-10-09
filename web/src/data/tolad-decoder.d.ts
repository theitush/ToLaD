// Types for the verbatim copy of pipeline/decoder/tolad-decoder.js (format v1).

export const FORMAT_VERSION: 1;
export const KIND_SKELETON: 0;
export const KIND_TILE: 1;
export const Q: {
  readonly AGE_STEPS_PER_DEX: number;
  readonly AGE_MIN_LOG10: number;
  readonly LOG16_STEPS_PER_DEX: number;
  readonly LOG16_MIN_LOG10: number;
  readonly LOHI_STEPS_PER_DEX: number;
  readonly PROFILE_STEPS_PER_DEX: number;
  readonly PROFILE_K: number;
  readonly PROFILE_RANGE: number;
};
export const FLAG: {
  readonly GRADE_MASK: number;
  readonly EXTINCT: number;
  readonly TAXONOMIC: number;
  readonly DATE_SHIFT: number;
  readonly SPECIES: number;
  readonly STUB: number;
  readonly ANCHORED: number;
  readonly GRAFT: number;
  readonly GROUP: number;
};
export const GRADES: string[];
export const DATE_SOURCES: string[];
export function dqAge(q: number): number;
export function dqLog16(q: number): number;
export function profileEdges(t0: number, t1: number): Float64Array;

export interface Columns {
  CHLD: Uint16Array;
  T0__: Uint16Array;
  T1__: Uint16Array;
  EVER: Uint16Array;
  ALIV: Uint16Array;
  GHST: Uint16Array;
  LOHI: Uint8Array;
  FLAG: Uint16Array;
  METH: Uint16Array;
  SRCM: Uint16Array;
  PPK_: Uint16Array;
  PROF: Uint8Array;
  NTIP: Uint32Array;
  GID_: Uint32Array;
  OTT_: Uint32Array;
  PBDB: Uint32Array;
  STUB?: Uint32Array;
}

export class TileFile {
  kind: number;
  n: number;
  col: Columns;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any;
  parent: Int32Array;
  stubs: Map<number, { tile: number; rep: string }>;
  names(i: number): string[];
  name(i: number): string;
  t0(i: number): number;
  t1(i: number): number;
  ever(i: number): number;
  alive(i: number): number;
  ghost(i: number): number;
  aliveFraction(i: number): number;
  everLo(i: number): number;
  everHi(i: number): number;
  flags(i: number): number;
  grade(i: number): string;
  extinct(i: number): boolean;
  taxonomic(i: number): boolean;
  dateSource(i: number): string;
  isSpecies(i: number): boolean;
  isStub(i: number): boolean;
  gid(i: number): number;
  ntips(i: number): number;
  ott(i: number): number | null;
  pbdb(i: number): number | null;
  methodIndex(i: number): number;
  sourceMask(i: number): number;
  representative(i: number): string;
  profile(i: number): Float64Array;
  children(i: number): number[];
  subtreeEnd(i: number): number;
}

export function decodeFile(input: ArrayBuffer | ArrayBufferView): TileFile;
export function describe(
  skeletonMeta: unknown,
  file: TileFile,
  i: number,
): { name: string; alt: string[]; method: string; sources: string[]; grade: string; dateSource: string };
