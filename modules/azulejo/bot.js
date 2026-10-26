// The computer players of Azulejo. They only ever make moves the rules allow (game.legalMoves lists them and the same
// game functions check them). How a computer chooses is up to its AI (see ai/): each bot seat has one, picked when the
// game starts and stored on the seat (`seat.ai`). A seat with no AI, or an unknown one, plays as the first ("standard").
import * as game from './game.js';
import { COLOURS } from './rules.js';
import { moveValue, bestColumn } from './ai/standard.js';

export { moveValue, bestColumn };

const isBot = game.isBot;

/** The next thing a computer has to do, or null when the game waits for a person. */
export function pendingAction(room) {
  if (room.phase === 'tiling') {
    const seat = room.seats.findIndex((s, i) => isBot(s) && room.pending[i]);
    return seat === -1 ? null : { type: 'column', seat };
  }
  if (room.phase !== 'playing' || room.turn === null || room.turn === undefined) return null;
  return isBot(room.seats[room.turn]) ? { type: 'move', seat: room.turn } : null;
}

/** What an AI may see: the whole table (it is all public) but never the bag's contents or order. */
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

/** The best legal move for the seat whose turn it is, by that seat's AI. */
export function chooseMove(room, seat, rng = Math.random) {
  return game.aiOf(room, seat).chooseMove(snapshot(room), seat, game.legalMoves(room, seat), rng);
}

/** The column a computer picks for the tile its line has just completed (free wall). */
export function chooseColumnFor(room, seat, rng = Math.random) {
  const { row, colour, columns } = room.pending[seat];
  return game.aiOf(room, seat).chooseColumn(snapshot(room), seat, { row, colour, columns: columns.slice() }, rng);
}

/** Performs a pending action. Returns the action, or null if there was nothing to do. */
export function runPending(room, rng = Math.random) {
  const action = pendingAction(room);
  if (!action) return null;
  let result;
  if (action.type === 'column') result = game.chooseColumn(room, action.seat, { col: chooseColumnFor(room, action.seat, rng) }, rng);
  else {
    const move = chooseMove(room, action.seat, rng);
    action.move = move;
    result = move ? game.takeTiles(room, action.seat, move, rng) : { ok: false, error: 'no legal move' };
  }
  if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  return action;
}
