// The spinner that picks a round's category: the slices, how wide each one is, and where the wheel stops.
//
// The slices are weighted by how many questions there are of each category, which is what makes Film & TV a wide
// wedge and a thinly stocked category a thin one.  A thin one is still given a floor (MIN_SHARE of the total), so
// that it can be read, aimed at, and landed on rather than being an invisible hairline.
//
// Angles are degrees clockwise from the top, where the pointer is: a slice runs from `from` to `to`, and the wheel
// resting at rotation `angle` has the point `360 - angle` under the pointer.  Both the rules (which choose where it
// stops) and the table (which draws it and turns it) work from these same numbers, so the wedge the pointer is in is
// always the category the server chose.
//
// Depends on: nothing (pure, no imports), so the rules, the table and the tests all read it the same way.

/**
 * The categories a wheel may hold, in a fixed order.  It is the canonical list of The Trivia API's ten (the keys of
 * CATEGORIES in shared/trivia.js); it is repeated here rather than imported because that file is the server's door to
 * the network, and the table draws these slices too.  A category this list does not know is still playable - it simply
 * has no colour or number of its own.
 */
export const CATEGORY_ORDER = [
  'arts_and_literature',
  'film_and_tv',
  'food_and_drink',
  'general_knowledge',
  'geography',
  'history',
  'music',
  'science',
  'society_and_culture',
  'sport_and_leisure',
];

/** The least of the wheel any one category may be given, however few questions it has. */
export const MIN_SHARE = 0.025;
/** How far inside a slice the wheel is made to stop, as a fraction of its width, so the pointer is never on a line. */
const INSET = 0.15;

/**
 * Builds the wheel from how many questions there are of each category.  Categories with nothing in them are left off
 * (a round of them could not be dealt), and every one that is on gets at least MIN_SHARE of the wheel.  Counts that
 * say nothing at all (no sources, or every count zero) give an even wheel of all ten, which is what the spinner did
 * before it knew any better.
 *
 * @param {Record<string, number>} counts  how many questions there are of each category
 * @returns {{ category: string, weight: number }[]} the slices, in CATEGORY_ORDER, each with a whole-number weight
 * Side effects: none.
 */
export function buildWheel(counts = {}) {
  const sizes = CATEGORY_ORDER.map((category) => ({ category, count: Math.max(0, Math.floor(Number(counts?.[category]) || 0)) }));
  const total = sizes.reduce((sum, s) => sum + s.count, 0);
  if (!total) return CATEGORY_ORDER.map((category) => ({ category, weight: 1 }));
  const floor = Math.max(1, Math.ceil(total * MIN_SHARE));
  return sizes.filter((s) => s.count > 0).map(({ category, count }) => ({ category, weight: Math.max(count, floor) }));
}

/**
 * Where each slice of a wheel begins and ends, in degrees clockwise from the pointer at the top.
 *
 * @param {{ category: string, weight: number }[]} wheel  the slices
 * @returns {{ category: string, weight: number, from: number, to: number }[]} the same slices with their angles
 * Side effects: none.
 */
export function slices(wheel) {
  const total = wheel.reduce((sum, s) => sum + Math.max(0, s.weight), 0) || wheel.length || 1;
  let at = 0;
  return wheel.map((slice, index) => {
    const from = at;
    at = index === wheel.length - 1 ? 360 : from + (Math.max(0, slice.weight) / total) * 360;
    return { category: slice.category, weight: slice.weight, from, to: at };
  });
}

/**
 * Spins the wheel: a category drawn in proportion to its slice, and the rotation the wheel comes to rest at so that
 * the pointer ends up well inside that slice.
 *
 * @param {{ category: string, weight: number }[]} wheel  the slices
 * @param {() => number} rng  random source returning a number in [0, 1)
 * @returns {{ category: string, angle: number }} the category and the resting rotation in degrees (0 to 360)
 * Side effects: none beyond advancing `rng` twice.
 */
export function pickSpin(wheel, rng) {
  const cut = slices(wheel);
  const total = cut.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  let roll = rng() * total;
  let chosen = cut[cut.length - 1];
  for (const slice of cut) {
    roll -= Math.max(0, slice.weight);
    if (roll < 0) {
      chosen = slice;
      break;
    }
  }
  const point = chosen.from + (chosen.to - chosen.from) * (INSET + (1 - 2 * INSET) * rng());
  return { category: chosen.category, angle: Math.round(((360 - point) % 360) * 100) / 100 };
}

/**
 * The category the pointer is over when the wheel rests at this rotation, for the tests and for a table that would
 * rather ask than be told.
 *
 * @param {{ category: string, weight: number }[]} wheel  the slices
 * @param {number} angle  the resting rotation in degrees
 * @returns {string} the category under the pointer
 * Side effects: none.
 */
export function categoryAt(wheel, angle) {
  const point = ((360 - angle) % 360 + 360) % 360;
  const cut = slices(wheel);
  return (cut.find((slice) => point >= slice.from && point < slice.to) ?? cut[cut.length - 1]).category;
}
