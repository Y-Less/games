// Small helpers for a game's tally: the counters it keeps about each player for the statistics and achievements.  A tally is a
// plain object of numbers that is saved with the room, so a room saved before a counter existed has no such key; that is why
// these read a missing key as 0 instead of the game assuming it is there.
// Depends on: ./seats.js (isHuman).
import { isHuman } from './seats.js';

/**
 * Builds a tally with every key at zero.
 * @param {string[]} keys  the counter names
 * @returns {Record<string, number>} a new object with each key set to 0
 * Side effects: none.
 */
export const freshTally = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));

/**
 * Adds to a counter, treating a missing key as 0.
 * @param {Record<string, number>} tally  the tally to change
 * @param {string} key  the counter name
 * @param {number} [amount]  how much to add (default 1)
 * @returns {void}
 * Side effects: mutates `tally[key]`.
 */
export function bump(tally, key, amount = 1) {
  tally[key] = (tally[key] ?? 0) + amount;
}

/**
 * Keeps the largest value a counter has been given, treating a missing key as 0.
 * @param {Record<string, number>} tally  the tally to change
 * @param {string} key  the counter name
 * @param {number} value  a candidate maximum
 * @returns {void}
 * Side effects: mutates `tally[key]`.
 */
export function peak(tally, key, value) {
  tally[key] = Math.max(tally[key] ?? 0, value);
}

/**
 * Extracts the counters for `keys` as they are to be recorded: every one a number, 0 where the tally has none.
 * @param {Record<string, number>} tally  the tally to read (not changed)
 * @param {string[]} keys  the counters wanted
 * @returns {Record<string, number>} a new object with one number per key
 * Side effects: none.
 */
export const extrasOf = (tally, keys) => Object.fromEntries(keys.map((key) => [key, tally[key] ?? 0]));

/**
 * The rows a game gives to `ctx.stats.record`: one for each person in `who` (seats or players), none for an empty seat, a
 * computer player, or anybody who has left.  Each row starts with the person's `userId`, followed by what `rowFor` says.
 *
 * @param {Array<object | null>} who  seats or players, in seat order; a person is `{ kind: 'human', id }`
 * @param {(entry: object, index: number) => { outcome: string, placement?: number, score?: number, extras?: object }} rowFor
 *   what to record for one person: the entry and its index in `who`
 * @returns {object[]} `{ userId, ...rowFor(entry, index) }` for each person, in order
 * Side effects: none.
 */
export function statsRows(who, rowFor) {
  return who.flatMap((entry, index) => (isHuman(entry) ? [{ userId: entry.id, ...rowFor(entry, index) }] : []));
}
