// What a question is worth.  Kept apart from the rules so that the table can show the same numbers it scores by.
//
// Being right is most of it; being quick is the rest.  Every correct answer scores RIGHT_POINTS, and the people who
// got there first share out SPEED_BONUS on top, in the order their answers arrived: the quickest right answer is worth
// twice a slow one, and a slow right answer is still worth far more than a fast wrong one.
// Depends on: nothing (pure, no imports).

/** What any correct answer is worth, however long it took. */
export const RIGHT_POINTS = 5;
/** The extra for being quick, by place among the correct answers: the sixth onwards get none. */
export const SPEED_BONUS = [5, 4, 3, 2, 1];
/** The most one question can be worth. */
export const MAX_QUESTION_POINTS = RIGHT_POINTS + SPEED_BONUS[0];
/**
 * A right answer this quick (milliseconds) counts as a snap answer.  Half a second is not enough to read a question
 * and four answers, so it is either a subject you knew on sight or a button you hit on the way past and got away
 * with - which is why it is worth an achievement rather than a running count.
 */
export const SNAP_MS = 500;
/**
 * How near the middle of a button a tap has to be to count as a bullseye, each way along each axis, as a share of the
 * button.  A hundredth is about four pixels across and one down on a desktop, which is roughly what two pixels each
 * way would have been there.
 *
 * It is a share rather than a distance on the screen because the buttons are wide and short - about four and a half
 * to one - so two pixels is a third of a per cent across but a per cent and a half down, and because a button on a
 * phone is a third of the width of one on a wide desktop, which would make the same feat five times easier there.  A
 * share is the same wherever it is played, and needs nothing of the button sent back with the answer.
 */
export const CENTRE_WITHIN = 0.01;
/** How near an edge a tap has to be to count as on the edge (as a fraction of the button). */
export const EDGE_WITHIN = 0.04;

/**
 * What one answer scores.
 *
 * @param {boolean} right  whether it was the correct answer
 * @param {number} place  its place among the correct answers, 0 for the first
 * @returns {number} the points
 * Side effects: none.
 */
export const pointsFor = (right, place) => (right ? RIGHT_POINTS + (SPEED_BONUS[place] ?? 0) : 0);

/**
 * Is this tap in the very middle of its button?  The two halves of the game's oddest statistic (see EDGE_WITHIN for
 * the other); both are worked out from where a finger actually landed, which the server records with every answer.
 *
 * @param {number} x  across the button, 0 at the left edge and 1 at the right
 * @param {number} y  down the button, 0 at the top and 1 at the bottom
 * @returns {boolean}
 * Side effects: none.
 */
export const isCentre = (x, y) => Math.abs(x - 0.5) <= CENTRE_WITHIN && Math.abs(y - 0.5) <= CENTRE_WITHIN;

/**
 * Is this tap right on the edge of its button?
 *
 * @param {number} x  across the button, 0 to 1
 * @param {number} y  down the button, 0 to 1
 * @returns {boolean}
 * Side effects: none.
 */
export const isEdge = (x, y) => Math.min(x, 1 - x, y, 1 - y) <= EDGE_WITHIN;
