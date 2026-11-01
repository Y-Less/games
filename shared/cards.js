// A standard 52-card deck, shared by every card game (server and client). A card is a short string: rank then suit,
// such as "QS" (queen of spades), "10H", "AC". Ranks run 2..10, J, Q, K, A; suits are C D H S.
// Games that use Jokers add the two in `JOKERS` ("JK1" black, "JK2" red) with `deckFor(true)`. A Joker belongs to no real
// suit (`suitOf` gives "J", which is none of SUITS) and ranks above the ace; what a Joker does in a trick is up to the game.
// Depends on: nothing (pure, no imports).
export const SUITS = ['C', 'D', 'H', 'S'];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Lower-case suit names and Unicode suit symbols, keyed by suit letter, for text and labels.
export const SUIT_NAMES = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };
export const SUIT_SYMBOLS = { C: '♣', D: '♦', H: '♥', S: '♠' };
// Spoken names of the face ranks; number ranks are just their digits.
const RANK_NAMES = { J: 'jack', Q: 'queen', K: 'king', A: 'ace' };

export const JOKERS = ['JK1', 'JK2'];
// True when `card` is one of the two Jokers (ids start "JK").
export const isJoker = (card) => card.startsWith('JK');
// Returns the suit letter C/D/H/S of a card, or 'J' for a Joker.
export const suitOf = (card) => (isJoker(card) ? 'J' : card.slice(-1));
// Returns a card's rank string ("2".."10", J, Q, K, A) by dropping the suit letter; a Joker gives "JK".
export const rankOf = (card) => card.slice(0, -1);
/**
 * Hand display order: the trump suit first if there is one, then hearts, spades, diamonds and clubs (the Jokers last),
 * each suit high to low, so that the highest card is at the left, at the back of the fan.
 * @param {string[]} cards  the hand to order
 * @param {string|null} [trump]  suit letter to put first, or null for the default order
 * @returns {string[]} a new sorted array (the input is not changed)
 * Side effects: none.
 */
export const rankValue = (card) => (isJoker(card) ? 15 : RANKS.indexOf(rankOf(card)) + 2);
// True for hearts, diamonds and the red Joker (JK2).
export const isRed = (card) => card === 'JK2' || suitOf(card) === 'D' || suitOf(card) === 'H';
// True when `value` is a string naming a real (non-Joker) card such as "10H"; used to validate client input.
export const isCard = (value) => typeof value === 'string' && /^(?:[2-9]|10|[JQKA])[CDHS]$/.test(value);

// Returns a readable name such as "queen of spades" or "red joker".
export const cardName = (card) => (isJoker(card) ? `${isRed(card) ? 'red' : 'black'} joker` : `${RANK_NAMES[rankOf(card)] ?? rankOf(card)} of ${SUIT_NAMES[suitOf(card)]}`);

/**
 * Builds the standard 52-card deck in suit-then-rank order.
 * @returns {string[]} 52 card strings, unshuffled
 * Side effects: none.
 */
export function fullDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}`));
}

// Returns the 52-card deck, plus the two Jokers when `jokers` is true (unshuffled).
/** The 52 cards, plus the two Jokers when `jokers` is true. */
export const deckFor = (jokers) => (jokers ? [...fullDeck(), ...JOKERS] : fullDeck());

/**
 * Returns a shuffled copy using Fisher-Yates, so the input is never mutated.
 * @param {string[]} cards  the cards to shuffle
 * @param {() => number} rng  random source returning a number in [0, 1); pass a seeded one in tests
 * @returns {string[]} a new array with the same cards in random order
 * Side effects: none beyond advancing `rng`.
 */
export function shuffle(cards, rng) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Default left-to-right suit order for a displayed hand ('J' stands for the Jokers).
const DISPLAY_SUITS = ['H', 'S', 'D', 'C', 'J'];
/**
 * Orders cards for a hand: the trump suit first if there is one, then hearts, spades, diamonds and clubs (the Jokers last),
 * each suit high to low, so that the highest card is at the left, at the back of the fan.
 * @param {string[]} cards  the hand to order
 * @param {string|null} [trump]  suit letter to put first, or null for the default order
 * @returns {string[]} a new sorted array (the input is not changed)
 * Side effects: none.
 */
export function sortHand(cards, trump = null) {
  const order = trump ? [trump, ...DISPLAY_SUITS.filter((suit) => suit !== trump)] : DISPLAY_SUITS;
  return [...cards].sort((a, b) => order.indexOf(suitOf(a)) - order.indexOf(suitOf(b)) || rankValue(b) - rankValue(a) || a.localeCompare(b)); // only the Jokers tie
}
