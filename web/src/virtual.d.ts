declare module 'virtual:tolad-data' {
  /** Inlined data files (path → base64) in the single-file build, else null. */
  export const inlineData: Record<string, string> | null;
}

declare module 'virtual:panthera-data' {
  /** The Panthera subtree of data/mammals, decoded at build time (fan/panthera-extract.ts). */
  const data: import('./fan/panthera-extract').RawClade;
  export default data;
}
