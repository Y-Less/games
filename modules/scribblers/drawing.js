// The canvas: what one drawing is made of, and what the server will accept into it.  A drawing is a list of
// instructions, exactly as scribble.rs has them, so the same real-time sketch protocol works here:
//
//   { t: 'line', x, y, x2, y2, c, w }   a stroke from one point to another, `c` a colour of the palette and `w` its width
//   { t: 'fill', x, y, c }              the flood fill of the area under a point
//
// The coordinates are in the board's own space (1600 x 900), whatever size the canvas is on the screen, so everybody
// sees the same drawing.  A stroke may begin or end outside the board: a pen dragged over the edge draws up to it
// rather than stopping short.
//
// The instructions are kept in memory only, and only for the turn being drawn: they are far too many to put in a view
// or to save (a single turn can be tens of thousands of them), so the socket layer relays them as they come and hands
// the whole list to anybody who arrives in the middle of a turn.
// Depends on: nothing.

/** The drawing board's own coordinate space, which every instruction speaks. */
export const BOARD = { width: 1600, height: 900 };

/**
 * The colours a drawing may use, in the order the toolbox shows them: an instruction names one by its place here, which
 * is what scribble.rs's protocol does too (it saves sending three numbers where one will do).  The bright thirteen come
 * first, then their darker twins.
 */
export const PALETTE = [
  '#ffffff',
  '#c1c1c1',
  '#ef130b',
  '#ff7100',
  '#ffe400',
  '#00cc00',
  '#00b2ff',
  '#231fd3',
  '#a300ba',
  '#d37caa',
  '#a0522d',
  '#592f2a',
  '#ecbcb4',
  '#000000',
  '#4c4c4c',
  '#740b07',
  '#c23800',
  '#e8a200',
  '#005510',
  '#00569e',
  '#0e0865',
  '#550069',
  '#a75574',
  '#63300d',
  '#492f31',
  '#d1a3a4',
];

/** White: what the board starts as, and what the rubber draws with. */
export const WHITE = 0;
/** How many colours the palette has (an instruction names a colour by its place in it). */
export const COLOURS = PALETTE.length;
/** The thinnest and thickest a stroke may be, in board units. */
export const BRUSH = { min: 8, max: 32 };
/** How far outside the board a stroke may reach (a pen dragged past the edge). */
const OVERREACH = 400;
/** How many instructions one turn's drawing may hold before the rest are dropped. */
export const MAX_OPS = 24000;
/** How many instructions one message may carry (either way: a batch from a client, or a chunk of a whole drawing). */
export const MAX_BATCH = 512;
/** Strokes that arrive within this long of each other are one stroke as far as "undo" is concerned, which is how
 * scribble.rs decides it: the client cannot be trusted to say where a stroke begins and ends. */
const STROKE_GAP_MS = 150;

/**
 * A new, empty drawing.
 * @returns {{ ops: object[], groups: number[], lastAt: number }} the instructions, where each stroke begins, and when
 *   the last instruction arrived
 * Side effects: none.
 */
export const newDrawing = () => ({ ops: [], groups: [], lastAt: 0 });

/**
 * A whole number from an untrusted value, or null.
 * @param {unknown} value
 * @returns {number | null}
 * Side effects: none.
 */
const whole = (value) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/**
 * Keeps a number inside a range.
 * @param {number} n  @param {number} low  @param {number} high  @returns {number}
 * Side effects: none.
 */
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));

/**
 * Reads one drawing instruction out of whatever a client sent, or returns null if it is not one.  Sizes and colours are
 * brought into range rather than refused (a client with a different idea of the limits still draws something sensible),
 * but anything that is not a number at all is refused.
 *
 * @param {unknown} raw  the payload from a client
 * @returns {object | null} the instruction to keep and relay, or null
 * Side effects: none.
 */
export function readOp(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const colour = whole(raw.c);
  if (colour === null || colour < 0 || colour >= COLOURS) return null;
  if (raw.t === 'fill') {
    const x = whole(raw.x);
    const y = whole(raw.y);
    if (x === null || y === null || x < 0 || y < 0 || x >= BOARD.width || y >= BOARD.height) return null;
    return { t: 'fill', x, y, c: colour };
  }
  if (raw.t !== 'line') return null;
  const points = [raw.x, raw.y, raw.x2, raw.y2].map(whole);
  if (points.some((n) => n === null)) return null;
  const [x, y, x2, y2] = points;
  const width = whole(raw.w);
  if (width === null) return null;
  const inX = (n) => clamp(n, -OVERREACH, BOARD.width + OVERREACH);
  const inY = (n) => clamp(n, -OVERREACH, BOARD.height + OVERREACH);
  return { t: 'line', x: inX(x), y: inY(y), x2: inX(x2), y2: inY(y2), c: colour, w: clamp(width, BRUSH.min, BRUSH.max) };
}

/**
 * Adds instructions to a drawing, noting where each stroke begins so that "undo" can take one off.  A fill is always a
 * stroke of its own; lines that arrive one after another without a pause are one stroke.
 *
 * @param {object} drawing  from newDrawing (mutated)
 * @param {object[]} ops  instructions that have been through readOp
 * @param {number} now  the clock
 * @returns {object[]} the instructions actually kept (none, once the drawing is full)
 * Side effects: pushes onto drawing.ops and drawing.groups and sets drawing.lastAt.
 */
export function addOps(drawing, ops, now) {
  const kept = [];
  for (const op of ops) {
    if (drawing.ops.length >= MAX_OPS) break;
    const fresh = op.t === 'fill' || now - drawing.lastAt > STROKE_GAP_MS || drawing.ops.at(-1)?.t === 'fill';
    if (fresh) drawing.groups.push(drawing.ops.length);
    drawing.lastAt = now;
    drawing.ops.push(op);
    kept.push(op);
  }
  return kept;
}

/**
 * Takes the last stroke off a drawing.
 * @param {object} drawing  from newDrawing (mutated)
 * @returns {boolean} true if something was taken off, so the table needs redrawing
 * Side effects: shortens drawing.ops and drawing.groups.
 */
export function undo(drawing) {
  const from = drawing.groups.pop();
  if (from === undefined || from >= drawing.ops.length) return drawing.groups.length > 0 ? undo(drawing) : false;
  drawing.ops.length = from;
  return true;
}

/**
 * A whole drawing as messages to send one after another: small enough not to choke a socket, and marked so that the
 * receiver knows to start afresh and when it has the lot.  An empty drawing is one message that clears the board.
 *
 * @param {object[]} ops  the instructions
 * @returns {{ ops: object[], first: boolean, done: boolean }[]} the messages, in order
 * Side effects: none.
 */
export function canvasMessages(ops) {
  if (!ops.length) return [{ ops: [], first: true, done: true }];
  const messages = [];
  for (let at = 0; at < ops.length; at += MAX_BATCH) {
    messages.push({ ops: ops.slice(at, at + MAX_BATCH), first: at === 0, done: at + MAX_BATCH >= ops.length });
  }
  return messages;
}

/**
 * Empties a drawing.
 * @param {object} drawing  from newDrawing (mutated)
 * @returns {boolean} true if there was anything to clear
 * Side effects: empties drawing.ops and drawing.groups.
 */
export function clear(drawing) {
  if (!drawing.ops.length) return false;
  drawing.ops = [];
  drawing.groups = [];
  return true;
}
