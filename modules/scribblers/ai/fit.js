// What the computer players work out from the hints, shared by all of them.  Pure functions of plain data: no clock, no
// randomness of their own, nothing from the room they are not allowed to see.
// Depends on: nothing.

/**
 * The words that could still be the one being drawn, judged only on what everybody can see: the right number of
 * characters, the shown letters in the right places, and the spaces and hyphens where the hints have them.
 *
 * @param {{ ch: string | null }[]} hints  the hints as this seat sees them, one per character
 * @param {string[]} words  the list to choose from
 * @returns {string[]} the words that fit (empty when none do)
 * Side effects: none.
 */
export function wordsThatFit(hints, words) {
  if (!Array.isArray(hints) || !hints.length) return [];
  const known = hints.map((hint) => (typeof hint?.ch === 'string' ? hint.ch.toLowerCase() : null));
  return words.filter((word) => {
    const letters = [...word];
    if (letters.length !== known.length) return false;
    return known.every((ch, at) => ch === null || letters[at] === ch);
  });
}

/**
 * The words of the right length, whatever the shown letters say: what a player guesses when they are not paying
 * attention to the letters at all.
 *
 * @param {{ ch: string | null }[]} hints  the hints as this seat sees them
 * @param {string[]} words  the list to choose from
 * @returns {string[]} the words of that length
 * Side effects: none.
 */
export const wordsOfLength = (hints, words) => (Array.isArray(hints) && hints.length ? words.filter((word) => [...word].length === hints.length) : []);

/**
 * One of a list at random, or null if it is empty.
 *
 * @param {Array} pool  what to choose from (not changed)
 * @param {() => number} rng  random source
 * @returns {*} one member, or null
 * Side effects: none beyond advancing `rng`.
 */
export const oneOf = (pool, rng) => (pool.length ? pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))] : null);

/**
 * The first guess from a list of candidates that nobody has wasted already.
 *
 * @param {string[]} pool  the candidate words
 * @param {string[]} spent  the words already guessed (by this player, or by everybody)
 * @param {() => number} rng  random source
 * @returns {string | null} a word to guess, or null when there is nothing left to try
 * Side effects: none beyond advancing `rng`.
 */
export function freshGuess(pool, spent, rng) {
  const unspent = pool.filter((word) => !spent.includes(word));
  return oneOf(unspent.length ? unspent : [], rng);
}
