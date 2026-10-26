// The font size of the Splendour table. Everything in it is sized in em, so one number scales the whole table: it is the
// largest font size at which the market (nobles in columns 1-2, cards in 3-8, your board with the supply in 9-12) each fit the width
// of their columns on the frame's grid and the market fits the height. It depends only on the room the frame gives the
// table, never on the game, so nothing grows or shrinks while playing. The design sizes are in em.
export const DESIGN = { nobles: 12.2, cards: 31, mine: 25.5, height: 29.5 };
export const SPANS = { nobles: 2, cards: 6, mine: 4 }; // about 17%, 50% and 33%: the nobles only need their two-column grid at card scale

const clamp = (low, value, high) => Math.max(low, Math.min(high, value));

/** The pixel width of `n` of the frame's columns, for an area as the frame passes it to its slots. */
const spanWidth = (area, n) => {
  const unit = (area.width - area.gap * (area.columns - 1)) / area.columns;
  return unit * n + area.gap * (n - 1);
};

/** The table's font size in px (to one decimal place, rounded down so nothing overflows). */
export function fontSize(area) {
  const fit = Math.min(
    area.height / DESIGN.height,
    spanWidth(area, SPANS.nobles) / DESIGN.nobles,
    spanWidth(area, SPANS.cards) / DESIGN.cards,
    spanWidth(area, SPANS.mine) / DESIGN.mine,
  );
  return Math.floor(clamp(9, fit, 24) * 10) / 10;
}

/** A size of `em` ems at this area's font size, in whole px (for the gems, which are drawn at a size in px). */
export const px = (area, em) => Math.round(fontSize(area) * em);
