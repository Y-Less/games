// A computer player that knows nothing about the dial: as the psychic it says any example clue, and as a guesser it
// turns the dial to a random place (leaning towards the middle, where most targets are). For testing.
const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Gives any example clue, and guesses anywhere on the dial. For testing.',
  weight: 0.5,
  clue: ({ anchors }, rng) => pick(anchors, rng)?.text ?? 'something',
  guess: (ctx, rng) => 15 + rng() * 70,
};

export default random;
