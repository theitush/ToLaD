// Minimal Node typings for vite.config.ts and the Vitest data tests (avoids a
// @types/node dependency).
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
  export function statSync(path: string): { isDirectory(): boolean };
  export function createReadStream(path: string): { pipe(dest: unknown): void };
}
declare module 'node:path' {
  export function dirname(p: string): string;
  export function join(...p: string[]): string;
  export function resolve(...p: string[]): string;
}
declare module 'node:url' {
  export function fileURLToPath(u: string): string;
}
