// Where the letters of the two Matrix rains go on the site background.  Both are laid out from a fixed seed, so the
// rain looks the same every time it is drawn (and the same in a test as on the screen).
//
// These say nothing about how a column is animated — that is BackgroundFx.vue's CSS, which reads the custom properties
// each column is given here.  They are kept apart from it because they are the only part of that file that decides
// anything: everything else it draws is a stylesheet.  Depends on nothing.

/** The letters the rain is made of: half-width katakana, as in the film, and the digits. */
export const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789';

/** The seed both rains start from, so that each is the same every time and the two differ from one another. */
const SEED = 20240229;

/**
 * A repeatable source of numbers (a linear congruential generator), so that a layout can be drawn again exactly.
 * @param {number} seed  where to start
 * @returns {() => number} the next number in [0, 1), each call
 * Side effects: none outside the returned function's own state.
 */
function seeded(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// Half of the columns (in either Matrix) start at the very top of the screen; the rest start anywhere down it.
// Returns true for roughly half of the columns (given the random source `next`), meaning they start at the very top.
const startsAtTop = (next) => next() < 0.5;
// Half of them run on to the bottom of the screen; the rest stop at a random height on the way (what fraction of the way from
// their start to the bottom they cover).
// Returns the fraction (0.15 to 1) of the way from its start to the bottom that a column covers, drawing from `next`.
const reach = (next) => (next() < 0.5 ? 1 : 0.15 + 0.75 * next());

/**
 * The Matrix rain, as in the film: the letters never move.  A bright head steps down each column, one row at a time,
 * and the letters it has passed fade away where they stand.  A column is one block of text; a mask slides down it in
 * steps to show the part the head has just passed (and a second mask shows the head's own, random, glyph), so there is
 * one animation per column and none per letter.
 *
 * @param {number} count  how many columns
 * @param {boolean} demo  true for the small shop preview (shorter columns)
 * @returns {Array<{text: string, lead: string, style: Object}>}  per column: the letters, the head's letters and CSS variables
 * Side effects: none (the seeded generator is local, so the result is repeatable).
 */
export function rain(count, demo) {
  const next = seeded(SEED);
  // Returns one random glyph character.
  const glyph = () => GLYPHS[Math.floor(next() * GLYPHS.length)];
  return Array.from({ length: count }, (_, i) => {
    // Each column has its own text size (mostly small, a few large) and, for about a third of them, is dimmer overall.
    const size = 0.55 + 1.5 * next() ** 1.6;
    const dim = next() < 0.35 ? 0.4 + 0.4 * next() : 1;
    // Where the column starts and how far down the screen its head gets (what runs off the bottom is clipped).
    const fullRows = Math.ceil((demo ? 150 : 1200) / (15 * size * 1.15));
    const top = startsAtTop(next) ? 0 : 0.7 * next() ** 1.3;
    const rows = Math.min(120, Math.max(4, Math.round(fullRows * (1 - top) * reach(next))));
    const trail = Math.min(rows, 3 + Math.floor(37 * next() ** 1.5)); // rows that are still lit behind the head: a few to a long trail
    const step = 0.06 + 0.1 * next(); // seconds the head takes per row
    const steps = rows + trail; // the head carries on until the last letter has faded
    const cycle = (steps * step) / 0.7; // the head's trip is 70% of the cycle; the column rests for the rest
    const text = Array.from({ length: rows }, glyph).join('\n');
    const lead = Array.from({ length: rows }, glyph).join('\n'); // what the head shows as it passes: not the letter it leaves
    const left = ((i + 0.1 + 0.8 * next()) / count) * 100;
    const style = { '--s': size.toFixed(2), '--n': rows, '--t': trail, '--steps': steps - 1, '--c': `${cycle.toFixed(2)}s`, '--ph': `${(next() * cycle).toFixed(2)}s`, opacity: dim.toFixed(2), left: `${left.toFixed(2)}%`, top: `${(top * 100).toFixed(1)}%` };
    return { text, lead, style };
  });
}

/**
 * Matrix A: the other rain, in which each column of letters slides down the screen and is rubbed out part-way.
 *
 * @param {number} count  how many columns
 * @returns {Array<{letters: Array, fade: string, wrap: Object, style: Object}>}  per column: lettered cells, erase animation name, position, and CSS variables
 * Side effects: none.
 */
export function rainSliding(count) {
  const next = seeded(SEED);
  return Array.from({ length: count }, (_, i) => {
    const duration = 6 + next() * 8;
    const length = 3 + Math.floor(37 * next() ** 1.5); // from a few letters to a long trail, with more short ones than long
    // Every letter keeps its own brightness, dim at the back of the column and full at the head.  The column is rubbed out
    // from its bottom upwards (see the erase animations below), and where in its fall that happens is its own.
    const letters = Array.from({ length }, (_, k) => ({
      ch: GLYPHS[Math.floor(next() * GLYPHS.length)],
      alpha: Math.min(1, 3 * (0.1 + 0.9 * (k / (length - 1)) ** 1.6)).toFixed(2), // three times as strong as it began: the look of the 300% intensity
    }));
    // Where in its fall a column starts to vanish: a few go almost at once, near the top of the screen, others partway down,
    // and some only as they leave it.
    const roll = next();
    const fade = roll < 0.08 ? 'v1' : roll < 0.2 ? 'v2' : roll < 0.35 ? 'v3' : roll < 0.55 ? 'v4' : roll < 0.75 ? 'v5' : 'v6';
    // Each column has its own text size (mostly small, a few large) and, for about a third of them, a dimmer overall brightness.
    const size = 0.55 + 1.5 * next() ** 1.6;
    const dim = next() < 0.35 ? 0.4 + 0.4 * next() : 1;
    const left = ((i + 0.1 + 0.8 * next()) / count) * 100;
    // A column runs only between its own start and end heights (a band of the screen with soft edges), not the whole height.
    const top = startsAtTop(next) ? 0 : 0.7 * next() ** 1.3;
    const height = (1 - top) * reach(next);
    const wrap = { left: `${left.toFixed(2)}%`, top: `${(top * 100).toFixed(1)}%`, height: `${(height * 100).toFixed(1)}%` };
    return { letters, fade, wrap, style: { '--n': length, '--s': size.toFixed(2), opacity: dim.toFixed(2), '--d': `${duration.toFixed(1)}s`, '--delay': `${(-next() * duration).toFixed(1)}s` } };
  });
}
