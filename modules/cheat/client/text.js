// Wording shared by the "Recent moves" list (log.js) and the Status box (Table.vue), so that the same fact is always
// written the same way.  Everything is a message (shared/messages.js) that the table puts into words with `text()`.
import { msg } from '../../../shared/messages.js';

/** The keys for what a call of "Cheat!" turned up: the log says "calls ... picks up", the Status box "called ... picked up". */
const CALL_KEYS = {
  log: { lie: 'log.callLie', truth: 'log.callTrue' },
  status: { lie: 'status.callLie', truth: 'status.callTrue' },
};

/**
 * The message that says what a call of "Cheat!" turned up: who called whom, whether it was a lie, and who picked up how
 * many cards.
 *
 * @param {{ caller: number, accused: number, lie: boolean, picker: number, pileSize: number }} call  the call, as the server describes it (state.lastCall)
 * @param {(seat: number) => string | object} nameOf  gives the name to show for a seat
 * @param {'log' | 'status'} [where]  'log' for the present tense (the Recent moves list), 'status' for the past (the Status box)
 * @returns {{ key: string, params: object }} the message
 * Side effects: none.
 */
export function callMsg(call, nameOf, where = 'log') {
  const keys = CALL_KEYS[where];
  return msg(call.lie ? keys.lie : keys.truth, { caller: nameOf(call.caller), accused: nameOf(call.accused), picker: nameOf(call.picker), count: call.pileSize });
}

/**
 * Which copy of a card (first, second...) sits at a position in a hand.  A hand can hold two copies of a card (two packs),
 * so a card is picked by its position among equal ones.
 *
 * @param {string[]} hand  the cards in hand order
 * @param {string} card    the card
 * @param {number} index   its position in the hand
 * @returns {number} 1 for the first copy, 2 for the second...
 * Side effects: none.
 */
export const copiesUpTo = (hand, card, index) => hand.slice(0, index + 1).filter((c) => c === card).length;
