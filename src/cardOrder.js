// How this player, in particular, wants their hand laid out.
//
// The cards a game deals are the same for everybody at the table and are stored that way (shared/cards.js sortHand);
// the order one person is *shown* them in is theirs alone, so it is settled here, in the browser, where their profile
// already is.  Nothing of it reaches the server, and nothing of it reaches anybody else's screen.
//
// It is for the games whose hands are laid out the usual way — suits grouped, ranks within them (shared/cards.js
// sortHand): Hearts, Cheat, and Nomination Whist.  Cribbage is not one of them and does not ask: it sorts by rank
// alone, because a cribbage hand is read for runs and fifteens and the suits hardly come into it, and Zurubang's
// five cards are not ranked against each other at all.  A game whose order is part of how it is read keeps its own.
//
// Depends on: ./session.js (the signed-in user's settings) and ../shared/cards.js (the orders themselves).
import { DEFAULT_CARD_ORDER, handComparator } from '../shared/cards.js';
import { session } from './session.js';

/**
 * How this player's hand sorts: the comparator, for a game that cannot simply reorder the array because it draws its
 * hand by position (Cheat deals several packs, so the same card can be in it twice and the place tells them apart).
 *
 * @param {object} [options]  as orderForMe
 * @returns {(a: string, b: string) => number}
 * Side effects: none (it reads the session).
 */
export const myCardOrder = ({ trump = null, salt = '' } = {}) => handComparator({ order: session.user?.cardOrder ?? DEFAULT_CARD_ORDER, trump, salt });

/**
 * A hand in the order the signed-in player asked for.
 *
 * @param {string[]} cards  the hand as the server sent it
 * @param {object} [options]
 * @param {string|null} [options.trump]  the suit to put first, for a game that has one
 * @param {string} [options.salt]  what makes the `random` order differ from table to table: pass the room's code, so
 *   that one hand is not laid out like the last.  Within a room it never changes, which is what stops a hand
 *   rearranging itself every time a card leaves it.
 * @returns {string[]} a new array; the input is not changed
 * Side effects: none (it reads the session).
 */
export const orderForMe = (cards, options) => [...cards].sort(myCardOrder(options));
