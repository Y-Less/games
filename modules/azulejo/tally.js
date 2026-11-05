// What Azulejo counts about each player for the statistics and achievements (see module.json "stats").  The game calls
// tallyTake after each take of tiles; nothing here changes the game.
// Depends on: shared/tally.js (the counters) and ./rules.js (FLOOR_SLOTS).
import { bump, freshTally } from '../../shared/tally.js';
import { FLOOR_SLOTS } from './rules.js';

// Every counter a player's tally has.  Some are counted during the game (tallyTake); the rest are filled in by
// game.statsPlayers from the finished wall.
export const STAT_KEYS = ['rowsCompleted', 'columnsCompleted', 'colourSetsCompleted', 'floorPenalties', 'roundsPlayed', 'bottomRows', 'tilesTaken', 'tilesDropped', 'floorsFilled', 'gridsFilled', 'wallTiles', 'fullPlates', 'cleanWins'];
/**
 * A fresh tally for one seat, with every counter at zero.
 *
 * @returns {object} the tally, one counter per STAT_KEYS entry
 *
 * Side effects: none.
 */
export const newTally = () => freshTally(STAT_KEYS);

/**
 * Counts one take of tiles.
 *
 * @param {object} tally  the seat's tally
 * @param {object} take  what happened
 * @param {number} take.taken  how many tiles of the colour were taken
 * @param {number} take.dropped  how many of them could not go on the pattern line, plus one if the first-player marker came with them
 * @param {number} take.floorBefore  how many slots of the floor were filled before the take
 * @param {number} take.floorAfter  how many slots of the floor were filled after the take
 * @param {boolean} [take.wholePlate]  true when the take emptied a full plate on its own: every tile on it was the colour taken
 *
 * Side effects: mutates `tally` (tilesTaken, tilesDropped, fullPlates, and floorsFilled when the take fills the last floor slot).
 */
export function tallyTake(tally, { taken, dropped, floorBefore, floorAfter, wholePlate = false }) {
  bump(tally, 'tilesTaken', taken);
  bump(tally, 'tilesDropped', dropped);
  if (wholePlate) bump(tally, 'fullPlates');
  if (floorBefore < FLOOR_SLOTS && floorAfter === FLOOR_SLOTS) bump(tally, 'floorsFilled');
}
