// Marker colours: the colour a player's pieces, rings and needles have in games that give each player one (Tints and
// Hints, Wavelength).  Everyone may choose from the free palette; any other colour is an unlock in the shop
// ("marker-colour").  A player may save a default, which a game uses when they join, if nobody has it already.
// The free palette every player may use without buying anything.
// Depends on: nothing (pure, no imports); used by server/profile.js and the marker-colour games.
export const MARKER_COLOURS = ['#ffffff', '#000000', '#808080', '#ff2d95', '#00e5ff', '#ffd400', '#7cff3a', '#6a00ff'];
// Shop item id that unlocks any colour (not just the palette).
export const CUSTOM_MARKER_ITEM = 'marker-colour';

// Six-digit hex colour, case-insensitive.
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Canonicalises a colour to six-digit lower-case hex.
 * @param {unknown} value  a candidate colour
 * @returns {string|null} the refusal code (a key under `errors.` in the site's locale files), or null when the colour is free
 * Side effects: none.
 */
export const normaliseMarker = (value) => (typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : null);

// Returns true when the colour is one of the free palette colours (after normalising).
export const isPresetMarker = (value) => MARKER_COLOURS.includes(normaliseMarker(value));

/**
 * Picks the colour a new player gets: their default when it is usable and not taken, otherwise the first free palette colour.
 * @param {string|null|undefined} preferred  the player's saved default colour
 * @param {string[]} taken  colours already used in the room (lower-case hex)
 * @param {boolean} [canCustom]  true when the player may use a colour outside the palette
 * @returns {string|null} the colour, or null when every palette colour is taken
 * Side effects: none.
 */
export function startingMarker(preferred, taken, canCustom = false) {
  const wanted = normaliseMarker(preferred);
  if (wanted && !taken.includes(wanted) && (canCustom || MARKER_COLOURS.includes(wanted))) return wanted;
  return MARKER_COLOURS.find((c) => !taken.includes(c)) ?? null;
}

/**
 * Checks whether a player may take a colour.
 * @param {unknown} colour  the requested colour
 * @param {string[]} taken  colours already used in the room (lower-case hex)
 * @param {boolean} canCustom  true when the player may use a colour outside the palette
 * @returns {string|null} a message for the player explaining the problem, or null when the colour is fine
 * Side effects: none.
 */
export function markerProblem(colour, taken, canCustom) {
  const wanted = normaliseMarker(colour);
  if (!wanted) return 'notAColour';
  if (!canCustom && !MARKER_COLOURS.includes(wanted)) return 'colourIsUnlock';
  if (taken.includes(wanted)) return 'colourTaken';
  return null;
}
