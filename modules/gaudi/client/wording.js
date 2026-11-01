// The small pieces of wording the Gaudi table shares between its components and composables. Pure functions: nothing
// here reads or changes any state.
import { COLOUR_NAMES } from '../rules.js';

/**
 * A colour's name for people ("Ruby"); an unknown colour is shown as it is.
 * @param {string} c  a colour key from rules.js
 * @returns {string} the display name
 * Side effects: none.
 */
export const colourName = (c) => COLOUR_NAMES[c] ?? c;

/**
 * How your private colour is scored in this game (it depends on the bad private scoring setting).
 * @param {boolean} badPrivate  whether bad private scoring is on
 * @returns {string} a sentence explaining the rule
 * Side effects: none.
 */
export const privateRule = (badPrivate) =>
  badPrivate ? 'Bad private scoring is on: each of your private-colour dice is worth a flat 3, whatever it shows.' : 'Each die of this colour in your window scores its shade (pips).';

/**
 * The short form of privateRule for the private objective card: what a die of your colour is worth.
 * @param {boolean} badPrivate  whether bad private scoring is on
 * @returns {{ points: string, text: string }} the top-right line ("1 per pip" or "3 per die") and a one-line description
 * Side effects: none.
 */
export const privateSummary = (badPrivate) => ({
  points: badPrivate ? '3 per die' : '1 per pip',
  text: badPrivate ? 'Each die of your colour scores a flat 3.' : 'Each die of your colour scores its shade.',
});

/**
 * What a tool card does, shown in Status while the pointer is on it.
 * @param {{ name: string, text: string, how: string }} tool  a tool card from the view
 * @returns {string} one line: name, rule and how to use it
 * Side effects: none.
 */
export const toolHint = (tool) => `${tool.name}: ${tool.text} How: ${tool.how}`;

/**
 * What an objective card asks for and what you have of it so far, shown in Status while the pointer is on it.
 * @param {object} o  a public objective from the view
 * @returns {string} one line: name, rule, points per set and (when present) your own count
 * Side effects: none.
 */
export const objectiveHint = (o) => `${o.name}: ${o.text} ${o.points} per ${o.unit}.${o.mine ? ` You have ${o.mine.sets}: ${o.mine.points} points.` : ''}`;

/**
 * The place in the final table in words ("Winner", "2nd", "3rd", "4th").
 * @param {{ placement: number }} row  a row of the final table
 * @returns {string} the place in words (11th to 13th are not reachable with five players)
 * Side effects: none.
 */
export const rank = (row) => (row.placement === 1 ? 'Winner' : `${row.placement}th`.replace(/^2th/, '2nd').replace(/^3th/, '3rd'));
