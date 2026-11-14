// What the games where people type guesses at a drawing have in common (Scribblers, Draw!): how a guess is tidied,
// the feed of what everybody has typed, how fast one player may type, which characters of a word are never hidden,
// and how a computer player takes its turn at guessing.  The rules of each game - what a right guess scores, who may
// guess, when a turn ends - stay in the game.
//
// A room that uses this keeps `feed` (the lines, oldest first) and `nextFeed` (the number the next line gets), and a
// player keeps `tries` (how many guesses they have had this turn) and their recent times under `talk`.
// Depends on: ./ai.js (attempt) and ./input.js (textFrom).  No sockets, files, clock, or randomness of its own.
import { attempt } from './ai.js';
import { textFrom } from './input.js';

/** The longest guess accepted, in characters (a guess is a word, not an essay). */
export const GUESS_LENGTH = 60;
/** How many lines the feed keeps. */
export const FEED_LENGTH = 60;
/** How fast one player may type: five in three seconds, as scribble.rs allows. */
export const TALK_BURST = 5;
export const TALK_WINDOW_MS = 3000;
/** The characters of a word that are shown from the start, because they are not letters to be guessed. */
export const ALWAYS_SHOWN = [' ', '-', '_', '.', '/'];

/**
 * What a client typed, as the guess the rules will look at: runs of white space become one space, the ends are
 * trimmed, and anything past GUESS_LENGTH is dropped.
 * @param {unknown} text  whatever the client sent
 * @returns {string} the guess, which is empty when nothing usable was typed
 * Side effects: none.
 */
export const cleanGuess = (text) => textFrom(text).replace(/\s+/g, ' ').trim().slice(0, GUESS_LENGTH);

/**
 * Is this player doing something faster than the game allows?  Each kind of thing is counted on its own, so that a
 * game with more than one (Scribblers' thumbs) does not let one use up the other.
 * @param {any} player  the player (mutated: their recent times are kept on them)
 * @param {number} now  the clock
 * @param {string} [what]  which times to count: 'talk' for what they type
 * @returns {boolean} true if this one should be refused
 * Side effects: records `now` in the player's recent times and drops the ones that have fallen out of the window.
 */
export function tooFast(player, now, what = 'talk') {
  player[what] = (player[what] ?? []).filter((at) => now - at < TALK_WINDOW_MS);
  if (player[what].length >= TALK_BURST) return true;
  player[what].push(now);
  return false;
}

/**
 * Adds a line to the feed, keeping only the last FEED_LENGTH of them.
 * @param {{ feed: object[], nextFeed: number }} room  the room (mutated)
 * @param {object} line  { kind, id, name, text, ... }
 * @returns {void}
 * Side effects: pushes onto room.feed, trims it, and uses up one number from room.nextFeed.
 */
export function addFeed(room, line) {
  room.feed.push({ n: room.nextFeed++, ...line });
  if (room.feed.length > FEED_LENGTH) room.feed = room.feed.slice(-FEED_LENGTH);
}

/**
 * Whose turn it is to guess among the computer players still guessing: the one with the fewest guesses this turn
 * (the first of them, when several are level), so that one of them does not do all the guessing.
 * @param {any[]} waiting  the computer players who may still guess
 * @returns {any} the player to guess next, or undefined when nobody is waiting
 * Side effects: none.
 */
export const nextGuesser = (waiting) => waiting.reduce((fewest, p) => ((p.tries ?? 0) < (fewest.tries ?? 0) ? p : fewest), waiting[0]);

/**
 * Which of the words it was offered a computer player draws.  An AI that throws, or answers with anything but the
 * place of one of them, is replaced by a random one.
 * @param {{ chooseWord: (context: any) => any }} ai  the computer player's AI
 * @param {any} context  what that player may know (the game's aiContext)
 * @param {number} count  how many words were offered
 * @param {() => number} rng  random source for the fallback (used only when the AI's answer will not do)
 * @returns {number} the place of the word chosen
 * Side effects: calls the AI.
 */
export function botWordChoice(ai, context, count, rng) {
  const chosen = attempt(() => ai.chooseWord(context));
  return Number.isInteger(chosen) && chosen >= 0 && chosen < count ? chosen : Math.floor(rng() * count);
}

/**
 * What a computer player guesses.  An AI that throws, or answers with nothing to type, is replaced by a random word
 * of the list.
 * @param {{ guess: (context: any) => any }} ai  the computer player's AI
 * @param {{ words: string[] }} context  what that player may know (the game's aiContext), with the word list
 * @param {() => number} rng  random source for the fallback (used only when the AI's answer will not do)
 * @returns {string} the guess to make
 * Side effects: calls the AI.
 */
export function botGuessText(ai, context, rng) {
  const guessed = attempt(() => ai.guess(context));
  if (typeof guessed === 'string' && guessed.trim()) return guessed.trim();
  return context.words[Math.floor(rng() * context.words.length)] ?? 'something';
}
