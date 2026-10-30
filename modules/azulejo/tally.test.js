import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_SLOTS } from './rules.js';
import { newTally, tallyTake } from './tally.js';

test('a take counts the tiles, the ones dropped, and the floor filling up once', () => {
  const tally = newTally();
  tallyTake(tally, { taken: 3, dropped: 2, floorBefore: 0, floorAfter: 2 });
  assert.deepEqual([tally.tilesTaken, tally.tilesDropped, tally.floorsFilled], [3, 2, 0]);
  tallyTake(tally, { taken: 4, dropped: 4, floorBefore: 3, floorAfter: FLOOR_SLOTS });
  assert.equal(tally.floorsFilled, 1);
  tallyTake(tally, { taken: 2, dropped: 2, floorBefore: FLOOR_SLOTS, floorAfter: FLOOR_SLOTS });
  assert.equal(tally.floorsFilled, 1, 'taking more with a full floor is not filling it again');
  assert.equal(tally.tilesDropped, 8, 'tiles that no longer fit on the floor were still dropped');
});
