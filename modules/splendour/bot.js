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

/**
 * The AI a seat plays with. Rooms saved before AIs existed have none recorded, and fall back to the first (standard).
 *
 * @param {object} room
 * @param {number} seat
 * @returns {object} an AI from ai/index.js
 */
export const aiOf = (room, seat) => aiById(AIS, room.ais?.[room.seats[seat]?.id]);

/**
 * What an AI may know: the table, every player's tokens and discounts, its own reserve and others' face-up reserves.
 * Never the order of the draw piles or anyone else's face-down reserve.
 *
 * @param {object} room
 * @param {number} seat   the seat that is choosing
 * @param {object} extra  fields to add or override (moves, returnCount, options)
 * @returns {object} plain data (see the description at the top of ai/lib.js)
 */
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
      // A bot knows its own reserves and every other player's reserve that was taken face up from the table (`!r.blind`),
      // exactly as a person does (game.js `viewFor` shows those cards to everyone). Blind reserves stay secret.
      reserved: p.reserved.filter((r) => i === seat || !r.blind).map((r) => r.card),
    })),
    moves: [],
    returnCount: 0,
    options: [],
    ...extra,
  };
}

/** The standard AI, which every other AI falls back on when it gives an answer that is not legal. */
const standard = () => AIS[0];

/**
 * Asks the seat's AI for a move and checks that it is one of the legal moves (otherwise the standard AI chooses).
 *
 * @param {object} room
 * @param {number} seat
 * @param {() => number} rng
 * @returns {object} one of game.legalMoves, or { type: 'pass' } when there are none
 */
export function chooseMove(room, seat, rng) {
  const moves = game.legalMoves(room, seat);
  if (!moves.length) return { type: 'pass' };
  const s = situation(room, seat, { moves });
  const move = aiOf(room, seat).chooseMove(s, rng);
  const key = JSON.stringify(move);
  return moves.find((m) => JSON.stringify(m) === key) ?? standard().chooseMove(s, rng);
}

/**
 * Which tokens to give back (exactly as many as the seat is over by).
 *
 * @param {object} room  with a pending return
 * @param {number} seat
 * @param {() => number} rng
 * @returns {number[]} six counts; a valid choice, falling back on the standard AI's if the seat's AI gives an invalid one
 */
export function chooseReturn(room, seat, rng) {
  const s = situation(room, seat, { returnCount: room.pending.count });
  const give = aiOf(room, seat).chooseReturn(s, rng);
  const have = room.players[seat].tokens;
  const valid = Array.isArray(give) && give.length === 6 && give.every((g, c) => Number.isInteger(g) && g >= 0 && g <= have[c]) && give.reduce((a, b) => a + b, 0) === room.pending.count;
  return valid ? give : standard().chooseReturn(s, rng);
}

/**
 * Which of several visiting nobles to take.
 *
 * @param {object} room  with a pending noble choice
 * @param {number} seat
 * @param {() => number} rng
 * @returns {string} a noble id from the pending options (the first if the AI names a different one)
 */
export function chooseNoble(room, seat, rng) {
  const s = situation(room, seat, { options: [...room.pending.options] });
  const id = aiOf(room, seat).chooseNoble(s, rng);
  return room.pending.options.includes(id) ? id : room.pending.options[0];
}

/**
 * The seat (if a computer player's) that has something to do, or null while the game waits for a person.
 *
 * @param {object} room
 * @returns {{ type: 'turn', seat: number } | null}
 */
export function pendingAction(room) {
  if (room.phase !== 'playing') return null;
  const seat = room.pending?.seat ?? room.turn;
  return game.isBot(room.seats[seat]) ? { type: 'turn', seat } : null;
}

/**
 * A computer player finishes its turn: the move, then any tokens to return and any noble to choose.
 *
 * Side effect: mutates `room`. Throws if the AI's choice is refused (which would be a bug).
 *
 * @param {object} room
 * @param {number} seat
 * @param {() => number} rng
 */
export function playTurn(room, seat, rng) {
  /** Throws if a rule refused the computer player's choice. */
  const expect = (result) => {
    if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  };
  if (!room.pending) expect(game.applyMove(room, seat, chooseMove(room, seat, rng)));
  if (room.phase === 'playing' && room.pending?.seat === seat && room.pending.type === 'return') expect(game.returnTokens(room, seat, chooseReturn(room, seat, rng)));
  if (room.phase === 'playing' && room.pending?.seat === seat && room.pending.type === 'noble') expect(game.chooseNoble(room, seat, chooseNoble(room, seat, rng)));
}

// ---- test and benchmark hook ----
// This is NOT part of the game. The tests and the simulations set the environment variable SPLENDOUR_AI so that every
// computer player uses the same AI for the whole game, which makes runs repeatable. A real server never sets it.

/**
 * Reads the SPLENDOUR_AI test/benchmark hook.
 *
 * @param {string | undefined} wanted  the variable's value (default: the real environment variable)
 * @returns {string | null} the AI id if it names a real AI, otherwise null (no forcing)
 */
export function forcedAIFromEnv(wanted = process.env.SPLENDOUR_AI) {
  return aiById(AIS, wanted).id === wanted ? wanted : null;
}

/**
 * Starts a game and then makes every computer player use one AI. Test/benchmark hook only (see above); it replaces
 * game.start for the 'start' event when SPLENDOUR_AI is set.
 *
 * Side effect: mutates `room` (as game.start does, then overwrites room.ais).
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @param {() => number} rng
 * @param {string} forcedAI  an AI id from ai/index.js
 * @returns {{ ok: boolean, error?: string }} game.start's result
 */
export function startWithForcedAI(room, userId, rng, forcedAI) {
  const outcome = game.start(room, userId, rng);
  if (outcome.ok) for (const id of Object.keys(room.ais)) room.ais[id] = forcedAI;
  return outcome;
}

/**
 * Performs a pending action.
 *
 * Side effect: mutates `room` (a whole computer turn).
 *
 * @param {object} room
 * @param {() => number} rng
 * @returns {{ type: 'turn', seat: number } | null} the action, or null if there was nothing to do
 */
export function runPending(room, rng) {
  const action = pendingAction(room);
  if (!action) return null;
  playTurn(room, action.seat, rng);
  return action;
}
