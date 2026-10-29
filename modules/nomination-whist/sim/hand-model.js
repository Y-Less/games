// The hand model: a small neural network, learned from many simulated deals, that says what each nomination is worth
// for the exact cards in a hand (see hand-features.js for what it is shown). It replaces the bid-value table's
// rounded estimate for hands of three or more cards. Its first layer is, in effect, a set of weights on every card value
// (rank, trump or not) and on how the cards fit together; the layers after that combine them.
//
// For every number that could be nominated (0 to 7) it gives two things, as the bid-value table does:
//   - the chance of hitting it exactly (a logistic output), and
//   - the tricks taken on a miss, counted as 0 on a hit (a plain output, never below 0),
// so the points are chance * (10 + number) + tricks on a miss, and the AI nominates the allowed number worth most.
//
// On disk (models/hand-values.json, and hand-values-jokers.json for games with the Jokers): the weights as plain arrays.
import fs from 'node:fs';
import { INPUTS, handFeatures } from './hand-features.js';

export const HAND_FILES = {
  false: new URL('./models/hand-values.json', import.meta.url),
  true: new URL('./models/hand-values-jokers.json', import.meta.url),
};
export const HIDDEN = 64;
export const BIDS = 8; // nominations 0 to 7
export const OUTPUTS = 2 * BIDS;

/** A new model with small random weights (`rng` gives numbers in [0, 1)). */
export function newModel(rng = Math.random, hidden = HIDDEN) {
  const scale1 = Math.sqrt(1 / INPUTS);
  const scale2 = Math.sqrt(1 / hidden);
  const fill = (length, scale) => Float32Array.from({ length }, () => (rng() * 2 - 1) * scale);
  return { hidden, w1: fill(hidden * INPUTS, scale1), b1: new Float32Array(hidden), w2: fill(OUTPUTS * hidden, scale2), b2: new Float32Array(OUTPUTS) };
}

/** What the network says for a feature vector: `hit` and `miss` arrays of BIDS entries (logit and tricks), into `out` if given. */
export function forward(model, x, out = { h: new Float32Array(model.hidden), y: new Float32Array(OUTPUTS) }) {
  const { hidden, w1, b1, w2, b2 } = model;
  const { h, y } = out;
  for (let j = 0; j < hidden; j++) {
    let sum = b1[j];
    const row = j * INPUTS;
    for (let i = 0; i < INPUTS; i++) if (x[i] !== 0) sum += w1[row + i] * x[i];
    h[j] = Math.tanh(sum);
  }
  for (let k = 0; k < OUTPUTS; k++) {
    let sum = b2[k];
    const row = k * hidden;
    for (let j = 0; j < hidden; j++) sum += w2[row + j] * h[j];
    y[k] = sum;
  }
  return out;
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** The chance of hitting a nomination and the tricks taken when it is missed, from the network's output. */
export const hitChance = (y, bid) => sigmoid(y[bid]);
export const missTricks = (y, bid) => Math.max(0, y[BIDS + bid]);

/** What a nomination is worth in points. A miss scores the tricks taken, if misses score. */
export const pointsOf = (y, bid, missPoints = true) => hitChance(y, bid) * (10 + bid) + (missPoints ? missTricks(y, bid) : 0);

const features = new Float32Array(INPUTS);
const scratch = new WeakMap();
/** The expected points of every nomination from 0 to the number of cards, for a decision (as an AI is given it). */
export function valuesFor(model, ctx) {
  let buffers = scratch.get(model);
  if (!buffers) scratch.set(model, (buffers = { h: new Float32Array(model.hidden), y: new Float32Array(OUTPUTS) }));
  const { y } = forward(model, handFeatures(ctx, features), buffers);
  const { hand, missPoints = true } = ctx;
  return Array.from({ length: Math.min(BIDS, hand.length + 1) }, (_, bid) => pointsOf(y, bid, missPoints));
}

/** The allowed nomination with the best expected points, or null if none of them is one the model can value. */
export function bestByHandModel(model, ctx) {
  const values = valuesFor(model, ctx);
  let best = null;
  let bestPoints = -Infinity;
  for (const bid of ctx.allowed) {
    if (bid >= values.length) continue;
    if (values[bid] > bestPoints) {
      best = bid;
      bestPoints = values[bid];
    }
  }
  return best;
}

const loaded = {};
const round = (array) => Array.from(array, (v) => Math.round(v * 1e5) / 1e5);

/** The model as plain data for the file. */
export const modelToJson = (model, meta = {}) => ({ kind: 'hand-values', version: 1, inputs: INPUTS, hidden: model.hidden, ...meta, w1: round(model.w1), b1: round(model.b1), w2: round(model.w2), b2: round(model.b2) });

/** The model from plain data, or null if the data is not a model of this shape. */
export function modelFromJson(data) {
  if (data?.kind !== 'hand-values' || data.inputs !== INPUTS || data.w1?.length !== data.hidden * INPUTS || data.w2?.length !== OUTPUTS * data.hidden) return null;
  return { hidden: data.hidden, w1: Float32Array.from(data.w1), b1: Float32Array.from(data.b1), w2: Float32Array.from(data.w2), b2: Float32Array.from(data.b2) };
}

/** The saved model for games without (or with) the Jokers, loaded once; null if there is none. `reload` forgets what was loaded. */
export function handModel(jokers = false, reload = false) {
  const key = jokers === true;
  if (reload) delete loaded[key];
  if (loaded[key] === undefined) {
    try {
      loaded[key] = modelFromJson(JSON.parse(fs.readFileSync(HAND_FILES[key], 'utf8')));
    } catch {
      loaded[key] = null;
    }
  }
  return loaded[key];
}
