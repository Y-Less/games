// Helpers shared by the Splendour AIs. Everything here works on the plain-data "situation" that bot.js builds (see
// bot.js, `situation`), never on a room, so an AI cannot see the draw piles or anyone's face-down reserve.
//
// A situation looks like:
//   { seat, n, target, round, finalRound, triggeredBy,
//     supply: [6 counts], board: { 1: [card ids or null x4], 2: [...], 3: [...] }, decks: { 1: count, 2: count, 3: count },
//     nobles: [noble ids still on the table],
//     players: [{ seat, tokens: [6], bonuses: [5], prestige, bought, nobles, reservedCount,
//                 reserved: [card ids this player is known to hold: all of your own, none of anyone else's, as theirs are face down] }],
//     moves: [legal moves, as in game.legalMoves], returnCount (tokens to give back, when asked), options (nobles to pick from) }
//
// An AI provides chooseMove(situation, rng) -> one of situation.moves (or { type: 'pass' } when there are none),
// chooseReturn(situation, rng) -> six counts summing to situation.returnCount, and chooseNoble(situation, rng) -> an id.
//
// Depends on: ../cards.js (card data) and ../rules.js (the shared limits and the cost calculation).
import { CARD_BY_ID, LEVELS, NOBLE_BY_ID } from '../cards.js';
import { GOLD, MAX_TOKENS, needOf, quoteFor } from '../rules.js';

// The shared numbers and the cost calculation live in ../rules.js; they are re-exported so the AIs keep importing from here.
export { GOLD, MAX_TOKENS, needOf };

/**
 * Adds up a list of numbers.
 *
 * Side effects: none.
 *
 * @param {number[]} list
 * @returns {number}
 */
export const sum = (list) => list.reduce((a, b) => a + b, 0);

/**
 * Every face-up card on the table, as card objects (empty slots left out, for example after the pile ran dry).
 *
 * Side effects: none.
 *
 * @param {object} s  the situation
 * @returns {object[]} card objects from cards.js, level 1 first
 */
export const boardCards = (s) => LEVELS.flatMap((l) => s.board[l]).filter(Boolean).map((id) => CARD_BY_ID[id]);
/**
 * The situation's own player (the one choosing).
 *
 * Side effects: none.
 *
 * @param {object} s  the situation
 * @returns {object} s.players[s.seat]
 */
export const me = (s) => s.players[s.seat];
/**
 * Every other player in the situation.
 *
 * Side effects: none.
 *
 * @param {object} s  the situation
 * @returns {object[]} the players whose seat is not s.seat, in seat order
 */
export const opponents = (s) => s.players.filter((p) => p.seat !== s.seat);
/**
 * The nobles still on the table, as noble objects.
 *
 * Side effects: none.
 *
 * @param {object} s  the situation (uses s.nobles, a list of noble ids)
 * @returns {object[]} noble objects from cards.js
 */
export const nobleList = (s) => s.nobles.map((id) => NOBLE_BY_ID[id]);
/**
 * How many more card bonuses a player needs before a noble would visit them.
 *
 * Side effects: none.
 *
 * @param {number[]} bonuses  the player's five discounts
 * @param {{ requires: Record<string, number> }} noble
 * @returns {number} 0 when the noble would already visit
 */
export const nobleGap = (bonuses, noble) => sum(Object.entries(noble.requires).map(([c, n]) => Math.max(0, n - bonuses[c])));

/**
 * What a player would pay for a card (coloured tokens first, Gold for the rest), or null if they cannot afford it.
 *
 * Side effects: none.
 *
 * @param {{ tokens: number[], bonuses: number[] }} player  a player of the situation
 * @param {{ cost: number[] }} card
 * @returns {{ need: number[], pay: number[] } | null}
 */
export function payment(player, card) {
  return quoteFor(player.tokens, player.bonuses, card);
}

/**
 * The cards a player could aim for (the table, plus their own reserve), each with what is still missing.
 *
 * Side effects: none.
 *
 * @param {object} s       the situation
 * @param {object} player  whose point of view (default: the AI itself)
 * @param {object} extra   extra fields copied onto every target
 * @returns {{ id: string, card: object, need: number[], missing: number[], short: number, reserved: boolean }[]}
 *   `missing` is what is still lacking per colour; `short` is how many tokens are lacking after Gold has been counted
 */
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

/**
 * The move with the best score (ties go to the first). `jitter` adds that much randomness, one draw per move.
 *
 * Side effects: advances `rng` once per move.
 *
 * @param {object[]} moves
 * @param {(move: object) => number} score
 * @param {() => number} rng
 * @param {number} jitter
 * @returns {object | null} null only when there are no moves
 */
export function pickBest(moves, score, rng, jitter = 0.35) {
  let best = null;
  let bestScore = -Infinity;
  // The small random jitter stops the AI being perfectly predictable (and breaks exact ties differently from game to game)
  // without letting a bad move beat a clearly better one: scores differ by whole points, the jitter is under half a point.
  for (const move of moves) {
    const value = score(move) + rng() * jitter;
    if (value > bestScore) {
      best = move;
      bestScore = value;
    }
  }
  return best;
}

/**
 * Tokens to give back: surplus colours first, colours that are still needed (`needs`, per colour) next, Gold last.
 *
 * Side effects: none.
 *
 * @param {object} s        the situation (uses returnCount and the player's tokens)
 * @param {number[]} needs  the most of each colour any wanted card needs
 * @returns {number[]} six counts summing to s.returnCount
 */
export function returnByNeeds(s, needs) {
  const tokens = [...me(s).tokens];
  const give = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < s.returnCount; k++) {
    let pick = -1;
    let cheapest = Infinity;
    for (let c = 0; c < 6; c++) {
      if (tokens[c] < 1) continue;
      // The lowest "cost of losing it" goes back first. Gold is the most valuable token (it is wild), so it goes last (30);
      // a colour held no more than is needed comes next (10 + how much is needed, so the scarcer need is kept longer); a
      // genuine surplus is cheap, and the biggest pile is the cheapest of all, hence the negative slope.
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

/**
 * The most of each colour that any of the given cards needs.
 *
 * Side effects: none.
 *
 * @param {{ need: number[] }[]} targets  entries from targetsOf
 * @returns {number[]} five counts
 */
export function peakNeeds(targets) {
  const needs = [0, 0, 0, 0, 0];
  for (const t of targets) t.need.forEach((n, c) => (needs[c] = Math.max(needs[c], n)));
  return needs;
}

/**
 * Tokens to give back chosen at random (used by the Random AI).
 *
 * Side effects: advances `rng` once per token given back.
 *
 * @param {object} s    the situation (uses returnCount and the player's tokens)
 * @param {() => number} rng
 * @returns {number[]} six counts summing to s.returnCount
 */
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

/**
 * The overflow penalty for ending a turn over the token limit.
 *
 * Side effects: none.
 *
 * @param {object} s        the situation
 * @param {number} gain     how many tokens the move would add
 * @param {number} rate     penalty per token over the limit
 * @returns {number} 0 when the player stays within MAX_TOKENS
 */
export const overflowOf = (s, gain, rate = 1.2) => Math.max(0, sum(me(s).tokens) + gain - MAX_TOKENS) * rate;
