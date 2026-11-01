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
// Depends on: ./seats.js (isBot, isHuman).
import { isBot, isGone, isHuman } from './seats.js';

/**
 * Adds up each player's round scores.
 * @param {{ deltas?: Record<string, number> }[]} rounds  the finished rounds, each with per-player point changes
 * @param {Array<string|number>} [playerIds]  ids to include even if they never scored (they start at 0)
 * @returns {Record<string, number>} map of player id to total
 * Side effects: none.
 */
export function totalsFromRounds(rounds, playerIds = []) {
  const totals = Object.fromEntries(playerIds.map((id) => [id, 0]));
  for (const round of rounds) for (const [id, points] of Object.entries(round.deltas ?? {})) totals[id] = (totals[id] ?? 0) + points;
  return totals;
}

/**
 * Works out finishing positions: 1 is best, tied scores share a position and the next position is skipped (1, 1, 3).
 * @param {Record<string, number>} scores  map of player id to score
 * @param {object} [options]
 * @param {boolean} [options.lowIsBetter]  true for games where the lowest score wins (default false)
 * @returns {Record<string, number>} map of player id to placement
 * Side effects: none.
 */
export function placements(scores, { lowIsBetter = false } = {}) {
  const entries = Object.entries(scores);
  const better = (a, b) => (lowIsBetter ? a < b : a > b);
  return Object.fromEntries(entries.map(([id, score]) => [id, 1 + entries.filter(([, other]) => better(other, score)).length]));
}

/**
 * Finds the ids with the best score (all of them, if tied).
 * @param {Record<string, number>} scores  map of player id to score
 * @param {{ lowIsBetter?: boolean }} [options]  passed on to `placements`
 * @returns {string[]} the winning ids
 * Side effects: none.
 */
export function winnersOf(scores, options) {
  return Object.entries(placements(scores, options)).filter(([, place]) => place === 1).map(([id]) => id);
}

/**
 * One seat's entry in the standard scoreboard's `players` (see the shape at the top of this file), for games that seat people
 * and computer players by seat number.
 *
 * @param {{ kind: string, id: number | string, name: string }} seat  an occupied seat (a person, a computer player, or the
 *   { kind: 'gone', name } marker a seated game leaves when a person leaves a finished game: shown as away)
 * @param {number} index  the seat's index, which is its scoreboard `id`
 * @param {object} state
 * @param {number} state.score  what to show as the seat's score
 * @param {number} state.me  the viewer's seat, or -1
 * @param {boolean} state.current  whether it is this seat's turn
 * @param {(id: number) => boolean} state.online  says who is connected, so that people who have left the table show as away
 * @returns {{ id: number, name: string, userId: number | undefined, score: number, isMe: boolean, bot: boolean, current: boolean, away: boolean }}
 */
export function seatScoreboardEntry(seat, index, { score, me, current, online }) {
  return { id: index, name: seat.name, userId: isHuman(seat) ? seat.id : undefined, score, isMe: index === me, bot: isBot(seat), current, away: isGone(seat) || (isHuman(seat) && !online(seat.id)) };
}

/**
 * One player's entry in the standard scoreboard's `players`, for games whose players are identified by account id.
 *
 * @param {{ kind: string, id: number | string, score: number }} player
 * @param {object} state
 * @param {string} state.name  the name to show
 * @param {number} state.me  the viewer's account id
 * @param {boolean} state.current  whether it is this player's turn (or they are the one the turn is about)
 * @param {(id: number) => boolean} state.online  says who is connected
 * @param {boolean} [state.ready]  whether they have closed the results; leave out when nobody is being waited for
 * @returns {object} `{ id, name, userId, score, isMe, bot, current, away }`, then `ready` when it was given
 */
export function playerScoreboardEntry(player, { name, me, current, online, ready }) {
  return { id: player.id, name, userId: isBot(player) ? undefined : player.id, score: player.score, isMe: player.id === me, bot: isBot(player), current, away: isHuman(player) && !online(player.id), ...(ready === undefined ? {} : { ready }) };
}

/**
 * The players best score first, each with a `placement` (ties share one) and `winner` (every tied leader wins).
 *
 * @param {{ id: number | string, score: number }[]} players  not changed
 * @returns {object[]} copies of the players, best first (equal scores keep their order)
 */
export function standingsOf(players) {
  const places = placements(Object.fromEntries(players.map((p) => [p.id, p.score])));
  return [...players].sort((a, b) => b.score - a.score).map((p) => ({ ...p, placement: places[p.id], winner: places[p.id] === 1 }));
}

/**
 * The standings by player id, once the game is over (before then nobody has a final place).
 *
 * @param {{ id: number | string, score: number }[]} players  not changed
 * @param {boolean} over  whether the game has ended
 * @returns {Map<number | string, object>} each player's `standingsOf` entry by id; empty while the game is on
 */
export const finalStandings = (players, over) => (over ? new Map(standingsOf(players).map((p) => [p.id, p])) : new Map());
