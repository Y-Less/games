// Helpers shared by the Splendour AIs. Everything here works on the plain-data "situation" that bot.js builds (see
// bot.js, `situation`), never on a room, so an AI cannot see the draw piles or anyone's face-down reserve.
//
// A situation looks like:
//   { seat, n, target, round, finalRound, triggeredBy,
//     supply: [6 counts], board: { 1: [card ids or null x4], 2: [...], 3: [...] }, decks: { 1: count, 2: count, 3: count },
//     nobles: [noble ids still on the table],
//     players: [{ seat, tokens: [6], bonuses: [5], prestige, bought, nobles, reservedCount,
//                 reserved: [card ids this player may be known to hold: all of your own, only face-up ones for others] }],
//     moves: [legal moves, as in game.legalMoves], returnCount (tokens to give back, when asked), options (nobles to pick from) }
//
// An AI provides chooseMove(situation, rng) -> one of situation.moves (or { type: 'pass' } when there are none),
// chooseReturn(situation, rng) -> six counts summing to situation.returnCount, and chooseNoble(situation, rng) -> an id.
import { CARD_BY_ID, GOLD, LEVELS, NOBLE_BY_ID } from '../cards.js';

export { GOLD };
export const MAX_TOKENS = 10;
export const sum = (list) => list.reduce((a, b) => a + b, 0);

export const boardCards = (s) => LEVELS.flatMap((l) => s.board[l]).filter(Boolean).map((id) => CARD_BY_ID[id]);
export const me = (s) => s.players[s.seat];
export const opponents = (s) => s.players.filter((p) => p.seat !== s.seat);
export const nobleList = (s) => s.nobles.map((id) => NOBLE_BY_ID[id]);
export const needOf = (card, bonuses) => card.cost.map((c, i) => Math.max(0, c - bonuses[i]));
export const nobleGap = (bonuses, noble) => sum(Object.entries(noble.requires).map(([c, n]) => Math.max(0, n - bonuses[c])));

/** What a player would pay for a card (coloured tokens first, Gold for the rest), or null if they cannot afford it. */
export function payment(player, card) {
  const need = needOf(card, player.bonuses);
  const pay = [0, 0, 0, 0, 0, 0];
  let short = 0;
  for (let c = 0; c < 5; c++) {
    pay[c] = Math.min(need[c], player.tokens[c]);
    short += need[c] - pay[c];
  }
  if (short > player.tokens[GOLD]) return null;
  pay[GOLD] = short;
  return { need, pay };
}

/** The cards a player could aim for (the table, plus their own reserve), each with what is still missing. */
export function targetsOf(s, player = me(s), extra = {}) {
  const ids = [...LEVELS.flatMap((l) => s.board[l]).filter(Boolean), ...player.reserved];
  return ids.map((id) => {
    const card = CARD_BY_ID[id];
    const need = needOf(card, player.bonuses);
    const missing = need.map((n, c) => Math.max(0, n - player.tokens[c]));
    const short = Math.max(0, sum(missing) - player.tokens[GOLD]);
    return { id, card, need, missing, short, reserved: player.reserved.includes(id), ...extra };
  });
}

/** The move with the best score (ties go to the first). `jitter` adds that much randomness, one draw per move. */
export function pickBest(moves, score, rng, jitter = 0.35) {
  let best = null;
  let bestScore = -Infinity;
  for (const move of moves) {
    const value = score(move) + rng() * jitter;
    if (value > bestScore) {
      best = move;
      bestScore = value;
    }
  }
  return best;
}

/** Tokens to give back: surplus colours first, colours that are still needed (`needs`, per colour) next, Gold last. */
export function returnByNeeds(s, needs) {
  const tokens = [...me(s).tokens];
  const give = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < s.returnCount; k++) {
    let pick = -1;
    let cheapest = Infinity;
    for (let c = 0; c < 6; c++) {
      if (tokens[c] < 1) continue;
      const cost = c === GOLD ? 30 : tokens[c] <= needs[c] ? 10 + needs[c] : 1 - tokens[c] * 0.1;
      if (cost < cheapest) {
        cheapest = cost;
        pick = c;
      }
    }
    tokens[pick]--;
    give[pick]++;
  }
  return give;
}

/** The most of each colour that any of the given cards needs. */
export function peakNeeds(targets) {
  const needs = [0, 0, 0, 0, 0];
  for (const t of targets) t.need.forEach((n, c) => (needs[c] = Math.max(needs[c], n)));
  return needs;
}

export function randomReturn(s, rng) {
  const have = [...me(s).tokens];
  const give = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < s.returnCount; k++) {
    const options = have.flatMap((n, c) => (n > 0 ? [c] : []));
    const c = options[Math.floor(rng() * options.length)];
    have[c]--;
    give[c]++;
  }
  return give;
}

/** Colours (a 0/1 flag per colour) of the tokens a `take` or `takeTwo` move would gain, as counts. */
export function gainOf(move) {
  const gain = [0, 0, 0, 0, 0];
  if (move.type === 'take') for (const c of move.colours) gain[c]++;
  if (move.type === 'takeTwo') gain[move.colour] = 2;
  return gain;
}

/** The overflow penalty for ending a turn over the token limit. */
export const overflowOf = (s, gain, rate = 1.2) => Math.max(0, sum(me(s).tokens) + gain - MAX_TOKENS) * rate;
