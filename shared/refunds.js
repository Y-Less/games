// Refund requests: the shop sells an unlock called "Refunds", and whoever owns it may write to customer support about
// an item they would like their Gilders back for.  The only rule is how long the writing has to be, and it lives here
// so that the page's live word count and the server's check cannot drift apart.
// Depends on: nothing (pure rules); used by the refund page, server/refunds.js and server/shop.js.

/** The shop item that opens the refund page. */
export const REFUND_ITEM = 'refunds';
/** The fewest words a refund request may hold. */
export const REFUND_MINIMUM_WORDS = 100;
/**
 * The most characters one may hold.  It is far more than the minimum needs in any language, and it is what the route's
 * body limit is sized for, so anything this check lets through can actually be sent.
 */
export const REFUND_MAXIMUM_CHARACTERS = 20000;

/**
 * How many words a piece of writing holds: runs of anything that is not a space, which is what "100 words" means to
 * the person counting them in a word processor.
 * @param {unknown} text  what was written (anything else counts as nothing written)
 * @returns {number}
 * Side effects: none.
 */
export function countWords(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}
