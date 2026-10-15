// Load stamps (ToLaD#255): performance marks named `tl:<step>` at each step of opening a level, read by the phone proxy
// (scripts/phoneperf.mjs, LOADONLY=1) so the load is timed without a profiler, which inflates the JavaScript it samples.
// main.tsx imports this module first: its own mark is the page's script starting (the HTML read, the script compiled).

/** Mark a step of the load (a no-op where there is no performance.mark). */
export function stamp(step: string): void {
  try {
    performance.mark('tl:' + step);
  } catch {
    /* no marks: not timed */
  }
}

stamp('script');
