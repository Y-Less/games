// Computer-player "AIs": each module keeps a list of named decision-making styles under modules/<id>/ai/.
// When a game starts, every bot is given one of them for the whole game. This file only handles the registry
// and the choosing; what an AI actually decides is defined by each game (see MODULES.md, "Computer players").
//
// An AI is a plain object: { id, name, description, weight?, ...game-specific decision functions }.
// `id` is unique per game, `name` and `description` are shown to the host, `weight` (default 1) biases the
// random choice, and a weight of 0 keeps an AI out of the random pool (it can still be picked by id).
// Keep AI files free of node-only imports and of Math.random: use the `rng` the game passes in.

/** Checks a module's list of AIs, returning it unchanged. Throws on duplicates or missing fields. */
export function defineAIs(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('A module needs at least one AI');
  const seen = new Set();
  for (const ai of list) {
    if (!ai || typeof ai.id !== 'string' || !ai.id) throw new Error('Every AI needs an id');
    if (seen.has(ai.id)) throw new Error(`Duplicate AI id "${ai.id}"`);
    seen.add(ai.id);
    if (typeof ai.name !== 'string' || !ai.name) throw new Error(`AI "${ai.id}" needs a name`);
    if (ai.weight !== undefined && !(Number.isFinite(ai.weight) && ai.weight >= 0)) throw new Error(`AI "${ai.id}" has a bad weight`);
  }
  return list;
}

/** Looks an AI up by id, falling back to the first one (for rooms saved before an AI existed or was renamed). */
export function aiById(list, id) {
  return list.find((ai) => ai.id === id) ?? list[0];
}

/**
 * Picks one AI at random (by weight). `rng` is a () => number in [0, 1).
 * @param {Array<{ id: string, weight?: number }>} list
 */
export function pickAI(list, rng = Math.random) {
  const pool = list.filter((ai) => (ai.weight ?? 1) > 0);
  if (!pool.length) return list[0];
  const total = pool.reduce((sum, ai) => sum + (ai.weight ?? 1), 0);
  let roll = rng() * total;
  for (const ai of pool) {
    roll -= ai.weight ?? 1;
    if (roll < 0) return ai;
  }
  return pool[pool.length - 1];
}

/** Gives each bot seat an AI id; call when a game starts. Returns { [seatKey]: aiId }. */
export function assignAIs(list, seatKeys, rng = Math.random) {
  return Object.fromEntries(seatKeys.map((key) => [key, pickAI(list, rng).id]));
}

/** What the view may show about an AI (name and description only; never the decision functions). */
export function describeAI(ai) {
  return { id: ai.id, name: ai.name, description: ai.description ?? '' };
}
