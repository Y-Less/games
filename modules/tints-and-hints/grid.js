// The colour grid, shared by the server (what counts as a close guess) and the client (drawing it).
// A square is a column letter and a row digit, such as "M4". Columns are hues in steps of 15 degrees; rows go from
// muted and dark (0) to vivid (3 to 4) to pale (9).
export const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWX'.split('');
export const ROWS = '0123456789'.split('');

const LEVELS = [[25, 30], [50, 30], [75, 30], [100, 30], [100, 40], [100, 50], [100, 60], [100, 70], [100, 80], [100, 90]];

export const isCell = (cell) => typeof cell === 'string' && cell.length === 2 && COLS.includes(cell[0]) && ROWS.includes(cell[1]);

export function cellColour(cell) {
  const [saturation, lightness] = LEVELS[ROWS.indexOf(cell[1])];
  return `hsl(${COLS.indexOf(cell[0]) * 15}deg ${saturation}% ${lightness}%)`;
}

/** Within one square of the target, diagonals included. The hue does not wrap round from X to A. */
export function isClose(cell, target) {
  return Math.abs(COLS.indexOf(cell[0]) - COLS.indexOf(target[0])) <= 1 && Math.abs(Number(cell[1]) - Number(target[1])) <= 1;
}
