// Small random-number helpers shared by the rules, the computer players and the tests. Nothing here calls Math.random
// by itself: every function takes the `rng` it should use (a () => number in [0, 1)) so a game can be replayed from a seed.
// (shuffle lives in cards.js, next to the decks it shuffles.)
// Depends on: nothing (pure, no imports).

/**
 * A small seeded random number generator (mulberry32), so a failing run can be repeated.
 *
 * @param {number} seed  any integer
 * @returns {() => number} a function returning the next number in [0, 1)
 * Side effects: none (the returned function carries its own private state and advances it on each call).
 */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One item of a list, chosen uniformly.
 *
 * @template T
 * @param {T[]} list  must not be empty
 * @param {() => number} rng
 * @returns {T}
 * Side effects: none beyond advancing `rng` once.
 */
export function pickOne(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

/**
 * Chooses an item that has not been used yet; once every item has been used the memory is cleared and the choice starts
 * again from the whole list. Used for words, spectra and prompts that should not repeat until they have all been seen.
 * @template T
 * @param {T[]} list  every possible item
 * @param {T[]} used  the items already chosen (saved with the room); mutated
 * @param {() => number} rng  random source returning a number in [0, 1)
 * @returns {T} the chosen item
 * Side effects: pushes the chosen item onto `used`, emptying `used` first if every item was already in it.
 */
export function drawUnused(list, used, rng) {
  let fresh = list.filter((item) => !used.includes(item));
  if (!fresh.length) {
    used.length = 0;
    fresh = list;
  }
  const item = pickOne(fresh, rng);
  used.push(item);
  return item;
}
