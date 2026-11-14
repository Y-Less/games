// The marker colour of each player in a room, for the list games that give everybody one (Tints and Hints,
// Wavelength, Trivium): the colour somebody joining gets, and the rule by which a player picks another in the lobby.
// What a colour is, the free palette, and who may use a colour outside it are shared/markerColours.js; this file is
// the part that knows a room has players, each `{ ..., colour }`.  The client's half is src/components/MarkerPicker.vue.
// Depends on: ./markerColours.js, ./members.js (fail, ok, isBot), and ./roster.js (playerOf).
import { MARKER_COLOURS, markerProblem, normaliseMarker, startingMarker } from './markerColours.js';
import { fail, isBot, ok } from './members.js';
import { playerOf } from './roster.js';

/**
 * The colours the players of a room have.
 * @param {{ players: { colour?: string | null }[] }} room  not changed
 * @returns {(string | null | undefined)[]} one per player, in their order
 * Side effects: none.
 */
const takenIn = (room) => room.players.map((p) => p.colour);

/**
 * The colour a player joining a room gets, for a game's `makePlayer`.  A computer player gets the first palette
 * colour nobody has; a person gets the colour they prefer (`extras.colour`, which the server has already checked is
 * one they may use) if it is free, otherwise the first free one.
 *
 * @param {{ players: { colour?: string | null }[] }} room  the room they are about to join (only read)
 * @param {{ kind: string }} base  the bare player: { kind: 'human' | 'bot', id, name? }
 * @param {{ colour?: string | null }} [extras]  what the server knows about a person joining (see playerExtras)
 * @returns {string | null | undefined} the colour; nothing only when there are more players than palette colours,
 *   which a game's MAX_PLAYERS prevents
 * Side effects: none.
 */
export function markerFor(room, base, extras = {}) {
  const taken = takenIn(room);
  if (isBot(base)) return MARKER_COLOURS.find((c) => !taken.includes(c));
  return startingMarker(extras.colour ?? null, /** @type {string[]} */ (taken), true);
}

/**
 * A player picks their marker colour in the lobby.
 *
 * @param {{ phase: string, players: any[] }} room  the room (must be in the lobby)
 * @param {number | string} id  the player choosing
 * @param {unknown} colour  the colour they want
 * @param {boolean} [canCustom]  this player has unlocked any marker colour (otherwise only the free palette)
 * @returns {{ ok: boolean, error?: string }} ok, or why not: `notInGame`, `coloursBeforeStart`, or what
 *   markerProblem says of the colour (`notAColour`, `colourIsUnlock`, `colourTaken`)
 * Side effects: changes the player's colour, only if it is allowed and nobody else has it.
 */
export function chooseMarker(room, id, colour, canCustom = false) {
  const player = playerOf(room, id);
  if (!player) return fail('notInGame');
  if (room.phase !== 'lobby') return fail('coloursBeforeStart');
  const others = room.players.filter((p) => p.id !== id).map((p) => p.colour);
  const problem = markerProblem(colour, others, canCustom);
  if (problem) return fail(problem);
  player.colour = normaliseMarker(colour);
  return ok();
}
