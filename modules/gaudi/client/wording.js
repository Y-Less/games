// The small pieces of wording the Gaudi table shares between its components and composables. Every one of them is built
// from the game's locale file, so each takes the caller's `t` (from useGameText) as its first argument; nothing here
// reads or changes any state.
import { ordinalText } from '../../../src/messageText.js';

/**
 * How your private colour is scored in this game (it depends on the bad private scoring setting).
 * @param {Function} t  the caller's translator
 * @param {boolean} badPrivate  whether bad private scoring is on
 * @returns {string} a sentence explaining the rule
 * Side effects: none.
 */
export const privateRule = (t, badPrivate) => t(badPrivate ? 'private.ruleBad' : 'private.ruleNormal');

/**
 * The short form of privateRule for the private objective card: what a die of your colour is worth.
 * @param {Function} t  the caller's translator
 * @param {boolean} badPrivate  whether bad private scoring is on
 * @returns {{ points: string, text: string }} the top-right line ("1 per pip" or "3 per die") and a one-line description
 * Side effects: none.
 */
export const privateSummary = (t, badPrivate) => ({
  points: t(badPrivate ? 'private.pointsBad' : 'private.pointsNormal'),
  text: t(badPrivate ? 'private.textBad' : 'private.textNormal'),
});

/**
 * What a tool card does, shown in Status while the pointer is on it.
 * @param {Function} t  the caller's translator
 * @param {{ id: string }} tool  a tool card from the view (its words come from its id)
 * @returns {string} one line: name, rule and how to use it
 * Side effects: none.
 */
export const toolHint = (t, tool) => t('hints.tool', { name: t(`tools.${tool.id}.name`), text: t(`tools.${tool.id}.text`), how: t(`tools.${tool.id}.how`) });

/**
 * What a public objective is worth, for the card's corner ("6 per row").
 * @param {Function} t  the caller's translator
 * @param {{ points: number, unit: string }} o  a public objective from the view
 * @returns {string} the rate
 * Side effects: none.
 */
export const objectiveRate = (t, o) => t('card.rate', { points: o.points, unit: t(`units.${o.unit}`) });

/**
 * What an objective card asks for and what you have of it so far, shown in Status while the pointer is on it.
 * @param {Function} t  the caller's translator
 * @param {object} o  a public objective from the view
 * @returns {string} one line: name, rule, points per set and (when present) your own count
 * Side effects: none.
 */
export const objectiveHint = (t, o) => {
  const about = { name: t(`objectives.${o.id}.name`), text: t(`objectives.${o.id}.text`), rate: objectiveRate(t, o) };
  return o.mine ? t('hints.objectiveMine', { ...about, sets: o.mine.sets, points: o.mine.points }) : t('hints.objective', about);
};

/**
 * The place in the final table in words ("Winner", "2nd", "3rd", "4th").
 * @param {Function} t  the caller's translator
 * @param {{ placement: number }} row  a row of the final table
 * @returns {string} the place as the language writes it
 * Side effects: none.
 */
export const rank = (t, row) => (row.placement === 1 ? t('final.rankWinner') : ordinalText(row.placement));
