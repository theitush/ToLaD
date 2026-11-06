// The gaps follow the clades (ToLaD#408, `?gaps=clades`): one rule at every split and level, fixed in the world.
// CLADEGAPS_OUT=1: prints each level's share of the width at "now" and its widest gaps in px at its home.
import { describe, expect, it } from 'vitest';
import { Territories } from './cut';
import { CLADE_SUM, GAP_SUM, GROUP_SUM } from './fold';
import { isNode, layoutFan, type FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { Steady } from './steady';

const SCREEN = 390;
const LEVELS: [string, () => CladeRec, () => Split][] = [
  ['cats', () => FELIDAE, () => FELIDAE_TREE],
  ['carnivores', () => CARNIVORA, () => CARNIVORA_TREE],
  ['mammals', mammaliaClade, mammaliaTree],
];

/** The fan's gaps' share of its width at "now": neighbouring living strands stand apart by the widest gap between them. */
function shareAtNow(f: Steady): number {
  const S = f.strands;
  const yNow = f.fan.time.y(0);
  let rooms = 0;
  let gaps = 0;
  let prev = -1;
  let widest = 0;
  for (let i = 0; i < S.length; i++) {
    if (S[i].tipY <= yNow + 1e-9) {
      rooms += Math.max(S[i].width, S[i].baseW);
      if (prev >= 0) gaps += widest;
      prev = i;
      widest = 0;
    }
    if (i < f.pairGap.length) widest = Math.max(widest, f.pairGap[i]);
  }
  return gaps / (rooms + gaps);
}

describe('gaps: clades (ToLaD#408)', () => {
  for (const [name, clade, tree] of LEVELS) {
    describe(name, () => {
      const build = async (gaps: 'clades' | 'groups' = 'clades') => {
        if (name === 'mammals') await loadMammalsFromFiles();
        const fan = layoutFan(clade(), 'linear', tree());
        const fold = new Steady(fan, false, true, gaps);
        fan.tess.fold = fold;
        return { fan, fold };
      };

      it('a split stands at least as wide as any split inside either daughter', async () => {
        const { fold } = await build();
        const gapOf = new Map<FanNode, number>();
        fold.pairNode.forEach((v, p) => gapOf.set(v, Math.max(gapOf.get(v) ?? 0, fold.pairGap[p])));
        const widestIn = (v: FanNode): number => {
          let inner = 0;
          for (const k of v.kids) if (isNode(k)) inner = Math.max(inner, widestIn(k));
          const own = gapOf.get(v) ?? inner;
          expect(own).toBeGreaterThanOrEqual(inner);
          return own;
        };
        expect(fold.pairGap.every((g) => g > 0)).toBe(true);
        widestIn(fold.fan.root);
      });

      it('the positions do not depend on the width zoom: a pinch is a pure stretch', async () => {
        const { fold } = await build();
        fold.setScale(0.01, SCREEN);
        const c0 = fold.rooms().C.slice();
        const l0 = fold.rooms().roomL.slice();
        fold.setScale(1e4, SCREEN);
        expect(Array.from(fold.rooms().C)).toEqual(Array.from(c0));
        expect(Array.from(fold.rooms().roomL)).toEqual(Array.from(l0));
      });

      it('takes its one share of the width at "now"', async () => {
        const { fold } = await build();
        expect(shareAtNow(fold)).toBeCloseTo(CLADE_SUM, 6);
      });

      it('a clade is framed by its own width: its frame takes no more of a gap beside it than its padding', async () => {
        const { fan, fold } = await build();
        fold.setScale(1, SCREEN);
        const T = new Territories(fan, fold, SCREEN);
        const { roomL, roomW } = fold.rooms();
        fan.nodes.forEach((v, j) => {
          if (!v.parent) return;
          const [a, b] = T.frameSpan(j);
          const [p, q] = T.span(j);
          // (Inside the territory, around the clade.)
          expect(a).toBeGreaterThanOrEqual(p - 1e-9);
          expect(b).toBeLessThanOrEqual(q + 1e-9);
          expect(a).toBeLessThanOrEqual(roomL[j] + 1e-9);
          expect(b).toBeGreaterThanOrEqual(roomL[j] + roomW[j] - 1e-9);
        });
      });

      it.runIf(process.env.CLADEGAPS_OUT)('prints its numbers', async () => {
        const { fold } = await build();
        const [x0, x1] = fold.homeExtent();
        const home = (SCREEN - 72) / (x1 - x0);
        const ranked = Array.from(fold.pairGap, (g) => g * home).sort((p, q) => q - p);
        const px = [1, 2, 3, 4, 8, 16, 27, 50, 100].map((r) => `#${r} ${ranked[r - 1]?.toFixed(2)}`).join(', ');
        const { fold: g } = await build('groups');
        console.log(`${name}: clades ${(100 * shareAtNow(fold)).toFixed(1)}% vs groups ${(100 * shareAtNow(g)).toFixed(1)}% (GAP_SUM+GROUP_SUM ${GAP_SUM + GROUP_SUM}); px at home on ${SCREEN - 72}: ${px}; >=1px ${ranked.filter((q) => q >= 1).length} of ${ranked.length}`);
      });
    });
  }
});
