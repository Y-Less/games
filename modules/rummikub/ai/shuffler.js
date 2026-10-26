// A computer player that only moves a limited number of the tiles already on the table in one turn (it can always add to
// sets and make new ones from its own rack). The limit is the "table-tile budget"; see search.js.
import { shufflePlay } from '../search.js';

export function makeShuffler({ id, name, description, tableTiles, weight = 1 }) {
  return { id, name, description, weight, tableTiles, plan: (room, seat, options = {}) => shufflePlay(room, seat, { tableTiles, ...options }) };
}
