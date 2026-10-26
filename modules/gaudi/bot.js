// The computer players of Gaudi. They only ever make moves the rules allow (the same game functions check them). How a
// computer chooses is up to its AI (see ai/): each bot seat has one, picked when the game starts and stored on the seat
// (`seat.ai`). A seat with no AI, or an unknown one, plays as the first ("standard").
import * as game from './game.js';
import { bestPlacement as standardBestPlacement, chooseWindow as standardChooseWindow } from './ai/standard.js';

const isBot = game.isBot;

/** The next thing a computer has to do, or null when the game waits for a person. */
export function pendingAction(room) {
  if (room.phase === 'windows') {
    const seat = room.seats.findIndex((s, i) => isBot(s) && !room.picked[i]);
    return seat === -1 ? null : { type: 'window', seat };
  }
  if (room.phase !== 'playing' || !room.turn) return null;
  return isBot(room.seats[room.turn.seat]) ? { type: 'turn', seat: room.turn.seat } : null;
}

/** What an AI may see from a seat: the public table and its own secrets, never the bag or anyone else's colour or choices. */
export function snapshot(room, seat) {
  return {
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
  };
}

/** Windows with more restrictions give more favour tokens: the standard computer likes difficulty 5 and 6, with some variety. */
export function botWindow(options, rng = Math.random, ai = null) {
  return (ai ?? { chooseWindow: standardChooseWindow }).chooseWindow(options, rng);
}

/** The best (die, cell) by the standard AI's measure, or null when nothing can be placed. */
export function bestPlacement(room, seat, rng) {
  return standardBestPlacement(snapshot(room, seat), seat, rng);
}

/** One decision for the seat whose turn it is, by that seat's AI. */
export function botStep(room, seat, rng = Math.random) {
  return game.aiOf(room, seat).chooseStep(snapshot(room, seat), seat, rng);
}

/** Performs a pending action. Returns the action, or null if there was nothing to do. */
export function runPending(room, rng = Math.random) {
  const action = pendingAction(room);
  if (!action) return null;
  let result;
  if (action.type === 'window') result = game.chooseWindow(room, action.seat, botWindow(room.options[action.seat].slice(), rng, game.aiOf(room, action.seat)), rng);
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
