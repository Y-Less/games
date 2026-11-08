// The one computer player Draw! has.  Scribblers gives its computer players personalities, because a turn there is
// long enough for one to show; a round here is over in a few seconds, and there are no letters revealed to be clever
// about, so there is only this: pick a word to draw, and guess words that are the right shape.
//
// It decides from plain data (see game.js, aiContext) and never touches the clock, the network or Math.random: the
// random source it is given is the room's, so a seeded game replays exactly.  What it *draws* is not here either -
// that needs the web, and is server.js's work (shared/picture.js).
// Depends on: nothing.

/**
 * Which of the words offered to draw: the shortest, which is the likeliest to be something it can find a picture of.
 * @param {{ choices: string[], rng: () => number }} context  what the computer player may know
 * @returns {number} the place of the word it picks
 * Side effects: none beyond advancing the random source.
 */
function chooseWord({ choices, rng }) {
  if (!choices.length) return 0;
  const shortest = Math.min(...choices.map((word) => word.length));
  const wanted = choices.flatMap((word, n) => (word.length === shortest ? [n] : []));
  return wanted[Math.min(wanted.length - 1, Math.floor(rng() * wanted.length))];
}

/**
 * A guess at either drawing: a word of the same shape as one of them, never one already tried at this table.  With
 * two drawings to choose from it has two shapes to fit, which is also why it guesses rather more than it would
 * against one.
 *
 * @param {object} context  what the computer player may know
 * @param {Array<Array<string | null>>} context.shapes  the two words as they are shown: punctuation, and a blank per letter
 * @param {string[]} context.words  the whole word list
 * @param {string[]} context.tried  what this player has already guessed this round
 * @param {string[]} context.seen  what everybody has guessed this round
 * @param {() => number} context.rng  random source
 * @returns {string} the word it guesses
 * Side effects: none beyond advancing the random source.
 */
function guess({ shapes, words, tried, seen, rng }) {
  const already = new Set([...tried, ...seen].map((word) => word.toLowerCase()));
  const lengths = new Set((shapes ?? []).filter((shape) => shape.length).map((shape) => shape.length));
  const fits = (word) => (lengths.size ? lengths.has(word.length) : true) && !already.has(word.toLowerCase());
  const wanted = words.filter(fits);
  const from = wanted.length ? wanted : words;
  return from[Math.min(from.length - 1, Math.floor(rng() * from.length))] ?? 'something';
}

/** The computer player: what it draws and what it guesses, as plain functions of what it is told. */
export const AI = { id: 'standard', name: 'Standard', chooseWord, guess };
