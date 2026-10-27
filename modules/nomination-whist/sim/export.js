// Turns the counts into files you can open: one CSV per table, with the keys as words and the chance worked out.
// Also saves and loads the raw counts (tables.bin + meta.json), which is what a run resumes from and what query.js reads.
import fs from 'node:fs';
import path from 'node:path';
import { DECK, ESTIMATE_STEPS, KINDS, MIN_PLAYERS, SPEC, Stats, TRUMPS, coordsOf } from './tables.js';

/** Key columns in words: every coordinate becomes the number a person expects (players 3-7, cards 1-7, a card name ...). */
function describe(key, value) {
  switch (key) {
    case 'players':
      return value + MIN_PLAYERS;
    case 'cards':
      return value + 1;
    case 'trump':
      return TRUMPS[value];
    case 'card':
      return DECK[value];
    case 'suitLen':
      return value + 1;
    case 'cardsLeft':
      return value + 1;
    case 'kind':
      return KINDS[value];
    case 'estimate':
      return value / ESTIMATE_STEPS;
    default:
      return value; // higherHeld, trumpsHeld, voids, position, seatOrder, taken, nomination
  }
}

const ratio = (count, n) => (n ? (count / n).toFixed(5) : '');

/** Writes one CSV per table into `dir`; cells that never came up are left out. Returns the file names. */
export function writeCsvs(stats, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const [name, spec] of Object.entries(SPEC)) {
    const columns = stats.tables[name];
    const second = spec.values.find((v) => v !== 'n');
    const header = [...spec.keys.map(([key]) => key), 'n', ...(second ? [second, 'chance'] : [])];
    const lines = [header.join(',')];
    for (let i = 0; i < columns.n.length; i++) {
      if (!columns.n[i]) continue;
      const coords = coordsOf(name, i);
      const row = coords.map((value, k) => describe(spec.keys[k][0], value));
      row.push(columns.n[i]);
      if (second) row.push(columns[second][i], ratio(columns[second][i], columns.n[i]));
      lines.push(row.join(','));
    }
    const file = `${name}.csv`;
    fs.writeFileSync(path.join(dir, file), lines.join('\n') + '\n');
    files.push(file);
  }
  return files;
}

/** Saves the raw counts and what produced them. `meta` holds the config, the chunks done and the deal count. */
export function saveCounts(stats, meta, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const floats = stats.toFloats();
  // Written to a temporary name first, so an interrupted save never leaves a half-written checkpoint behind.
  fs.writeFileSync(path.join(dir, 'tables.bin.tmp'), Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength));
  fs.renameSync(path.join(dir, 'tables.bin.tmp'), path.join(dir, 'tables.bin'));
  fs.writeFileSync(path.join(dir, 'meta.json.tmp'), JSON.stringify({ ...meta, deals: stats.deals, savedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(path.join(dir, 'meta.json.tmp'), path.join(dir, 'meta.json'));
}

/** Loads what saveCounts wrote: { stats, meta }, or null if there is nothing there. */
export function loadCounts(dir) {
  const metaFile = path.join(dir, 'meta.json');
  const binFile = path.join(dir, 'tables.bin');
  if (!fs.existsSync(metaFile) || !fs.existsSync(binFile)) return null;
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const raw = fs.readFileSync(binFile);
  const floats = new Float64Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); // copied, so it is aligned
  return { stats: Stats.fromFloats(floats, meta.deals), meta };
}
