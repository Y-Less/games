// The geometry of the Wavelength dial, with no Vue. A position is 0 (the left end) to 100 (the right end); the dial is a
// half circle drawn over the top of its centre, so 0 is at 180 degrees and 100 at 0 degrees.

export const VIEW = { width: 220, height: 122, cx: 110, cy: 112, radius: 100 };

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const clampPosition = (position) => clamp(Number(position) || 0, 0, 100);

/** The angle in radians (0 right, pi left) of a position. */
export const angleOf = (position) => Math.PI * (1 - clampPosition(position) / 100);

/** The point at `radius` from the centre in the direction of a position. */
export function pointAt(position, radius = VIEW.radius) {
  const angle = angleOf(position);
  return { x: VIEW.cx + radius * Math.cos(angle), y: VIEW.cy - radius * Math.sin(angle) };
}

/** The position a point (in view units) is in the direction of: below the centre it snaps to the nearer end. */
export function positionAt(x, y) {
  const dx = x - VIEW.cx;
  const dy = VIEW.cy - y;
  if (dy <= 0) return dx < 0 ? 0 : 100;
  return Math.round(clampPosition((1 - Math.atan2(dy, dx) / Math.PI) * 100) * 10) / 10;
}

/** The path of a slice of the dial from one position to another, reaching out to `radius`. */
export function wedgePath(from, to, radius = VIEW.radius) {
  const a = pointAt(from, radius);
  const b = pointAt(to, radius);
  return `M ${VIEW.cx} ${VIEW.cy} L ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`;
}

/** The slices of the target, widest first (so the narrower ones are drawn over it): [{ points, from, to }]. */
export function targetWedges(target, bands) {
  return [...bands]
    .sort((a, b) => b.within - a.within)
    .map((band) => ({ points: band.points, from: clampPosition(target - band.within), to: clampPosition(target + band.within) }));
}
