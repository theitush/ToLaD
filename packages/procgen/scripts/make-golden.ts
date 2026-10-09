/**
 * Regenerate test/golden.json. Only for intentional breaking changes: every
 * public ID, parent link and attribute is pinned by this fixture.
 */
import { writeFileSync } from 'node:fs';
import { computeGolden } from '../test/golden-cases.ts';

const path = new URL('../test/golden.json', import.meta.url);
writeFileSync(path, JSON.stringify(computeGolden(), null, 1) + '\n');
console.log('wrote', path.pathname);
