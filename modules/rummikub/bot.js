// The computer players of Rummikub. A computer player only ever sends the server the same kind of request a person
// would (a whole proposed table, or a draw), and the same rules.checkPlay judges it; if its logic ever produced
// something that check refuses, the computer simply draws, so a game always goes on.
//
// Each computer seat has an AI (see ai/): a named way of choosing a turn, picked when the game starts and kept in
// room.seats[seat].ai. The search they share lives in search.js; this file chooses the AI, builds the situation it may
// see (its own rack, the table, the others' rack sizes: never their tiles) and applies its choice.
import * as game from './game.js';
import { AIS } from './ai/index.js';
import { aiById } from '../../shared/ai.js';

/**
 * The AI of a seat (the first, 'standard', for a seat without one: rooms saved before there were several).
 *
 * @param {object} room  not changed
 * @param {number} seat
 * @returns {object} an AI object from ai/index.js
 * Side effects: none.
 */
export const aiOf = (room, seat) => aiById(AIS, room.seats?.[seat]?.ai);

/**
 * What a seat's AI is allowed to know, as plain data: the settings, the table, its own rack, how many tiles the others
 * hold and how many are left in the pool. Other racks and the pool's order are never in it, so an AI cannot peek even by
 * accident; the search in search.js reads the same fields a room has (settings, table, melded, racks[seat]).
 *
 * @param {object} room  not changed
 * @param {number} seat  the seat deciding
 * @returns {{ seat: number, settings: object, table: number[][], melded: boolean[], racks: Array<number[] | null>,
 *   rackCounts: number[], poolCount: number, moves: number }}
 * Side effects: none.
 */
export function situation(room, seat) {
  return {
    seat,
    settings: room.settings,
    table: room.table.map((set) => [...set]),
    melded: [...room.melded],
    racks: room.racks.map((rack, i) => (i === seat ? [...rack] : null)),
    rackCounts: room.racks.map((rack) => rack.length),
    poolCount: room.pool.length,
    moves: room.moves ?? 0,
  };
}

/**
 * The next thing a computer has to do, or null when the game waits for a person.
 *
 * @param {object} room  not changed
 * @returns {{ type: 'turn', seat: number } | null}
 * Side effects: none.
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
 * @param {{ rng: () => number, budget?: number }} options  for the AI: `rng` is required (no AI falls back to Math.random)
 * @returns {{ type: 'play', table: number[][] } | { type: 'draw' }}
 * Side effects: none.
 */
export function chooseTurn(room, seat, options) {
  if (typeof options?.rng !== 'function') throw new TypeError('chooseTurn needs an rng: the AIs never use Math.random.');
  const play = aiOf(room, seat).plan(situation(room, seat), seat, options);
  return play ? { type: 'play', table: play.table } : { type: 'draw' };
}

/**
 * Does what pendingAction says: plays the AI's choice, or draws if there is none or the server's check refuses it (so a
 * game always goes on). Side effect: mutates the room.
 *
 * @param {object} room
 * @param {() => number} rng  random numbers for the AI
 * @param {number} now  the clock, in milliseconds
 * @returns {{ ok: boolean, error?: string }} the game's result
 */
export function runPending(room, rng, now) {
  const action = pendingAction(room);
  if (!action) return { ok: false, error: 'Nothing to do.' };
  const choice = chooseTurn(room, action.seat, { rng });
  if (choice.type === 'play') {
    const result = game.play(room, action.seat, { table: choice.table }, now);
    if (result.ok) return result;
  }
  return game.draw(room, action.seat, now);
}
