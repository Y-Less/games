// The computer players for Splendour. They use only what a person at the table could see (the face-up cards, every
// player's tokens and bonuses, and their own reserved cards): never the order of the draw piles.
//
// Every move is chosen from game.legalMoves, so a computer player can never make an illegal move.
import { CARD_BY_ID, GOLD, LEVELS, NOBLE_BY_ID } from './cards.js';
import * as game from './game.js';

const sum = (list) => list.reduce((a, b) => a + b, 0);

/** How much a card is worth having: points, a discount, and progress towards a noble. */
function cardValue(room, seat, card) {
  const bonuses = game.bonusesOf(room.players[seat]);
  let value = card.points * 3 + 1;
  for (const id of room.nobles) {
    const required = NOBLE_BY_ID[id].requires[card.bonus];
    if (required && bonuses[card.bonus] < required) value += 0.8;
  }
  if (bonuses[card.bonus] >= 5) value -= 0.7; // another discount in a colour we hold plenty of is worth less
  // A discount is worth more when cards on the table cost that colour.
  const onTable = LEVELS.flatMap((l) => room.board[l]).filter(Boolean).map((id) => CARD_BY_ID[id]);
  value += Math.min(1.5, onTable.filter((c) => c.cost[card.bonus] > 0).length * 0.25);
  return value;
}

/** The cards this seat could aim for, best first, each with what is still missing. */
function targets(room, seat) {
  const player = room.players[seat];
  const bonuses = game.bonusesOf(player);
  const cards = [...LEVELS.flatMap((l) => room.board[l]).filter(Boolean), ...player.reserved.map((r) => r.card)];
  return cards
    .map((id) => {
      const card = CARD_BY_ID[id];
      const need = game.needOf(card, bonuses);
      const missing = need.map((n, c) => Math.max(0, n - player.tokens[c]));
      const short = Math.max(0, sum(missing) - player.tokens[GOLD]);
      return { id, card, need, missing, short, score: cardValue(room, seat, card) / (short + 1) ** 1.3 };
    })
    .sort((a, b) => b.score - a.score);
}

/** Whether another player could buy the card right now. */
const threatened = (room, seat, card) => room.players.some((p, i) => i !== seat && game.payment(p, card));

function scoreMove(room, seat, move, plan) {
  const player = room.players[seat];
  const held = sum(player.tokens);
  const wants = plan.wants;
  const overflow = (gain) => Math.max(0, held + gain - game.MAX_TOKENS) * 1.2;
  if (move.type === 'buy') {
    const card = CARD_BY_ID[move.card];
    const quote = game.payment(player, card);
    return 10 + cardValue(room, seat, card) - sum(quote.pay.slice(0, 5)) * 0.15 - quote.pay[GOLD] * 0.9;
  }
  if (move.type === 'take') {
    const gain = move.colours.reduce((s, c) => s + (wants[c] > 0 ? 1 + Math.min(wants[c], 2) * 0.4 : 0.1), 0);
    return gain - overflow(move.colours.length);
  }
  if (move.type === 'takeTwo') return (wants[move.colour] >= 2 ? 3.2 : wants[move.colour] === 1 ? 1.3 : 0.2) - overflow(2);
  if (move.type === 'reserve') {
    const gold = room.supply[GOLD] > 0 ? 1 : 0;
    const penalty = overflow(gold);
    if (move.card === undefined) return 0.3 + gold * 0.3 - penalty;
    const card = CARD_BY_ID[move.card];
    const target = plan.list.find((t) => t.id === move.card);
    let value = 0.4 + gold * 0.4;
    if (target === plan.best && target.short <= 2 + gold) value += 2.2 + target.card.points * 0.3;
    else if (card.points >= 3 && threatened(room, seat, card)) value += 1.6 + card.points * 0.25;
    return value - penalty;
  }
  return -100;
}

export function chooseMove(room, seat, rng = Math.random) {
  const moves = game.legalMoves(room, seat);
  if (!moves.length) return { type: 'pass' };
  const list = targets(room, seat);
  const wants = [0, 0, 0, 0, 0];
  list.slice(0, 2).forEach((t, rank) => t.missing.forEach((m, c) => (wants[c] = Math.max(wants[c], rank === 0 ? m : Math.min(m, 1)))));
  const plan = { list, best: list[0], wants };
  let best = null;
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = scoreMove(room, seat, move, plan) + rng() * 0.35;
    if (score > bestScore) {
      best = move;
      bestScore = score;
    }
  }
  return best;
}

/** Which tokens to give back: surplus colours first, the colours the best cards need next, Gold last. */
export function chooseReturn(room, seat) {
  const player = room.players[seat];
  const tokens = [...player.tokens];
  const list = targets(room, seat);
  const needs = [0, 0, 0, 0, 0];
  list.slice(0, 3).forEach((t) => t.need.forEach((n, c) => (needs[c] = Math.max(needs[c], n))));
  const give = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < room.pending.count; k++) {
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

export function chooseNoble(room, seat) {
  return room.pending.options[0];
}

/** The seat (if a computer player's) that has something to do, or null while the game waits for a person. */
export function pendingAction(room) {
  if (room.phase !== 'playing') return null;
  const seat = room.pending?.seat ?? room.turn;
  return game.isBot(room.seats[seat]) ? { type: 'turn', seat } : null;
}

/** A computer player finishes its turn: the move, then any tokens to return and any noble to choose. */
export function playTurn(room, seat, rng = Math.random) {
  const expect = (result) => {
    if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  };
  if (!room.pending) expect(game.applyMove(room, seat, chooseMove(room, seat, rng)));
  if (room.phase === 'playing' && room.pending?.seat === seat && room.pending.type === 'return') expect(game.returnTokens(room, seat, chooseReturn(room, seat)));
  if (room.phase === 'playing' && room.pending?.seat === seat && room.pending.type === 'noble') expect(game.chooseNoble(room, seat, chooseNoble(room, seat)));
}

/** Performs a pending action. Returns the action, or null if there was nothing to do. */
export function runPending(room, rng = Math.random) {
  const action = pendingAction(room);
  if (!action) return null;
  playTurn(room, action.seat, rng);
  return action;
}
