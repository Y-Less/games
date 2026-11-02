// A computer player that knows nothing about the dial: as the psychic it says any example clue, and as a guesser it
// turns the dial to a random place (leaning towards the middle, where most targets are).  For testing.
// Depends on nothing: all randomness comes from the `rng` the game passes in.

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
  description: 'Gives any example clue, and guesses anywhere on the dial. For testing.',
  weight: 0.5,
  /**
   * Says any example clue of the spectrum, ignoring the target (that is what makes it a useless psychic).
   *
   * @param {{anchors: {position: number, text: string}[]}} ctx  the spectrum's example clues
   * @param {() => number} rng  random source
   * @returns {string} the clue text, or 'something' if the spectrum has no examples
   *
   * Side effects: none.
   */
  clue: ({ anchors }, rng) => pick(anchors, rng)?.text ?? 'something',
  /**
   * Guesses a random place from 15 to 85: the extremes are avoided because few targets sit at the very ends.
   *
   * @param {object} ctx  unused (the clue is ignored)
   * @param {() => number} rng  random source
   * @returns {number} a dial position from 15 to 85
   *
   * Side effects: none.
   */
  guess: (ctx, rng) => 15 + rng() * 70,
};

export default random;
