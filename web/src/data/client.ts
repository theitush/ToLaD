// Main-thread side of the data worker.

import type { ProcessedFile } from './river';
import DataWorker from './worker?worker&inline';

interface Reply {
  id: number;
  ok: boolean;
  file?: ProcessedFile;
  error?: string;
  ms?: number;
  bytes?: number;
}

export interface LoadStat {
  tile: number;
  ms: number;
  bytes: number;
}

export class DataClient {
  private worker: Worker;
  private next = 1;
  private waiting = new Map<number, { resolve: (p: ProcessedFile) => void; reject: (e: Error) => void; tile: number }>();
  readonly stats: LoadStat[] = [];
  /** The worker told where the files are (the single-file build's inlined copy is a sibling script, imported first). */
  private ready: Promise<void>;

  constructor(base: string) {
    this.worker = new DataWorker();
    this.worker.onmessage = (ev: MessageEvent<Reply>) => {
      const r = ev.data;
      const w = this.waiting.get(r.id);
      if (!w) return;
      this.waiting.delete(r.id);
      if (r.ok && r.file) {
        this.stats.push({ tile: w.tile, ms: r.ms ?? 0, bytes: r.bytes ?? 0 });
        w.resolve(r.file);
      } else w.reject(new Error(r.error ?? 'worker error'));
    };
    // (Its own chunk, not in the page: the fan never reads it, and the page would parse its ~4 MB at every open, ToLaD#255.)
    this.ready = import('virtual:tolad-data').then(({ inlineData }) => {
      this.worker.postMessage({ type: 'init', base: inlineData ? null : base, inline: inlineData });
    });
  }

  load(tile: number): Promise<ProcessedFile> {
    const id = this.next++;
    return this.ready.then(
      () =>
        new Promise((resolve, reject) => {
          this.waiting.set(id, { resolve, reject, tile });
          this.worker.postMessage({ type: 'load', id, tile });
        }),
    );
  }

  destroy(): void {
    this.worker.terminate();
  }
}

/** URL of data/mammals/ next to the page. */
export function dataBase(): string {
  return new URL('data/mammals/', document.baseURI).href;
}
