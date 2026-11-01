// How card ranks are spoken in Cheat's text (the log and the Status box). Used by log.js and Table.vue.

// Names for the face ranks, as [singular, plural]; other ranks are numbers and just take an 's'.
const WORDS = { A: ['Ace', 'Aces'], J: ['Jack', 'Jacks'], Q: ['Queen', 'Queens'], K: ['King', 'Kings'] };

/**
 * Says a rank aloud: "Aces", "7s" (or, for one card, "an Ace", "a 7"). The article matters because an 8 and an Ace
 * both take "an".
 * @param {string} rank  The rank: 'A', '2'..'10', 'J', 'Q' or 'K'.
 * @param {number} [count]  How many cards are claimed; 1 gives the singular with an article, anything else the plural (default 2).
 * @returns {string} The spoken form of the rank.
 * Side effects: none.
 */
export function rankWord(rank, count = 2) {
  const [one, many] = WORDS[rank] ?? [rank, `${rank}s`];
  if (count !== 1) return many;
  return `${rank === 'A' || rank === '8' ? 'an' : 'a'} ${one}`;
}
