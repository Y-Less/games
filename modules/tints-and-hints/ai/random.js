// The only computer player for Tints and Hints, for testing: it has no real logic.  The grid is cut into 4 x 4 blocks of
// squares, each described by an object of a similar colour.  As the hinter it describes the block that holds its secret square; as a
// guesser it picks a random square from the block the latest hint describes (or any square, if the hint is not one of
// the descriptions, such as a person's own words).  Randomness comes only from the `rng` the game passes in.
import { COLS, ROWS, cellsDescribedBy, describeCell } from '../grid.js';


/**
 * Picks one item of a list using the game's random source.
 *
 * @param {Array} list  the items to choose from (must not be empty)
 * @param {() => number} rng  random source returning a number in [0, 1)
 * @returns {*} one item of `list`
 *
 * Side effects: none (calls `rng`, which advances its state).
 */
const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Describes the colour of the 4 x 4 block holding its square, and guesses a random square of the block a hint describes. For testing.',
  /**
   * Describes the colour block that contains the secret square, the most helpful hint a describer-based AI can give.
   *
   * @param {{tint: string}} ctx  `tint` is the hinter's secret square, such as 'B7'
   * @returns {string} the block's description, or the generic 'a colour' if the square is invalid
   *
   * Side effects: none.
   */
  hint: ({ tint }, rng) => describeCell(tint) ?? 'a colour',
  /**
   * Picks a random square from the block the latest hint describes (round 2 uses the second hint, otherwise the first).
   * If the hint is not one of the known descriptions (a person's own words) it picks from all legal squares instead,
   * since there is nothing to narrow the choice.  Defaults let it run with partial context in tests.
   *
   * @param {{round?: number, cells?: string[], hints?: {first?: string, second?: string}}} ctx  the round, the legal squares and the visible hints
   * @param {() => number} rng  random source
   * @returns {string} one of `cells`
   *
   * Side effects: none.
   */
  guess: ({ round = 1, cells = COLS.flatMap((c) => ROWS.map((r) => c + r)), hints = {} }, rng) => {
    const block = cellsDescribedBy(round === 2 ? hints.second : hints.first);
    return pick(block ? block.filter((c) => cells.includes(c)) : cells, rng);
  },
};

export default random;
