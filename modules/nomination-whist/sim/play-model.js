// The learned card-play table: for each decision feature key (play-features.js) the average points the round was worth to
// the player who made that play, plus how to read it, save it and load it. There are two tables of keys, fine (with the
// state of the other players) and coarse (without), and a play is valued from the fine cell when it has data and from
// the coarse cell otherwise.
//
// On disk (models/play.json + models/play.bin) values are stored as whole hundredths of a point in 16 bits, with
// MISSING for a cell that has no data, which keeps the table to a few megabytes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COARSE_CELLS, FINE_CELLS, keysFor } from './play-features.js';

const MISSING = -32768;
const SCALE = 100;
export const PLAY_FILES = { json: new URL('./models/play.json', import.meta.url), bin: new URL('./models/play.bin', import.meta.url) };

/** A table with no data: every value NaN (unknown). */
export const emptyPlayModel = () => ({ fine: new Float32Array(FINE_CELLS).fill(NaN), coarse: new Float32Array(COARSE_CELLS).fill(NaN) });

/** The value of a play, or NaN if the model knows nothing about it. */
export const valueOf = (model, key) => (Number.isNaN(model.fine[key.fine]) ? model.coarse[key.coarse] : model.fine[key.fine]);

/** Writes the model; `meta` says what it was trained on. */
export function savePlayModel(model, meta, jsonFile = PLAY_FILES.json, binFile = PLAY_FILES.bin) {
  const quantise = (floats) => Int16Array.from(floats, (v) => (Number.isNaN(v) ? MISSING : Math.max(-32767, Math.min(32767, Math.round(v * SCALE)))));
  const fine = quantise(model.fine);
  const coarse = quantise(model.coarse);
  const out = new Int16Array(fine.length + coarse.length);
  out.set(fine);
  out.set(coarse, fine.length);
  fs.mkdirSync(path.dirname(fileURLToPath(jsonFile)), { recursive: true });
  fs.writeFileSync(binFile, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  fs.writeFileSync(jsonFile, JSON.stringify({ kind: 'play', version: 1, fineCells: FINE_CELLS, coarseCells: COARSE_CELLS, scale: SCALE, ...meta }, null, 2));
}

/** Loads a saved model, or null if there is none (or it was made for different features). */
export function loadPlayModel(jsonFile = PLAY_FILES.json, binFile = PLAY_FILES.bin) {
  try {
    const meta = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    if (meta.fineCells !== FINE_CELLS || meta.coarseCells !== COARSE_CELLS) return null;
    const raw = fs.readFileSync(binFile);
    const ints = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const toFloats = (part) => Float32Array.from(part, (v) => (v === MISSING ? NaN : v / meta.scale));
    return { fine: toFloats(ints.subarray(0, FINE_CELLS)), coarse: toFloats(ints.subarray(FINE_CELLS)), meta };
  } catch {
    return null;
  }
}

/** The legal card with the highest learned value, or null if the model knows nothing about any of them. */
export function bestPlay(model, ctx) {
  let best = null;
  let bestValue = -Infinity;
  for (const key of keysFor(ctx)) {
    const value = valueOf(model, key);
    if (!Number.isNaN(value) && value > bestValue) {
      best = key.card;
      bestValue = value;
    }
  }
  return best;
}
