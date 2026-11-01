// A computer player that only moves a limited number of the tiles already on the table in one turn (it can always add to
// sets and make new ones from its own rack). The limit is the "table-tile budget"; see search.js.
import { shufflePlay } from '../search.js';

// Depends on ../search.js (shufflePlay). The three shuffler-N.js files differ only in the limit they pass here: a bigger
// limit finds more plays but takes more table tiles apart, which is what separates the easy opponents from the hard ones.

/**
 * Builds an AI object that rearranges at most `tableTiles` tiles already on the table in a turn.
 *
 * @param {object} def
 * @param {string} def.id  the AI's stable id (saved in rooms)
 * @param {string} def.name  display name
 * @param {string} def.description  display description
 * @param {number} def.tableTiles  how many table tiles it may move in one turn
 * @param {number} [def.weight]  relative chance of being picked by a random choice of AI
 * @returns {object} an AI { id, name, description, weight, tableTiles, plan(room, seat, options) }
 * Side effects: none (plan itself does not change the room).
 */
export function makeShuffler({ id, name, description, tableTiles, weight = 1 }) {
  return { id, name, description, weight, tableTiles, plan: (room, seat, options = {}) => shufflePlay(room, seat, { tableTiles, ...options }) };
}
