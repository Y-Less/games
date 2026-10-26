// The computer players of Rummikub. A computer player only ever sends the server the same kind of request a person
// would (a whole proposed table, or a draw), and the same rules.checkPlay judges it; if its logic ever produced
// something that check refuses, the computer simply draws, so a game always goes on.
//
// Each computer seat has an AI (see ai/): a named way of choosing a turn, picked when the game starts and kept in
// room.seats[seat].ai. The search they share lives in search.js; this file chooses the AI and applies its choice.
import * as game from './game.js';
import { AIS } from './ai/index.js';
import { aiById } from '../../shared/ai.js';
import { SEARCH_BUDGET, solve } from './search.js';
import { totalTiles } from './rules.js';

export { SEARCH_BUDGET, solve, totalTiles };

/** The AI of a seat (the first, 'standard', for a seat without one: rooms saved before there were several). */
export const aiOf = (room, seat) => aiById(AIS, room.seats?.[seat]?.ai);

/** The next thing a computer has to do, or null when the game waits for a person. */
export function pendingAction(room) {
  if (room.phase !== 'playing' || room.turn === null || room.turn === undefined) return null;
  return game.isBot(room.seats[room.turn]) ? { type: 'turn', seat: room.turn } : null;
}

/** The best play of the classic AI (or of options.ai, an AI object): { table, added } or null. */
export function bestPlay(room, seat, options = {}) {
  const ai = options.ai ?? AIS[0];
  return ai.plan(room, seat, options);
}

/** { type: 'play', table } or { type: 'draw' }, by the seat's own AI. */
export function chooseTurn(room, seat, options = {}) {
  const play = aiOf(room, seat).plan(room, seat, options);
  return play ? { type: 'play', table: play.table } : { type: 'draw' };
}

/** Does what pendingAction says. Returns the game's result. */
export function runPending(room, rng = Math.random, now = Date.now()) {
  const action = pendingAction(room);
  if (!action) return { ok: false, error: 'Nothing to do.' };
  const choice = chooseTurn(room, action.seat, { rng });
  if (choice.type === 'play') {
    const result = game.play(room, action.seat, { table: choice.table }, now);
    if (result.ok) return result;
  }
  return game.draw(room, action.seat, now);
}
