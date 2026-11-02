// One peg colour per seat, shared by the board, the score chips, and the lists.
/**
 * The peg colours, in seat order.
 * @type {string[]}
 * Side effects: none.
 */
export const SEAT_COLOURS = ['#e0a84a', '#5fb3e6', '#e3685a', '#86c47c', '#b58be0'];
/**
 * Gives a seat its peg colour; wraps round if there are more seats than colours.
 * @param {number} seat  Seat index.
 * @returns {string} A CSS colour.
 * Side effects: none.
 */
export const seatColour = (seat) => SEAT_COLOURS[seat % SEAT_COLOURS.length];
