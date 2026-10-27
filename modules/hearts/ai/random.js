// 'Random': a uniformly random legal pass and play. The weakest opponent, for relaxed games.
export default {
  id: 'random',
  name: 'Random',
  description: 'Passes and plays any legal card at random.',
  weight: 0.5,
  choosePass({ hand, rng, passCount = 3 }) {
    const pool = [...hand];
    const out = [];
    while (out.length < passCount && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
  },
  choosePlay({ legal, rng }) {
    return legal[Math.floor(rng() * legal.length)];
  },
};
