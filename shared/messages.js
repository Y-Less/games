// Words the server sends to a client are never sentences: they are messages, `{ key, params? }`, that the client turns into
// the player's language (src/messageText.js looks the key up in the game's own locale file first, then the site's).  A
// refusal's `error` is such a key too (under `errors.`).  Params may themselves be messages (a card's name, say) or lists
// of them, and a numeric `count` param also picks the plural form.
// Depends on: ./cards.js (for the card and suit messages).
import { isJoker, isRed, rankOf, suitOf } from './cards.js';

/**
 * An Error that a rule threw on purpose, carrying a code the client can put into words rather than a developer's
 * sentence.  It is an ordinary Error with two marks on it, so anything that catches Errors still catches these.
 *
 * @typedef {Error & { refusal?: boolean, params?: object }} Refusal
 */

/**
 * A message for the client to put into words.
 * @param {string} key  the locale key, relative to the game's locale file or the site's ('scoreboard.hand', 'errors.notYourTurn')
 * @param {object} [params]  named values the text needs; a message or a list of messages is translated first, and `count` chooses the plural
 * @returns {{ key: string, params?: object }}
 * Side effects: none.
 */
export const msg = (key, params) => (params ? { key, params } : { key });

/**
 * Whether a value is a message (rather than plain text, such as a player's name).
 * @param {*} value
 * @returns {boolean}
 * Side effects: none.
 */
export const isMessage = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && typeof value.key === 'string';

/**
 * The name of a card as a message ("queen of spades", "red joker"), from the site's `cards.*` keys.
 * @param {string} card  a card code such as 'QS' or 'JK1'
 * @returns {{ key: string, params?: object }}
 * Side effects: none.
 */
export const cardMsg = (card) => (isJoker(card) ? msg(`cards.joker.${isRed(card) ? 'red' : 'black'}`) : msg('cards.name', { rank: msg(`cards.rank.${rankOf(card)}`), suit: msg(`cards.suit.${suitOf(card)}`) }));

/**
 * The name of a suit as a message ("hearts").
 * @param {string} suit  'C', 'D', 'H', or 'S'
 * @returns {{ key: string }}
 * Side effects: none.
 */
export const suitMsg = (suit) => msg(`cards.suit.${suit}`);

/** A refusal code: letters and digits, as a key under `errors.` is written. */
const CODE = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * The Error `game.createRoom` throws to refuse a request (a bad number of players, say).  Its message is a refusal code
 * and it may carry the values the words need, so the server can answer the client as it answers any other refusal.
 * @param {string} code  a key under `errors.` in the game's locale file or the site's
 * @param {object} [params]  the values the text needs
 * @returns {Refusal}
 * Side effects: none.
 */
export function refusal(code, params) {
  const error = /** @type {Refusal} */ (new Error(code));
  error.refusal = true;
  if (params) error.params = params;
  return error;
}

/**
 * The reply for an Error thrown out of `createRoom`: its own code when it is a refusal, otherwise a plain server error
 * (a rules bug must not show the player a developer's sentence, in English or at all).
 * @param {Refusal} error  what was thrown
 * @returns {{ ok: false, error: string, params?: object }}
 * Side effects: none.
 */
export const refusalReply = (error) =>
  error?.refusal && CODE.test(error.message) ? { ok: false, error: error.message, ...(error.params ? { params: error.params } : {}) } : { ok: false, error: 'serverError' };
