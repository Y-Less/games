// How the stand-alone bot guesses: it knows what everybody else knows and no more - how many letters the word has,
// which of them have been shown, and where the spaces and hyphens are - and tries a word from the same list the game
// draws from, once a second.
// Depends on: ../words.js (the word list) only.

/**
 * The words that could still be the one being drawn, judged only on what the hints show: the right number of
 * characters, the shown letters in the right places, and the spaces and hyphens where the hints have them.
 *
 * @param {{ ch: string | null, fixed: boolean }[]} hints  the hints from the view, one per character
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
 * The bot's next guess: one of the words that fit, at random, leaving out the ones it has already tried.  When nothing
 * fits (the word is not in the list, or the hints are odd) it tries a word of the right length instead, and failing
 * that any word at all, so it always says something.
 *
 * @param {object} options
 * @param {{ ch: string | null, fixed: boolean }[]} options.hints  the hints from the view
 * @param {string[]} options.words  the word list
 * @param {Set<string>} [options.tried]  what it has already guessed this turn
 * @param {() => number} [options.rng]  random source
 * @returns {string | null} the guess, or null when it has nothing left to try
 * Side effects: none (the caller adds the guess to `tried`).
 */
export function pickGuess({ hints, words, tried = new Set(), rng = Math.random }) {
  const fits = wordsThatFit(hints, words).filter((word) => !tried.has(word));
  const sameLength = fits.length ? fits : words.filter((word) => [...word].length === (hints?.length ?? 0) && !tried.has(word));
  const pool = sameLength.length ? sameLength : words.filter((word) => !tried.has(word));
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}
