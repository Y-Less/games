// A computer player that plays at random, for testing: any answer from the pool, and any of the answers on the table.
// It depends on nothing but the rng it is handed (so seeded games stay repeatable).

/**
 * One element of a list.
 * @param {Array} list  the candidates (must not be empty)
 * @param {() => number} rng  random source returning [0, 1)
 * @returns {*} an element of list; the Math.min guards against an rng that returns exactly 1
 * Side effects: none (advances the rng once).
 */
const pickOne = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Writes any answer at all and picks any of the answers on the table. For testing.',
  weight: 0.5,
  // Any answer from the whole pool, with no preference for the obvious ones.
  write: ({ pool }, rng) => (pool.length ? pickOne(pool, rng) : ''),
  // Any of the answers it is allowed to pick.
  pick: ({ options }, rng) => (options.length ? Math.min(options.length - 1, Math.floor(rng() * options.length)) : 0),
};

export default random;
