declare module 'virtual:panthera-data' {
  /** The Felidae subtree of data/mammals, decoded at build time (fan/panthera-extract.ts). */
  const data: import('./fan/panthera-extract').RawClade;
  export default data;
  /** The natural level's source, on its own: the page reads this and not the clade (ToLaD#418). */
  export const naturalMeta: import('./fan/panthera-extract').NaturalMeta | null;
  /** The carnivores' Wikipedia/Commons URLs (data/mammals/wiki.json, ToLaD#182), for tests and dev; empty in the page, whose are in mammals.json (ToLaD#418). */
  export const wiki: Record<string, { wp?: string; img?: string; file?: string } | null>;
}

declare module 'virtual:carnivora-data' {
  /** The Carnivora subtree of data/mammals (ToLaD#146): only the species the fan draws. */
  const data: import('./fan/panthera-extract').RawClade;
  export default data;
}
