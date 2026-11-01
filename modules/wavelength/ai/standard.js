// The usual computer players: they know the example clues of a spectrum (see spectra.js). As the psychic they say the
// example nearest the hidden spot. As a guesser they turn the dial to the place of the example the clue matches, with
// some wobble, or near the middle when the clue is not one they know (such as a person's own words).
//
//   clue({ target, anchors }, rng)               -> the clue text
//   guess({ clue, anchors }, rng)                -> a position from 0 to 100
// Depends on nothing; the anchors and rng are passed in. The two variants differ only in `wobble` (steadiness of hand).

/**
 * Builds a computer player that knows the spectrum's example clues, with a given amount of dial wobble.
 *
 * @param {object} options  the player's definition
 * @param {string} options.id  unique AI id
 * @param {string} options.name  display name
 * @param {string} options.description  one-line description shown to players
 * @param {number} options.weight  how likely it is to be picked when the game chooses an AI at random
 * @param {number} options.wobble  full width of the guess noise in dial points (bigger means less accurate)
 * @returns {{id: string, name: string, description: string, weight: number, clue: Function, guess: Function}} the AI object
 *
 * Side effects: none.
 */
export function makeStandard({ id, name, description, weight, wobble }) {
  /** Noise in [-wobble, wobble]: the sum of two uniforms, so small errors are likelier than large ones, like a human hand. */
  const noise = (rng) => (rng() + rng() - 1) * wobble; // two uniforms: bunched towards zero
  /** Finds the example whose text equals the clue (case and outer spaces ignored), or undefined if it is not an example. */
  const known = (clue, anchors) => anchors.find((a) => a.text.toLowerCase() === String(clue ?? '').trim().toLowerCase());
  return {
    id,
    name,
    description,
    weight,
    /**
     * Gives the example clue whose position is nearest the target, the best a clue-bank player can do.
     *
     * @param {{target: number, anchors: {position: number, text: string}[]}} ctx  the secret position and the examples
     * @returns {string} the nearest example's text
     *
     * Side effects: none.
     */
    clue: ({ target, anchors }) => anchors.reduce((best, a) => (Math.abs(a.position - target) < Math.abs(best.position - target) ? a : best)).text,
    /**
     * Turns the dial to the position of the example the clue matches, plus wobble. An unrecognised clue (a person's own
     * words, which this AI cannot interpret) falls back to the middle with double wobble, since the middle minimises the
     * worst-case error when nothing is known.
     *
     * @param {{clue: string, anchors: {position: number, text: string}[]}} ctx  the visible clue and the examples
     * @param {() => number} rng  random source
     * @returns {number} a dial position (may stray slightly outside 0 to 100; the game clamps it)
     *
     * Side effects: none.
     */
    guess: ({ clue, anchors }, rng) => {
      const anchor = known(clue, anchors);
      return anchor ? anchor.position + noise(rng) : 50 + noise(rng) * 2;
    },
  };
}

export const standard = makeStandard({
  id: 'standard',
  name: 'Standard',
  description: 'Knows the example clues well and turns the dial to within a few points of them.',
  weight: 3,
  wobble: 12,
});

export const wobbly = makeStandard({
  id: 'wobbly',
  name: 'Wobbly',
  description: 'Knows the example clues but has an unsteady hand.',
  weight: 2,
  wobble: 30,
});

export default standard;
