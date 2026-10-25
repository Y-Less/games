// One peg colour per seat, shared by the board, the score chips and the lists.
export const SEAT_COLOURS = ['#e0a84a', '#5fb3e6', '#e3685a', '#86c47c'];
export const seatColour = (seat) => SEAT_COLOURS[seat % SEAT_COLOURS.length];
