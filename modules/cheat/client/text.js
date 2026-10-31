// Wording shared by the "Recent moves" list (log.js) and the Status box (Table.vue), so that the same fact is always
// written the same way.

/**
 * "1 card" or "5 cards".
 *
 * @param {number} n  how many cards
 * @returns {string}
 */
export const cardCount = (n) => `${n} ${n === 1 ? 'card' : 'cards'}`;

/**
 * The sentence that says what a call of "Cheat!" turned up.
 *
 * @param {{ caller: number, accused: number, lie: boolean, picker: number, pileSize: number }} call  the call, as the server describes it (state.lastCall)
 * @param {(seat: number) => string} nameOf  gives the name to show for a seat
 * @param {boolean} [past]  true for "called ... picked up" (the Status box), false for "calls ... picks up" (the log)
 * @returns {string}
 */
export function callSentence(call, nameOf, past = false) {
  const [calls, picks] = past ? ['called', 'picked'] : ['calls', 'picks'];
  return `${nameOf(call.caller)} ${calls} Cheat on ${nameOf(call.accused)}: it was ${call.lie ? 'a lie' : 'true'}, so ${nameOf(call.picker)} ${picks} up ${cardCount(call.pileSize)}.`;
}

/**
 * Which copy of a card (first, second...) sits at a position in a hand. A hand can hold two copies of a card (two packs),
 * so a card is picked by its position among equal ones.
 *
 * @param {string[]} hand  the cards in hand order
 * @param {string} card    the card
 * @param {number} index   its position in the hand
 * @returns {number} 1 for the first copy, 2 for the second...
 */
export const copiesUpTo = (hand, card, index) => hand.slice(0, index + 1).filter((c) => c === card).length;
