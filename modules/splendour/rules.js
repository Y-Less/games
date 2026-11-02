// The pure rules constants and helpers of Splendour, in one place. game.js (the rules), ai/lib.js and ai/sharp.js (the
// computer players), kit.js / playkit.js / sim/ (the test and benchmark helpers) and client/Table.vue all used to carry
// their own copy of the numbers below and of the "what does this card cost me after my discounts" calculation; they now
// all import it from here.
//
// This file is plain JavaScript with no imports and no node-only code, so the browser client can import it too.
//
// Tokens are arrays of six counts: Diamond, Sapphire, Emerald, Ruby, Onyx, then Gold (index GOLD).  Bonuses (the discounts
// from bought cards) are arrays of five counts, one per gem colour.

/** The number of gem colours (Gold is not one of them). */
const COLOUR_COUNT = 5;
/** The index of Gold in a token array (five colours, then gold). */
export const GOLD = 5;
/** How many kinds of token there are: the five colours and Gold. */
export const TOKEN_KINDS = 6;

/** The most tokens a player may hold at the end of a turn. */
export const MAX_TOKENS = 10;
/** The most cards a player may keep in reserve. */
export const MAX_RESERVED = 3;
/** The prestige every noble tile is worth. */
export const NOBLE_POINTS = 3;
/** How many Gold tokens the table starts with, whatever the number of players. */
export const GOLD_SUPPLY = 5;
/** How many tokens of each gem colour the table starts with, by number of players. */
export const SUPPLY_PER_COLOUR = Object.freeze({ 2: 4, 3: 5, 4: 7 });

/**
 * How many tokens of each gem colour the table starts with.
 *
 * Side effects: none.
 *
 * @param {number} players  2, 3 or 4
 * @returns {number | undefined} undefined for any other number of players
 */
export const supplyPerColour = (players) => SUPPLY_PER_COLOUR[players];

/**
 * What a card costs a player after their discounts: each colour's cost less the number of bought cards of that colour,
 * never below zero.
 *
 * Side effects: none.
 *
 * @param {{ cost: number[] }} card  a card from cards.js
 * @param {number[]} bonuses         the player's five discounts
 * @returns {number[]} five counts
 */
export const needOf = (card, bonuses) => card.cost.map((c, i) => Math.max(0, c - bonuses[i]));

/**
 * What buying a card would take: the colours' tokens are spent first and Gold covers whatever is still short.
 *
 * Side effects: none.
 *
 * @param {number[]} tokens   the player's six token counts
 * @param {number[]} bonuses  the player's five discounts
 * @param {{ cost: number[] }} card
 * @returns {{ need: number[], pay: number[] } | null} `need` is the cost after discounts (five counts); `pay` is the
 *   default payment (six counts, Gold last). null if the card cannot be afforded.  Mutates nothing.
 */
export function quoteFor(tokens, bonuses, card) {
  const need = needOf(card, bonuses);
  const pay = [0, 0, 0, 0, 0, 0];
  let short = 0;
  for (let c = 0; c < COLOUR_COUNT; c++) {
    pay[c] = Math.min(need[c], tokens[c]);
    short += need[c] - pay[c];
  }
  if (short > tokens[GOLD]) return null;
  pay[GOLD] = short;
  return { need, pay };
}
