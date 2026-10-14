declare module 'virtual:panthera-data' {
  /** The Felidae subtree of data/mammals, decoded at build time (fan/panthera-extract.ts). */
  const data: import('./fan/panthera-extract').RawClade;
  export default data;
  /** The clade's species' Wikipedia/Commons URLs (data/mammals/wiki.json, ToLaD#182). */
  export const wiki: Record<string, { wp?: string; img?: string; file?: string } | null>;
}

declare module 'virtual:carnivora-data' {
  /** The Carnivora subtree of data/mammals (ToLaD#146): only the species the fan draws. */
  const data: import('./fan/panthera-extract').RawClade;
  export default data;
}
