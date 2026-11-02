// Computer-player "AIs": each module keeps a list of named decision-making styles under modules/<id>/ai/.
// When a game starts, every bot is given one of them for the whole game.  This file only handles the registry
// and the choosing; what an AI actually decides is defined by each game (see MODULES.md, "Computer players").
//
// An AI is a plain object: { id, name, description, weight?, ...game-specific decision functions }.
// `id` is unique per game, `name` and `description` are shown to the host, `weight` (default 1) biases the
// random choice, and a weight of 0 keeps an AI out of the random pool (it can still be picked by id).
// Keep AI files free of node-only imports and of Math.random: use the `rng` the game passes in.
//
// Depends on: nothing (pure, no imports); the AI objects themselves live in modules/<id>/ai/.

/**
 * Validates a module's list of AIs (non-empty, unique string ids, names present, weights sane).
 * @param {Array<{ id: string, name: string, weight?: number }>} list  the module's AI definitions
 * @returns {Array<object>} the same list, unchanged, so it can be exported in one expression
 * Side effects: none (throws an Error describing the first problem found).
 */
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

/**
 * Looks an AI up by id, falling back to the first one (for rooms saved before an AI existed or was renamed).
 * @param {Array<{ id: string }>} list  the module's AIs
 * @param {string} id  the AI id stored in the room
 * @returns {object} the matching AI, or list[0] when the id is unknown
 * Side effects: none.
 */
export function aiById(list, id) {
  return list.find((ai) => ai.id === id) ?? list[0];
}

/**
 * Picks one AI at random, biased by `weight` (default 1; weight 0 is never picked at random).
 * @param {Array<{ id: string, weight?: number }>} list  the module's AIs
 * @param {() => number} rng  random source returning a number in [0, 1); passed in so games stay reproducible
 * @returns {object} the chosen AI (list[0] if every AI has weight 0)
 * Side effects: none beyond advancing `rng` once.
 */
export function pickAI(list, rng) {
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

/**
 * Gives each bot seat an AI id; call when a game starts so a bot keeps one style for the whole game.
 * @param {Array<{ id: string, weight?: number }>} list  the module's AIs
 * @param {Array<string|number>} seatKeys  the bot seats to assign
 * @param {() => number} rng  random source returning a number in [0, 1)
 * @returns {Record<string, string>} map of seatKey to AI id
 * Side effects: none beyond advancing `rng` once per seat.
 */
export function assignAIs(list, seatKeys, rng) {
  return Object.fromEntries(seatKeys.map((key) => [key, pickAI(list, rng).id]));
}

/**
 * Reduces an AI to what the view may show (never the decision functions, which are not serialisable and not for clients).
 * @param {{ id: string, name: string, description?: string }} ai  the AI definition
 * @returns {{ id: string, name: string, description: string }} the public description
 * Side effects: none.
 */
export function describeAI(ai) {
  return { id: ai.id, name: ai.name, description: ai.description ?? '' };
}
