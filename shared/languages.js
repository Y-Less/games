// Language tags, as a player's profile and a rules request name them. The site has no fixed list of languages: the client
// finds its locale files itself (src/i18n.js), so the server only has to recognise a tag and keep a saved one tidy.
// Depends on: nothing.

/** A BCP 47 language tag of the simple kind: 'en', 'fr', 'pt-BR', 'zh-Hant' (a primary subtag and up to three more). */
const TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;

/**
 * Whether a value is a language tag the site would accept.
 * @param {*} value
 * @returns {boolean}
 * Side effects: none.
 */
export const isLanguageTag = (value) => typeof value === 'string' && TAG.test(value);
