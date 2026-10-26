// The computer players for Splendour. Each bot seat has one AI (see ai/), chosen when the game starts and stored in
// room.ais, keyed by the bot's seat id. This file turns a room into the plain-data situation an AI works from (only what
// a person at the table could see: never the order of the draw piles or anyone's face-down reserve), asks the AI for a
// decision and checks that it is legal.
//
// Every move is chosen from game.legalMoves, so a computer player can never make an illegal move.
import { aiById } from '../../shared/ai.js';
import { LEVELS } from './cards.js';
import * as game from './game.js';
import { AIS } from './ai/index.js';

/** The AI a seat plays with. Rooms saved before AIs existed have none recorded, and fall back to the first (standard). */
export const aiOf = (room, seat) => aiById(AIS, room.ais?.[room.seats[seat]?.id]);

/** What an AI may know: the table, every player's tokens and discounts, its own reserve and others' face-up reserves. */
export function situation(room, seat, extra = {}) {
  return {
    seat,
    n: room.seats.length,
    target: room.settings.target,
    round: room.round,
    finalRound: room.finalRound,
    triggeredBy: room.triggeredBy,
    supply: [...room.supply],
    board: Object.fromEntries(LEVELS.map((l) => [l, [...room.board[l]]])),
    decks: Object.fromEntries(LEVELS.map((l) => [l, room.decks[l].length])),
    nobles: [...room.nobles],
    players: room.players.map((p, i) => ({
      seat: i,
      tokens: [...p.tokens],
      bonuses: game.bonusesOf(p),
      prestige: game.prestigeOf(p),
      bought: p.bought.length,
      nobles: p.nobles.length,
      reservedCount: p.reserved.length,
      reserved: p.reserved.filter((r) => i === seat || !r.blind).map((r) => r.card),
    })),
    moves: [],
    returnCount: 0,
    options: [],
    ...extra,
  };
}

const standard = () => AIS[0];

export function chooseMove(room, seat, rng = Math.random) {
  const moves = game.legalMoves(room, seat);
  if (!moves.length) return { type: 'pass' };
  const s = situation(room, seat, { moves });
  const move = aiOf(room, seat).chooseMove(s, rng);
  const key = JSON.stringify(move);
  return moves.find((m) => JSON.stringify(m) === key) ?? standard().chooseMove(s, rng);
}

/** Which tokens to give back (exactly as many as the seat is over by). */
export function chooseReturn(room, seat, rng = Math.random) {
  const s = situation(room, seat, { returnCount: room.pending.count });
  const give = aiOf(room, seat).chooseReturn(s, rng);
  const have = room.players[seat].tokens;
  const valid = Array.isArray(give) && give.length === 6 && give.every((g, c) => Number.isInteger(g) && g >= 0 && g <= have[c]) && give.reduce((a, b) => a + b, 0) === room.pending.count;
  return valid ? give : standard().chooseReturn(s, rng);
}

export function chooseNoble(room, seat, rng = Math.random) {
  const s = situation(room, seat, { options: [...room.pending.options] });
  const id = aiOf(room, seat).chooseNoble(s, rng);
  return room.pending.options.includes(id) ? id : room.pending.options[0];
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
  if (room.phase === 'playing' && room.pending?.seat === seat && room.pending.type === 'return') expect(game.returnTokens(room, seat, chooseReturn(room, seat, rng)));
  if (room.phase === 'playing' && room.pending?.seat === seat && room.pending.type === 'noble') expect(game.chooseNoble(room, seat, chooseNoble(room, seat, rng)));
}

/** Performs a pending action. Returns the action, or null if there was nothing to do. */
export function runPending(room, rng = Math.random) {
  const action = pendingAction(room);
  if (!action) return null;
  playTurn(room, action.seat, rng);
  return action;
}
