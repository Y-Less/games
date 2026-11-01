// Turns what the server sends into words: a message `{ key, params }` (see shared/messages.js) becomes text in the
// current language, looked up in the game's own messages first and then the site's. Usable outside components (api.js);
// inside one, useGameText.js wraps it with the game's id.
// Depends on: ./i18n.js (the instance) and shared/messages.js (isMessage).
import { isMessage } from '../shared/messages.js';
import { FALLBACK, i18n } from './i18n.js';

/**
 * Whether a key has text in the current language or the fallback.
 * @param {string} key  a full key ('errors.notYourTurn', 'hearts.lobby.intro')
 * @returns {boolean}
 * Side effects: none.
 */
export const hasText = (key) => i18n.global.te(key) || i18n.global.te(key, FALLBACK);

/**
 * The full key for a game-relative one: the game's own if it has it, else the site's.
 * @param {string} key  as a game writes it ('lobby.intro')
 * @param {string | null} game  the module id, or null outside a game
 * @returns {string}
 * Side effects: none.
 */
export const keyFor = (key, game) => (game && hasText(`${game}.${key}`) ? `${game}.${key}` : key);

/** The site's English is British: the browser's Intl objects get 'en-GB' for it (no serial comma, 1st/2nd/3rd). */
const INTL_TAGS = { en: 'en-GB' };

/**
 * The tag to give the Intl formatters for the current language.
 * @returns {string}
 * Side effects: none.
 */
export const intlLocale = () => INTL_TAGS[i18n.global.locale.value] ?? i18n.global.locale.value;

/**
 * Joins already-translated items the way the language does ("Ann, Bob and Cat").
 * @param {string[]} items
 * @returns {string}
 * Side effects: none.
 */
export function listText(items) {
  try {
    return new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

/**
 * A place as the language writes it ("1st", "22nd"), from the site's `ordinal.*` keys and the language's own ordinal rules.
 * @param {number} n  the place, 1-based
 * @returns {string}
 * Side effects: none.
 */
export function ordinalText(n) {
  let rule = 'other';
  try {
    rule = new Intl.PluralRules(intlLocale(), { type: 'ordinal' }).select(n);
  } catch {
    /* an unknown locale: the plain form */
  }
  return i18n.global.t(hasText(`ordinal.${rule}`) ? `ordinal.${rule}` : 'ordinal.other', { n });
}

/**
 * Words for a value from the server: text stays as it is (a name), a message is translated (its message params first,
 * a list param joined as the language joins lists, a numeric `count` choosing the plural form), and a message nobody
 * wrote shows its key, so the gap is visible rather than silent.
 * @param {string | { key: string, params?: object } | Array | null | undefined} value
 * @param {string | null} [game]  the module whose messages come first
 * @returns {string}
 * Side effects: none.
 */
export function messageText(value, game = null) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return listText(value.map((item) => messageText(item, game)));
  if (!isMessage(value)) return String(value);
  const params = Object.fromEntries(Object.entries(value.params ?? {}).map(([name, param]) => [name, isMessage(param) || Array.isArray(param) ? messageText(param, game) : param]));
  const key = keyFor(value.key, game);
  if (!hasText(key)) return value.key;
  return typeof params.count === 'number' ? i18n.global.t(key, params, params.count) : i18n.global.t(key, params);
}

/**
 * The words for a refusal: `{ error, params }` as the server sends it, with the code looked up under `errors.` (the
 * game's first). A code nobody wrote is shown as it is, so a stray sentence still reaches the player.
 * @param {{ error?: string, params?: object } | null | undefined} reply
 * @param {string | null} [game]
 * @returns {string}
 * Side effects: none.
 */
export function errorText(reply, game = null) {
  const code = reply?.error;
  if (typeof code !== 'string' || !code) return messageText({ key: 'errors.noAnswer' });
  return hasText(keyFor(`errors.${code}`, game)) ? messageText({ key: `errors.${code}`, params: reply.params }, game) : code;
}
