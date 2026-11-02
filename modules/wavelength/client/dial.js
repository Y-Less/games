// The geometry of the Wavelength dial, with no Vue.  A position is 0 (the left end) to 100 (the right end); the dial is a
// half circle drawn over the top of its centre, so 0 is at 180 degrees and 100 at 0 degrees.

// The SVG view box of the dial and where its centre and radius sit in it (all in view units).
export const VIEW = { width: 220, height: 122, cx: 110, cy: 112, radius: 100 };

// Returns `n` limited to the range min..max.
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
/**
 * Forces a position into 0..100 (anything that is not a number becomes 0).
 *
 * @param {number|string} position  a dial position, possibly out of range or not numeric
 * @returns {number} the position limited to 0..100
 *
 * Side effects: none.
 */
export const clampPosition = (position) => clamp(Number(position) || 0, 0, 100);

/**
 * The angle in radians (0 right, pi left) of a position.
 *
 * @param {number} position  a dial position, 0..100
 * @returns {number} the angle in radians, from pi (position 0) to 0 (position 100)
 *
 * Side effects: none.
 */
export const angleOf = (position) => Math.PI * (1 - clampPosition(position) / 100);

/**
 * The point at `radius` from the centre in the direction of a position.
 *
 * @param {number} position  a dial position, 0..100
 * @param {number} [radius]  distance from the dial's centre in view units (the dial's own radius by default)
 * @returns {{x: number, y: number}} the point in view units (SVG y grows downwards, hence the subtraction)
 *
 * Side effects: none.
 */
export function pointAt(position, radius = VIEW.radius) {
  const angle = angleOf(position);
  return { x: VIEW.cx + radius * Math.cos(angle), y: VIEW.cy - radius * Math.sin(angle) };
}

/**
 * The position a point (in view units) is in the direction of: below the centre it snaps to the nearer end.
 *
 * @param {number} x  the point's x in view units
 * @param {number} y  the point's y in view units
 * @returns {number} a position 0..100, rounded to one decimal place
 *
 * Side effects: none.
 */
export function positionAt(x, y) {
  const dx = x - VIEW.cx;
  const dy = VIEW.cy - y;
  if (dy <= 0) return dx < 0 ? 0 : 100;
  return Math.round(clampPosition((1 - Math.atan2(dy, dx) / Math.PI) * 100) * 10) / 10;
}

/**
 * The path of a slice of the dial from one position to another, reaching out to `radius`.
 *
 * @param {number} from  the position where the slice starts, 0..100
 * @param {number} to  the position where the slice ends, 0..100
 * @param {number} [radius]  how far out the slice reaches (the dial's own radius by default)
 * @returns {string} an SVG path (centre, line to the start, arc to the end, close)
 *
 * Side effects: none.
 */
export function wedgePath(from, to, radius = VIEW.radius) {
  const a = pointAt(from, radius);
  const b = pointAt(to, radius);
  // One SVG path command per step: move to the centre, line out to the start, arc round to the end, close.
  return ['M', VIEW.cx, VIEW.cy, 'L', a.x.toFixed(2), a.y.toFixed(2), 'A', radius, radius, 0, 0, 1, b.x.toFixed(2), b.y.toFixed(2), 'Z'].join(' ');
}

/**
 * The slices of the target, widest first (so the narrower ones are drawn over it): [{ points, from, to }].
 *
 * @param {number} target  the target's position, 0..100
 * @param {{within: number, points: number}[]} bands  the scoring bands: how far either side of the target each reaches, and its points
 * @returns {{points: number, from: number, to: number}[]} one slice per band, clamped to the dial
 *
 * Side effects: none (the bands are copied before sorting).
 */
export function targetWedges(target, bands) {
  return [...bands]
    .sort((a, b) => b.within - a.within)
    .map((band) => ({ points: band.points, from: clampPosition(target - band.within), to: clampPosition(target + band.within) }));
}
