// Marker colours: the colour a player's pieces, rings and needles have in games that give each player one (Tints and
// Hints, Wavelength). Everyone may choose from the free palette; any other colour is an unlock in the shop
// ("marker-colour"). A player may save a default, which a game uses when they join, if nobody has it already.
export const MARKER_COLOURS = ['#ffffff', '#000000', '#808080', '#ff2d95', '#00e5ff', '#ffd400', '#7cff3a', '#6a00ff'];
export const CUSTOM_MARKER_ITEM = 'marker-colour';

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour as the six-digit, lower-case hex string it is kept as, or null when it is not one. */
export const normaliseMarker = (value) => (typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : null);

/** Whether a colour is one of the free ones. */
export const isPresetMarker = (value) => MARKER_COLOURS.includes(normaliseMarker(value));

/**
 * The colour a new player gets: their default when it is usable (`canCustom` for a colour outside the palette) and not
 * taken, otherwise the first free colour of the palette (or null if every one is taken).
 */
export function startingMarker(preferred, taken, canCustom = false) {
  const wanted = normaliseMarker(preferred);
  if (wanted && !taken.includes(wanted) && (canCustom || MARKER_COLOURS.includes(wanted))) return wanted;
  return MARKER_COLOURS.find((c) => !taken.includes(c)) ?? null;
}

/** Whether a player who may (or may not) use custom colours can take this one, given the colours already taken. */
export function markerProblem(colour, taken, canCustom) {
  const wanted = normaliseMarker(colour);
  if (!wanted) return 'That is not a colour.';
  if (!canCustom && !MARKER_COLOURS.includes(wanted)) return 'Any colour is an unlock in the shop. Choose one of the standard colours.';
  if (taken.includes(wanted)) return 'Someone else has that colour.';
  return null;
}
