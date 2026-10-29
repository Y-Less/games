// Plays whole Splendour games between strategies (see strategies.js), and measures what happened. Not part of the game.
import * as game from '../game.js';
import { situation } from '../bot.js';
import { botsOnly } from '../kit.js';
import { CARD_BY_ID } from '../cards.js';

/** One computer turn for `seat`, by its own strategy: the move, then any tokens to give back and any noble to choose. */
function takeTurn(room, seat, ai, rng) {
  const check = (result) => {
    if (!result.ok) throw new Error(`illegal move by ${ai.id}: ${result.error}`);
  };
  if (!room.pending) {
    const moves = game.legalMoves(room, seat);
    const s = situation(room, seat, { moves });
    const move = moves.length ? ai.chooseMove(s, rng) : { type: 'pass' };
    check(game.applyMove(room, seat, move.type === 'pass' ? { type: 'pass' } : moves.find((m) => JSON.stringify(m) === JSON.stringify(move)) ?? moves[0]));
  }
  if (room.phase === 'playing' && room.pending?.seat === seat && room.pending.type === 'return') {
    const s = situation(room, seat, { returnCount: room.pending.count });
    check(game.returnTokens(room, seat, ai.chooseReturn(s, rng)));
  }
  if (room.phase === 'playing' && room.pending?.seat === seat && room.pending.type === 'noble') {
    const s = situation(room, seat, { options: [...room.pending.options] });
    const id = ai.chooseNoble(s, rng);
    check(game.chooseNoble(room, seat, room.pending.options.includes(id) ? id : room.pending.options[0]));
  }
}

/**
 * Plays one game. `players` is the strategy for each seat, seat 0 going first. `rng` decides the players' choices and `dealRng`
 * the shuffle (they are the same unless a game is to be replayed on the same deal). Returns what happened:
 * { winners, rounds, endReason, seats: [{ prestige, cards, byLevel, nobles, reached }] }.
 */
export function playGame(players, target, rng, dealRng = rng) {
  const room = botsOnly(players.length, dealRng, { target: 15 }); // the deal comes from dealRng, so that two games can share one
  room.settings.target = target; // the game only offers 10, 15 and 20; the simulations may use any
  const reached = players.map(() => null); // the round in which each seat first had `target` points
  let guard = 0;
  while (room.phase === 'playing') {
    const seat = room.pending?.seat ?? room.turn;
    takeTurn(room, seat, players[seat], rng);
    room.players.forEach((p, i) => {
      if (reached[i] === null && game.prestigeOf(p) >= target) reached[i] = room.round;
    });
    if (++guard > 4000) throw new Error('the game did not end');
  }
  return {
    winners: room.winners,
    rounds: room.round,
    endReason: room.endReason,
    seats: room.players.map((p, i) => {
      const byLevel = [0, 0, 0];
      let zeroPoint = 0;
      for (const id of p.bought) {
        byLevel[CARD_BY_ID[id].level - 1]++;
        if (CARD_BY_ID[id].points === 0) zeroPoint++;
      }
      return { prestige: game.prestigeOf(p), cards: p.bought.length, byLevel, zeroPoint, nobles: p.nobles.length, reached: reached[i], reserved: p.tally.reservedCards };
    }),
  };
}
