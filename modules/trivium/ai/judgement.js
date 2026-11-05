// The one piece of thinking every Trivium computer player shares: how often it knows an answer, how long it takes, and
// whereabouts on the button it taps.  Each AI beside this file is then only the numbers that make it itself.
//
// A computer player is told the right answer, which is not the cheat it looks like: there is no hand to peek at here,
// only a fact nobody at the table shares, and a player who had to work the answer out from the words would either know
// everything or nothing.  So the knowing is simulated instead - an AI rolls against its own confidence, by how hard
// the question is, and when it loses that roll it picks one of the wrong answers, exactly as a person does.
// Depends on: nothing (pure, no imports, no clock): it is handed the question and an `rng`, and answers with plain data.

/** Where on a button a tap lands, as a fraction of it, for an AI that is not aiming at anything in particular. */
const SPREAD = { from: 0.12, to: 0.88 };
/** How near the middle an AI that aims for the middle gets. */
const CENTRE = 0.05;
/** How near the edge an AI that taps carelessly gets. */
const EDGE = 0.03;

/**
 * How sure this AI is of a question of that difficulty.  An unknown difficulty is taken as medium, because the API
 * does label some questions with nothing at all.
 *
 * @param {{ easy: number, medium: number, hard: number }} knows  the AI's confidence, 0 to 1
 * @param {string} difficulty  'easy', 'medium', 'hard', or anything else
 * @returns {number} the chance it gets this one right
 * Side effects: none.
 */
export const confidence = (knows, difficulty) => knows[difficulty] ?? knows.medium;

/**
 * Where on the button to tap.
 *
 * @param {'anywhere' | 'centre' | 'edge'} aim  how this AI taps
 * @param {() => number} rng  random source returning a number in [0, 1)
 * @returns {{ x: number, y: number }} fractions of the button, 0 at the left and top
 * Side effects: none beyond advancing `rng` twice.
 */
export function tap(aim, rng) {
  if (aim === 'centre') return { x: 0.5 + (rng() - 0.5) * 2 * CENTRE, y: 0.5 + (rng() - 0.5) * 2 * CENTRE };
  if (aim === 'edge') {
    // Hard against one of the four edges, at a random place along it.
    const along = rng();
    const which = Math.floor(rng() * 4);
    const near = EDGE / 2;
    if (which === 0) return { x: along, y: near };
    if (which === 1) return { x: along, y: 1 - near };
    if (which === 2) return { x: near, y: along };
    return { x: 1 - near, y: along };
  }
  const spread = () => SPREAD.from + rng() * (SPREAD.to - SPREAD.from);
  return { x: spread(), y: spread() };
}

/**
 * One computer player's answer to one question.
 *
 * @param {object} context  what the seat is given: `answers`, `correct` (the index of the right one), `difficulty`
 * @param {() => number} rng  random source returning a number in [0, 1)
 * @param {object} style  what makes this AI itself
 * @param {{ easy: number, medium: number, hard: number }} style.knows  how often it gets one right, by difficulty
 * @param {[number, number]} style.pace  how long it takes, as a fraction of the time allowed
 * @param {'anywhere' | 'centre' | 'edge'} [style.aim]  whereabouts on the button it taps
 * @param {number} [style.silence]  how often it lets a question go by without answering at all
 * @returns {{ choice: number, x: number, y: number, speed: number } | null} the answer, or null for no answer
 * Side effects: none beyond advancing `rng`.
 */
export function decide(context, rng, { knows, pace, aim = 'anywhere', silence = 0 }) {
  const answers = Array.isArray(context?.answers) ? context.answers : [];
  if (!answers.length) return null;
  if (silence > 0 && rng() < silence) return null;
  const correct = Number.isInteger(context?.correct) && context.correct >= 0 && context.correct < answers.length ? context.correct : 0;
  let choice = correct;
  if (rng() >= confidence(knows, context?.difficulty)) {
    // It does not know: one of the wrong answers, chosen evenly.
    const wrong = answers.map((_, index) => index).filter((index) => index !== correct);
    choice = wrong.length ? wrong[Math.min(wrong.length - 1, Math.floor(rng() * wrong.length))] : correct;
  }
  const [slow, quick] = [Math.min(...pace), Math.max(...pace)];
  return { choice, ...tap(aim, rng), speed: slow + rng() * (quick - slow) };
}
