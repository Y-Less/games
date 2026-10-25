// Room-code tidying, shared by the server (codes.js) and every client: "Boss Aware You", "?boss-aware-you" or a
// pasted invite link all become "boss-aware-you". Returns '' when the text is not a three-word code.
const SHAPE = /^[a-z]+(-[a-z]+){2}$/;

export function normaliseCode(raw) {
  if (typeof raw !== 'string') return '';
  let code = raw.trim().toLowerCase();
  if (code.includes('?')) code = code.slice(code.lastIndexOf('?') + 1);
  code = code.replace(/^code=/, '').replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '');
  return SHAPE.test(code) ? code : '';
}
