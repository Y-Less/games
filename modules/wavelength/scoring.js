// The scoring numbers of Wavelength that the server's rules AND the client both need, in one pure file (it imports nothing,
// so the browser can load it). game.js re-exports everything here; Table.vue imports it directly.

/** The bands of the target, from the middle outwards: a guess within `within` of the target scores `points`. */
export const BANDS = [
  { within: 2.5, points: 4 },
  { within: 7.5, points: 3 },
  { within: 12.5, points: 2 },
];

/** The most one turn can score for a guesser: a bullseye (the middle band). */
export const MAX_TURN_POINTS = BANDS[0].points;

/** What a team has to average a turn to win its game: the outer band, so "in the target" every turn. */
export const TEAM_WIN_TURN_POINTS = BANDS.at(-1).points;

/**
 * The most a score can be over a whole game (everybody bullseyes every turn).
 *
 * @param {number} turnsTotal  how many turns the game has
 * @returns {number} the top possible score
 *
 * Side effects: none.
 */
export const maxScore = (turnsTotal) => MAX_TURN_POINTS * turnsTotal;

/**
 * The score a team needs to win its game (the server uses this for the statistics).
 *
 * @param {number} turnsTotal  how many turns the game has
 * @returns {number} the winning score: the outer band's points every turn
 *
 * Side effects: none.
 */
export const teamWinScore = (turnsTotal) => TEAM_WIN_TURN_POINTS * turnsTotal;
