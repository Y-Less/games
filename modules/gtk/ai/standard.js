// The usual computer players of GTK.  A computer player has no childhood and no favourite biscuit, so it writes an
// answer from the question's pool (see questions.js) and hopes it sits believably beside everybody else's; when it is
// the one being asked about, its "true" answer is drawn the same way, which is exactly what the game needs.
//
//   write({ pool, offset }, rng)   -> the answer text (pool: the plausible answers for this question)
//   pick({ options }, rng)         -> the index in `options` of the answer it believes is the true one
//
// Depends on nothing but the rng it is handed, so seeded games stay repeatable.  Two strategies come from one factory,
// differing only in which slice of the pool they write from and how they choose between the answers on the table.

/** How many words an answer is written in (used by the "shortest looks truest" strategy). */
export const wordCount = (text) => String(text).trim().split(/\s+/).filter(Boolean).length;

/**
 * Builds a computer player.
 * @param {object} config  { id, name, description, weight } as for any AI, plus:
 *   share   the fraction of the pool it writes from: 'early' takes the obvious answers (often written by somebody else
 *           too, and so merged), 'late' the less obvious ones
 *   style   how it chooses: 'any' picks at random, 'short' leans towards the plainest answer on the table, because a
 *           true answer is more often "Carrots" than "Carrots, but only roasted"
 * @returns {object} an AI object with write and pick functions
 * Side effects: none.
 */
export function makeStandard({ id, name, description, weight, share, style }) {
  return {
    id,
    name,
    description,
    weight,
    // An answer from its half of the pool; `offset` separates the two questions of a round so it does not repeat itself.
    write: ({ pool, offset = 0 }, rng) => {
      if (!pool.length) return '';
      // The two slices overlap in the middle, so the computer players do not forever agree with each other.
      const slice = share === 'late' ? pool.slice(Math.floor(pool.length * 0.4)) : pool.slice(0, Math.max(1, Math.ceil(pool.length * 0.6)));
      return slice[(Math.floor(rng() * slice.length) + offset) % slice.length];
    },
    // The index of the answer it believes: any of them, or the plainest with a nudge of chance.
    pick: ({ options }, rng) => {
      if (!options.length) return 0;
      if (style !== 'short') return Math.min(options.length - 1, Math.floor(rng() * options.length));
      const scored = options.map((text, n) => ({ n, score: wordCount(text) + rng() * 0.9 }));
      return scored.sort((a, b) => a.score - b.score)[0].n;
    },
  };
}

// The default player: an obvious answer, and no idea which one is true.
export const standard = makeStandard({
  id: 'standard',
  name: 'Standard',
  description: 'Writes one of the obvious answers and picks between the answers on the table at random.',
  weight: 3,
  share: 'early',
  style: 'any',
});

// Writes from the less obvious half (so it is less often merged with somebody else's answer) and leans towards the
// plainest answer when it picks, on the grounds that a true answer is usually short.
export const sharp = makeStandard({
  id: 'sharp',
  name: 'Sharp',
  description: 'Writes a less obvious answer, and believes the plainest answer on the table is the true one.',
  weight: 2,
  share: 'late',
  style: 'short',
});

export default standard;
