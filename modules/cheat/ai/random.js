// A computer player that plays at random, for testing: one to four random cards, and a call now and then.

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Plays random cards and calls at random. For testing.',
  weight: 0.5,
  play: ({ hand, maxPlay }, rng) => {
    const howMany = 1 + Math.floor(rng() * Math.min(maxPlay, hand.length));
    const rest = [...hand];
    return Array.from({ length: howMany }, () => rest.splice(Math.floor(rng() * rest.length), 1)[0]);
  },
  call: (ctx, rng) => rng() < 0.12,
};

export default random;
