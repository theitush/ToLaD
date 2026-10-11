// Tests only: a fixed camera scene must actually look at its species. Scenes are
// named by species and time; when the tree changes (a new split date, more
// species narrowing every column), a scene can end up looking at empty ground —
// the column leaning off screen near a split, or too thin to hold a pixel — and
// the tests built on it would then pass or fail on nothing. This says so by name.
import type { FanCamera } from './camera';
import { STEM_BOTTOM_MA, type FanBranch } from './layout';
import type { TwigModel } from './twigs';

/**
 * Throws unless the species' column is on screen and at least `minPx` wide on
 * the screen's middle row, and on screen on its top and bottom rows wherever it
 * has any width there (rows above now or below the world skipped).
 */
export function assertColumnOnScreen(c: FanCamera, b: FanBranch, m: TwigModel, label: string, minPx = 2): void {
  const yBottom = m.time.y(STEM_BOTTOM_MA);
  for (const py of [c.h / 2, 0, c.h]) {
    const [x0, y] = c.toWorld(0, py);
    const [x1] = c.toWorld(c.w, py);
    if (y < b.tipY || y > yBottom) continue;
    const L = m.lanes(y);
    const wPx = L.w * c.cam.sx;
    if (py !== c.h / 2 && !(wPx > 0)) continue;
    if (!(L.left < x1 && L.left + L.w > x0) || (py === c.h / 2 && wPx < minPx)) {
      throw new Error(`scene "${label}": the ${b.sp.common}'s column is ${wPx < minPx ? `${wPx.toPrecision(2)} px wide` : 'off screen'} at screen row ${py} — pick a time clear of its splits' leans, or a zoom where it shows`);
    }
  }
}
