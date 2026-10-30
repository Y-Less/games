// What Azulejo counts about each player for the statistics and achievements (see module.json "stats"). The game calls
// tallyTake after each take of tiles; nothing here changes the game.
import { bump, freshTally } from '../../shared/tally.js';
import { FLOOR_SLOTS } from './rules.js';

export const STAT_KEYS = ['rowsCompleted', 'columnsCompleted', 'colourSetsCompleted', 'floorPenalties', 'roundsPlayed', 'bottomRows', 'tilesTaken', 'tilesDropped', 'floorsFilled', 'gridsFilled'];
export const newTally = () => freshTally(STAT_KEYS);

/**
 * Counts one take of tiles.
 *   taken       how many tiles of the colour were taken
 *   dropped     how many of them could not go on the pattern line, plus one if the first-player marker came with them
 *   floorBefore, floorAfter  how many slots of the floor were filled before and after the take
 */
export function tallyTake(tally, { taken, dropped, floorBefore, floorAfter }) {
  bump(tally, 'tilesTaken', taken);
  bump(tally, 'tilesDropped', dropped);
  if (floorBefore < FLOOR_SLOTS && floorAfter === FLOOR_SLOTS) bump(tally, 'floorsFilled');
}
