// Score helpers shared by every game (server and client).
//
// The standard scoreboard shape that games send to clients (and that <ScoreBoard> draws):
//   {
//     players: [{ id, name, score, isMe?, away?, note?, bot?, current? }],   // bot: computer player (icon); current: whose turn it is (glowing chip)
//     rounds:  [{ label: 'Hand 1', deltas: { [playerId]: points }, notes?: { [playerId]: 'shot the moon' } }],
//     lowIsBetter: false,
//     target: 121               // optional: the score the game is played to
//   }
// `rounds` holds every finished round, oldest first, so the whole history can be shown.

/** Total of each player's round scores, as { [playerId]: total }. */
export function totalsFromRounds(rounds, playerIds = []) {
  const totals = Object.fromEntries(playerIds.map((id) => [id, 0]));
  for (const round of rounds) for (const [id, points] of Object.entries(round.deltas ?? {})) totals[id] = (totals[id] ?? 0) + points;
  return totals;
}

/**
 * Finishing positions for { [id]: score }: 1 is best, tied scores share a position and the next position is skipped
 * (1, 1, 3). Returns { [id]: placement }.
 */
export function placements(scores, { lowIsBetter = false } = {}) {
  const entries = Object.entries(scores);
  const better = (a, b) => (lowIsBetter ? a < b : a > b);
  return Object.fromEntries(entries.map(([id, score]) => [id, 1 + entries.filter(([, other]) => better(other, score)).length]));
}

/** The ids with the best score (all of them, if tied). */
export function winnersOf(scores, options) {
  return Object.entries(placements(scores, options)).filter(([, place]) => place === 1).map(([id]) => id);
}
