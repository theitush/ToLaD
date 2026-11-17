// The rooms answered by range (ToLaD#502) against the whole rows they replaced, on the synthetic tree at 7,000 species
// (roomsref.ts; the yardstick's tree, synthetic-level.ts, with its orders and its seed).
import { describe, expect, it } from 'vitest';
import { layoutFan, layoutSeed } from './layout';
import { cladeOf } from './panthera';
import { checkRooms } from './roomsref';
import { nameOrders, ORDER_TAXA, treeOf } from './splits';
import { Steady } from './steady';
import { synthData, synthOrders } from './synthetic';

describe('the rooms by range, the synthetic 7k', () => {
  it('answer as the whole rows did, to the rounding; follow to the bit; the cull never drops a strand that shows', () => {
    const d = synthData({ n: 7000 });
    for (const name of synthOrders(d)) (ORDER_TAXA as Set<string>).add(name);
    const tree = nameOrders(treeOf(d.clade));
    const clade = cladeOf(d.clade, tree, 'Synthetic');
    const fan = layoutFan({ ...clade, seed: layoutSeed(clade, tree) }, 'linear', tree);
    const f = new Steady(fan);
    f.setAll(0);
    fan.tess.fold = f;
    const r = checkRooms(fan, f, 10, 7);
    console.log(JSON.stringify(r));
    expect(r.extent.worst).toBeLessThan(1e-13);
    expect(r.xRange.worst).toBeLessThan(1e-13);
    expect(r.xRange.wrong).toBe(0);
    expect(r.follow.exact).toBe(r.follow.n);
  }, 300000);
});
