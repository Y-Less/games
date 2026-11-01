// 'Random': a uniformly random legal pass and play. The weakest opponent, for relaxed games.
export default {
  id: 'random',
  name: 'Random',
  description: 'Passes and plays any legal card at random.',
  weight: 0.5,
  /**
   * Passes random cards.
   * @param {object} ctx  AI context; uses hand, rng and passCount (default 3).
   * @returns {string[]} passCount distinct cards drawn at random from the hand.
   * Side effects: advances ctx.rng.
   */
  choosePass({ hand, rng, passCount = 3 }) {
    const pool = [...hand];
    const out = [];
    while (out.length < passCount && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
  },
  /**
   * Plays a random legal card.
   * @param {object} ctx  AI context; uses legal and rng.
   * @returns {string} one card from legal.
   * Side effects: advances ctx.rng.
   */
  choosePlay({ legal, rng }) {
    return legal[Math.floor(rng() * legal.length)];
  },
};
