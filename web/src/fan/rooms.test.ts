// The rooms answered by range (ToLaD#502) against the whole rows they replaced, on the mammals (roomsref.ts).
import { describe, expect, it } from 'vitest';
import { layoutFan } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { checkRooms } from './roomsref';
import { mammaliaTree } from './splits';
import { Steady } from './steady';

await loadMammalsFromFiles();

describe('the rooms by range, the mammals', () => {
  it('answer as the whole rows did, to the rounding; follow and the row spans to the bit; the cull never drops a strand that shows', () => {
    const fan = layoutFan(mammaliaClade(), 'linear', mammaliaTree());
    const f = new Steady(fan);
    f.setAll(0);
    fan.tess.fold = f;
    const r = checkRooms(fan, f);
    console.log(JSON.stringify(r));
    expect(r.extent.worst).toBeLessThan(1e-13);
    expect(r.xRange.worst).toBeLessThan(1e-13);
    expect(r.xRange.wrong).toBe(0);
    expect(r.runs.wrong).toBe(0);
    expect(r.follow.exact).toBe(r.follow.n);
    expect(r.span.exact).toBe(r.span.n);
  });
});
