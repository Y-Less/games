// Small helpers for a game's tally: the counters it keeps about each player for the statistics and achievements. A tally is a
// plain object of numbers that is saved with the room, so a room saved before a counter existed has no such key; that is why
// these read a missing key as 0 instead of the game assuming it is there.

/** A tally with every key at zero. */
export const freshTally = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));

/** Adds to a counter (1 by default). */
export function bump(tally, key, amount = 1) {
  tally[key] = (tally[key] ?? 0) + amount;
}

/** Keeps the largest value a counter has been given. */
export function peak(tally, key, value) {
  tally[key] = Math.max(tally[key] ?? 0, value);
}

/** The counters for `keys` as they are to be recorded: every one a number, 0 where the tally has none. */
export const extrasOf = (tally, keys) => Object.fromEntries(keys.map((key) => [key, tally[key] ?? 0]));
