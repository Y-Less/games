// The computer players of Azulejo.  They only ever make moves the rules allow (game.legalMoves lists them and the same
// game functions check them).  How a computer chooses is up to its AI (see ai/): each bot seat has one, picked when the
// game starts and stored on the seat (`seat.ai`).  A seat with no AI, or an unknown one, plays as the first ("standard").
//
// Randomness is always passed in as `rng` (the server and the tests inject it); there is no default.
// Depends on: ./game.js (the rules, the seat and AI lookups) and ./rules.js (COLOURS); the AIs themselves are in ./ai/.
import * as game from './game.js';
import { COLOURS } from './rules.js';

// Is this seat a computer player?  (Re-exported from the shared seat rules via game.js.)
const isBot = game.isBot;

/**
 * The next thing a computer has to do.
 *
 * @param {object} room  the room (not changed)
 * @returns {{ type: 'column' | 'move', seat: number } | null} null when the game is waiting for a person (or is not
 *   being played).  While tiling, a computer with a pending column choice goes first; while playing, it is whoever's turn it is.
 *
 * Side effects: none.
 */
export function pendingAction(room) {
  if (room.phase === 'tiling') {
    const seat = room.seats.findIndex((s, i) => isBot(s) && room.pending[i]);
    return seat === -1 ? null : { type: 'column', seat };
  }
  if (room.phase !== 'playing' || room.turn === null || room.turn === undefined) return null;
  return isBot(room.seats[room.turn]) ? { type: 'move', seat: room.turn } : null;
}

/**
 * What an AI may see: the whole table (it is all public) but never the bag's contents or order.
 *
 * @param {object} room  the room (not changed)
 * @returns {object} a snapshot whose arrays are the room's own (AIs must only read them); the lid is reduced to counts
 *
 * Side effects: none (builds a new object; its arrays are the room's own, so callers must only read them).
 */
export function snapshot(room) {
  return {
    size: room.size,
    settings: room.settings,
    round: room.round,
    first: room.first,
    scores: room.scores,
    factories: room.factories,
    centre: room.centre,
    markerInCentre: room.markerInCentre,
    lines: room.lines,
    walls: room.walls,
    floors: room.floors,
    lid: COLOURS.map((c) => room.lid.filter((x) => x === c).length),
    bagCount: room.bag.length,
  };
}

/**
 * The best legal move for the seat whose turn it is, by that seat's AI.
 *
 * @param {object} room  the room (not changed)
 * @param {number} seat  the computer seat
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {{ source: 'centre' | number, colour: number, line: number | 'floor' } | null} null when there is no legal move
 *
 * Side effects: none, apart from whatever the AI draws from `rng`.
 */
export function chooseMove(room, seat, rng) {
  return game.aiOf(room, seat).chooseMove(snapshot(room), seat, game.legalMoves(room, seat), rng);
}

/**
 * The column a computer picks for the tile its line has just completed (free wall).
 *
 * @param {object} room  the room (not changed); `room.pending[seat]` must be set
 * @param {number} seat  the computer seat
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {number} one of the offered columns
 *
 * Side effects: none, apart from whatever the AI draws from `rng`.
 */
export function chooseColumnFor(room, seat, rng) {
  const { row, colour, columns } = room.pending[seat];
  return game.aiOf(room, seat).chooseColumn(snapshot(room), seat, { row, colour, columns: columns.slice() }, rng);
}

/**
 * Performs a pending action.
 * Side effects: mutates the room (the move or column choice is made through the game rules).
 *
 * @param {object} room  the room
 * @param {() => number} rng  random numbers in [0, 1) (also used for the refill when a round ends)
 * @returns {{ type: string, seat: number, move?: object } | null} the action done, or null if there was nothing to do
 * @throws {Error} if the AI chose an illegal move (a bug, so the server logs it and retries)
 */
export function runPending(room, rng) {
  const action = pendingAction(room);
  if (!action) return null;
  let result;
  if (action.type === 'column') result = game.chooseColumn(room, action.seat, { col: chooseColumnFor(room, action.seat, rng) }, rng);
  else {
    const move = chooseMove(room, action.seat, rng);
    action.move = move;
    if (!move) throw new Error('A computer player found no legal move'); // a bug: the server logs it and retries
    result = game.takeTiles(room, action.seat, move, rng);
  }
  if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`); // the refusal's code, for the log
  return action;
}
