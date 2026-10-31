// Helpers for pitting computer players against each other in the AI tests: how to seat them, and how to total up a tournament.
// Not used by the games themselves.

/**
 * The seating for game number `game` of a tournament: the lineup turned round by one seat each game, so that nobody always
 * sits first.
 *
 * @param {string[]} lineup  AI ids, one per seat
 * @param {number} game  0 for the first game
 * @returns {string[]} the same ids, starting from seat `game mod lineup.length`
 */
export function rotated(lineup, game) {
  const shift = game % lineup.length;
  return lineup.map((_, seat) => lineup[(seat + shift) % lineup.length]);
}

/**
 * A seeded round-robin: every game seats the AIs at one table (rotating who sits where) and each AI's mean score and win share
 * are totalled (a shared win counts as a fraction).
 *
 * @param {string[]} lineup  AI ids, one per seat
 * @param {object} options
 * @param {number} [options.games]
 * @param {number} [options.seed]  the games use the seeds `seed * 100000 + game`
 * @param {(table: string[], seed: number, game: number) => object} options.play  plays one game and returns the finished room
 * @param {(room: object, seat: number) => number} options.totalOf  a seat's final score
 * @returns {Record<string, { games: number, total: number, wins: number, mean: number, winRate: number }>}
 */
export function roundRobin(lineup, { games = 100, seed = 1, play, totalOf }) {
  const tally = Object.fromEntries([...new Set(lineup)].map((id) => [id, { games: 0, total: 0, wins: 0 }]));
  for (let game = 0; game < games; game++) {
    const table = rotated(lineup, game);
    const room = play(table, seed * 100000 + game, game);
    table.forEach((id, seat) => {
      const row = tally[id];
      row.games++;
      row.total += totalOf(room, seat);
      if (room.winners.includes(seat)) row.wins += 1 / room.winners.length;
    });
  }
  for (const row of Object.values(tally)) {
    row.mean = row.total / row.games;
    row.winRate = row.wins / row.games;
  }
  return tally;
}
