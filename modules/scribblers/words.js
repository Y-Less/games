// The words people draw, and how a typed guess is compared with one.  The list in words/en.txt comes from scribble.rs
// (BSD 3-Clause; see README.md), one word per line, lowercase; a new language is another file beside it.
// Depends on: node:fs and node:path only (read once, then cached), so the rules stay free of the file system.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The languages a word list exists for; a game in any other language draws the English words. */
export const WORD_LANGUAGES = ['en'];
/** The language used when the room asks for one with no list of its own. */
export const DEFAULT_LANGUAGE = 'en';

const lists = new Map(); // language -> the words, read from disk the first time they are wanted

/**
 * The words of one language, read from words/<language>.txt the first time and kept.
 *
 * @param {string} [language]  a language tag; anything without a list of its own falls back to English
 * @returns {string[]} the words, lowercase, in the order the file has them (never empty)
 * Side effects: reads the file once per language and caches it.
 */
export function wordList(language = DEFAULT_LANGUAGE) {
  const wanted = WORD_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
  let words = lists.get(wanted);
  if (!words) {
    // A word twice over in the file would be twice as likely to come up, and could even be offered twice in the same
    // turn, so the list is made unique as it is read.
    const lines = fs
      .readFileSync(path.join(here, 'words', `${wanted}.txt`), 'utf8')
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);
    words = [...new Set(lines)];
    lists.set(wanted, words);
  }
  return words;
}

/**
 * Draws words for a drawer to choose between: different from each other, and from the words already played this game
 * (unless the game has run through the whole list, when the used ones come back).
 *
 * @param {number} count  how many to offer
 * @param {string[]} used  the words already played in this game
 * @param {() => number} rng  random source (required: the rules are seeded)
 * @param {string} [language]  which list to draw from
 * @returns {string[]} `count` words (fewer only if the list itself is shorter)
 * Side effects: none beyond advancing `rng`.
 */
export function pickWords(count, used, rng, language = DEFAULT_LANGUAGE) {
  const all = wordList(language);
  const seen = new Set(used);
  let pool = all.filter((word) => !seen.has(word));
  if (pool.length < count) pool = all;
  // A partial shuffle of the places in the pool: each draw swaps one unused place to the front, so no word comes twice
  // and no draw is ever thrown away.
  const places = [...pool.keys()];
  const wanted = Math.max(0, Math.min(Math.trunc(count), pool.length));
  const picked = [];
  for (let i = 0; i < wanted; i++) {
    const j = Math.min(places.length - 1, i + Math.floor(rng() * (places.length - i)));
    [places[i], places[j]] = [places[j], places[i]];
    picked.push(pool[places[i]]);
  }
  return picked;
}

// ---------- words the players add themselves ----------

/** The longest a word somebody adds may be, and how many a room will hold (game.js checks both). */
export const CUSTOM_LENGTH = 24;
export const CUSTOM_WORDS = 60;

/** What a word somebody adds may be made of: letters (of any language), digits, spaces, hyphens and apostrophes. */
export const CUSTOM_WORD = /^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u;

/**
 * The ten words of the "Had to be done" achievement (module.json, "juvenile"): the ones a table of grown adults cannot
 * be trusted with.  They are in words/en.txt like any other word, so a drawer may simply be offered one; the
 * achievement is for the drawer who then *picks* it rather than taking one of the others on offer, which is a choice
 * rather than an accident.  Ten of the list's least drawable abstractions came out when they went in, so the list is
 * still a round 5,000.
 */
export const JUVENILE = ['arse', 'bollocks', 'boobs', 'bum', 'cum', 'dick', 'fart', 'nipples', 'penis', 'willy'];

/**
 * Is this one of the juvenile ten?  Compared like a guess, so "Boobs" and "boobs" are the same word.
 * @param {string} word  the word
 * @returns {boolean}
 * Side effects: none.
 */
export const isJuvenile = (word) => JUVENILE.includes(cleanText(word));

/**
 * Strips what should not change whether a guess counts: capitals, accents, spaces, hyphens, and underscores, so that
 * "Pac-Man" and "pac man" are the same word.  (scribble.rs does the same before comparing.)
 *
 * @param {string} text  any text
 * @returns {string} the text reduced to its comparable letters
 * Side effects: none.
 */
export const cleanText = (text) =>
  String(text)
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\s\-_]/gu, '');

/**
 * Whether a guess is the word, nearly the word, or neither.  "Nearly" is one character wrong, one missing, one too many,
 * or two neighbours swapped - the same rule as scribble.rs, which tells a player they are close without telling the rest
 * of the table what the word is.
 *
 * @param {string} guess  what was typed
 * @param {string} word   the word being drawn
 * @returns {'exact' | 'close' | 'wrong'}
 * Side effects: none.
 */
export function guessQuality(guess, word) {
  const a = [...cleanText(guess)];
  const b = [...cleanText(word)];
  if (a.length === b.length && a.every((ch, i) => ch === b[i])) return 'exact';
  if (Math.abs(a.length - b.length) > 1) return 'wrong';
  // One edit at most: walk both until they differ, then try the three single edits (and a swap) from that point.
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const same = (x, from, y, at) => x.slice(from).join('\u0000') === y.slice(at).join('\u0000');
  if (a.length === b.length) {
    if (same(a, i + 1, b, i + 1)) return 'close'; // one character wrong
    if (a[i] === b[i + 1] && a[i + 1] === b[i] && same(a, i + 2, b, i + 2)) return 'close'; // two swapped
    return 'wrong';
  }
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  return same(longer, i + 1, shorter, i) ? 'close' : 'wrong';
}
