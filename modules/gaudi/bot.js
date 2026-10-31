// The computer players of Gaudi. They only ever make moves the rules allow (the same game functions check them). How a
// computer chooses is up to its AI (see ai/): each bot seat has one, picked when the game starts and stored on the seat
// (`seat.ai`). A seat with no AI, or an unknown one, plays as the first ("standard").
import * as game from './game.js';

const isBot = game.isBot;

/**
 * The next thing a computer has to do.
 *
 * @param {object} room
 * @returns {{ type: 'window' | 'turn', seat: number } | null} the action (choose a window, or take the turn), or null when
 *   the game is waiting for a person (or is not being played)
 */
export function pendingAction(room) {
  if (room.phase === 'windows') {
    const seat = room.seats.findIndex((s, i) => isBot(s) && !room.picked[i]);
    return seat === -1 ? null : { type: 'window', seat };
  }
  if (room.phase !== 'playing' || !room.turn) return null;
  return isBot(room.seats[room.turn.seat]) ? { type: 'turn', seat: room.turn.seat } : null;
}

/**
 * What an AI may see from a seat: the public table and its own secrets, never the bag or anyone else's colour or choices.
 *
 * The result is a deep copy (structuredClone), so an AI can never change the room by accident, nor keep a reference into
 * it. (No AI changes its state: they only read it and copy what they want to try.) It is called `botSnapshot` so that it is
 * not confused with `room.snapshot`, the scores at the end of the last round.
 *
 * @param {object} room
 * @param {number} seat  the seat that is deciding
 * @returns {object} the plain-data state described at the top of ai/common.js
 */
export function botSnapshot(room, seat) {
  return structuredClone({
    seat,
    size: room.size,
    settings: room.settings,
    round: room.round,
    order: room.order,
    turnIndex: room.turnIndex,
    turn: room.turn,
    pool: room.pool,
    track: room.track,
    tools: room.tools,
    spent: room.spent,
    tokens: room.tokens,
    grids: room.grids,
    patterns: room.patterns,
    publicIds: room.publicIds,
    privateColour: room.privateColours[seat],
  });
}

/**
 * One decision for the seat whose turn it is, by that seat's AI. Changes nothing.
 *
 * @param {object} room
 * @param {number} seat
 * @param {() => number} [rng]
 * @returns {{ type: 'place', die: number, cell: number } | { type: 'tool', tool: string, params: object } | { type: 'end' }}
 */
export function botStep(room, seat, rng = Math.random) {
  return game.aiOf(room, seat).chooseStep(botSnapshot(room, seat), seat, rng);
}

/**
 * Performs a pending action: a computer chooses a window, or takes one step of its turn (place a die, use a tool or end the
 * turn) through the same rules a person uses.
 *
 * Side effects: mutates room (through the game functions).
 *
 * @param {object} room
 * @param {() => number} [rng]
 * @returns {object | null} the action (with `step` set for a turn), or null if there was nothing to do
 * @throws {Error} if the AI chose a move the rules refuse (a bug in the AI; the server logs it and tries again later)
 */
export function runPending(room, rng = Math.random) {
  const action = pendingAction(room);
  if (!action) return null;
  let result;
  if (action.type === 'window') result = game.chooseWindow(room, action.seat, game.aiOf(room, action.seat).chooseWindow(room.options[action.seat].slice(), rng), rng);
  else {
    const step = botStep(room, action.seat, rng);
    action.step = step;
    if (step.type === 'place') result = game.placeDie(room, action.seat, step, rng);
    else if (step.type === 'tool') result = game.useTool(room, action.seat, { tool: step.tool, params: step.params }, rng);
    else result = game.endTurn(room, action.seat, rng);
  }
  if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  return action;
}
