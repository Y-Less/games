// Where each opponent's face-down hand goes at a card table, by the number of opponents (see OpponentHands.vue). The
// opponents are numbered clockwise from you (the player after you is 0). Left is listed bottom to top, the top row left
// to right, and right top to bottom, which is clockwise round the table.
export const OPPONENT_LAYOUTS = {
  1: { left: [], top: [0], right: [] },
  2: { left: [0], top: [], right: [1] },
  3: { left: [0], top: [1], right: [2] },
  4: { left: [0, 1], top: [], right: [2, 3] },
  5: { left: [0, 1], top: [2], right: [3, 4] },
  6: { left: [0, 1], top: [2, 3], right: [4, 5] },
};
export const MAX_OPPONENTS = 6;
