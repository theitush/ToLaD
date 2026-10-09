declare module 'virtual:tolad-data' {
  /** Inlined data files (path → base64) in the single-file build, else null. */
  export const inlineData: Record<string, string> | null;
}
