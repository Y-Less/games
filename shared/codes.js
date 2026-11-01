// Room-code tidying, shared by the server (codes.js) and every client: "Boss Aware You", "?boss-aware-you" or a
// pasted invite link all become "boss-aware-you". Returns '' when the text is not a three-word code.
// Depends on: nothing (pure, no imports).
// The only shape a valid code takes: three lower-case words joined by hyphens.
const SHAPE = /^[a-z]+(-[a-z]+){2}$/;

/**
 * Tidies free text (typed, pasted or taken from a link) into a canonical room code.
 * Everything before the last "?" is dropped so pasted invite links work; any run of non-letters becomes one hyphen.
 * @param {unknown} raw  whatever the user supplied; non-strings give ''
 * @returns {string} the "word-word-word" code, or '' when the text does not have that shape
 * Side effects: none.
 */
export function normaliseCode(raw) {
  if (typeof raw !== 'string') return '';
  let code = raw.trim().toLowerCase();
  if (code.includes('?')) code = code.slice(code.lastIndexOf('?') + 1);
  code = code.replace(/^code=/, '').replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '');
  return SHAPE.test(code) ? code : '';
}
