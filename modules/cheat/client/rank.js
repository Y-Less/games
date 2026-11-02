// How card ranks are spoken in Cheat's text (the log and the Status box): as a message under the game's `rank.*` keys,
// whose plural forms give "an Ace" for one card and "Aces" for more (the article matters because an 8 and an Ace both
// take "an"). Used by log.js and Table.vue.
import { msg } from '../../../shared/messages.js';

/**
 * The spoken form of a rank, as a message for `text()` or a log line.
 * @param {string} rank  The rank: 'A', '2'..'10', 'J', 'Q' or 'K'.
 * @param {number} [count]  How many cards are claimed; 1 gives the singular with an article, anything else the plural (default 2).
 * @returns {{ key: string, params: { count: number } }} The message.
 * Side effects: none.
 */
export const rankMsg = (rank, count = 2) => msg(`rank.${rank}`, { count });
