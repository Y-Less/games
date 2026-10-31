// The computer players of Rummikub. A computer player only ever sends the server the same kind of request a person
// would (a whole proposed table, or a draw), and the same rules.checkPlay judges it; if its logic ever produced
// something that check refuses, the computer simply draws, so a game always goes on.
//
// Each computer seat has an AI (see ai/): a named way of choosing a turn, picked when the game starts and kept in
// room.seats[seat].ai. The search they share lives in search.js; this file chooses the AI and applies its choice.
import * as game from './game.js';
import { AIS } from './ai/index.js';
import { aiById } from '../../shared/ai.js';

/**
 * The AI of a seat (the first, 'standard', for a seat without one: rooms saved before there were several).
 *
 * @param {object} room  not changed
 * @param {number} seat
 * @returns {object} an AI object from ai/index.js
 */
export const aiOf = (room, seat) => aiById(AIS, room.seats?.[seat]?.ai);

/**
 * The next thing a computer has to do, or null when the game waits for a person.
 *
 * @param {object} room  not changed
 * @returns {{ type: 'turn', seat: number } | null}
 */
export function pendingAction(room) {
  if (room.phase !== 'playing' || room.turn === null || room.turn === undefined) return null;
  return game.isBot(room.seats[room.turn]) ? { type: 'turn', seat: room.turn } : null;
}

/**
 * What the seat's own AI would do now: play a whole proposed table, or draw. Does not change the room.
 *
 * @param {object} room
 * @param {number} seat
 * @param {object} [options]  passed to the AI (rng, budget...)
 * @returns {{ type: 'play', table: number[][] } | { type: 'draw' }}
 */
export function chooseTurn(room, seat, options = {}) {
  const play = aiOf(room, seat).plan(room, seat, options);
  return play ? { type: 'play', table: play.table } : { type: 'draw' };
}

/**
 * Does what pendingAction says: plays the AI's choice, or draws if there is none or the server's check refuses it (so a
 * game always goes on). Side effect: mutates the room.
 *
 * @param {object} room
 * @param {() => number} [rng]  random numbers for the AI
 * @param {number} [now]  the clock, in milliseconds
 * @returns {{ ok: boolean, error?: string }} the game's result
 */
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
