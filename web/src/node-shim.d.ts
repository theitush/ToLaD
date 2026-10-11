// Minimal Node typings for vite.config.ts and the Vitest data tests (avoids a
// @types/node dependency).
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
  export function statSync(path: string): { isDirectory(): boolean };
  export function createReadStream(path: string): { pipe(dest: unknown): void };
  export function writeFileSync(path: string, data: string): void;
  export function appendFileSync(path: string, data: string): void;
}
declare module 'node:inspector/promises' {
  export class Session {
    connect(): void;
    post(method: string, params?: object): Promise<{ profile?: unknown }>;
  }
}
// (The perf tests read their options from the environment.)
declare const process: { env: Record<string, string | undefined> };
declare module 'node:path' {
  export function dirname(p: string): string;
  export function join(...p: string[]): string;
  export function resolve(...p: string[]): string;
}
declare module 'node:url' {
  export function fileURLToPath(u: string): string;
}
