// The small pieces of wording the Gaudi table shares between its components and composables. Pure functions: nothing
// here reads or changes any state.
import { COLOUR_NAMES } from '../rules.js';

/**
 * A colour's name for people ("Ruby"); an unknown colour is shown as it is.
 * @param {string} c  a colour key from rules.js
 * @returns {string}
 */
export const colourName = (c) => COLOUR_NAMES[c] ?? c;

/**
 * How your private colour is scored in this game (it depends on the bad private scoring setting).
 * @param {boolean} badPrivate  whether bad private scoring is on
 * @returns {string}
 */
export const privateRule = (badPrivate) =>
  badPrivate ? 'Bad private scoring is on: each of your private-colour dice is worth a flat 3, whatever it shows.' : 'Each die of this colour in your window scores its shade (pips).';

/**
 * What a tool card does, shown in Status while the pointer is on it.
 * @param {{ name: string, text: string, how: string }} tool  a tool card from the view
 * @returns {string}
 */
export const toolHint = (tool) => `${tool.name}: ${tool.text} How: ${tool.how}`;

/**
 * What an objective card asks for and what you have of it so far, shown in Status while the pointer is on it.
 * @param {object} o  a public objective from the view
 * @returns {string}
 */
export const objectiveHint = (o) => `${o.name}: ${o.text} ${o.points} per ${o.unit}.${o.mine ? ` You have ${o.mine.sets}: ${o.mine.points} points.` : ''}`;

/**
 * The place in the final table in words ("Winner", "2nd", "3rd", "4th").
 * @param {{ placement: number }} row  a row of the final table
 * @returns {string}
 */
export const rank = (row) => (row.placement === 1 ? 'Winner' : `${row.placement}th`.replace(/^2th/, '2nd').replace(/^3th/, '3rd'));
