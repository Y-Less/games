// A standard 52-card deck, shared by every card game (server and client).  A card is a short string: rank then suit,
// such as "QS" (queen of spades), "10H", "AC".  Ranks run 2..10, J, Q, K, A; suits are C D H S.
// Games that use Jokers add the two in `JOKERS` ("JK1" black, "JK2" red) with `deckFor(true)`.  A Joker belongs to no real
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
// How high a card counts, 2 low to 14 for an ace, and 15 for either Joker.  (This had sortHand's documentation on it
// by mistake, describing parameters it does not have; sortHand's own copy is still where it belongs, further down.)
export const rankValue = (card) => (isJoker(card) ? 15 : RANKS.indexOf(rankOf(card)) + 2);
// True for hearts, diamonds, and the red Joker (JK2).
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
 * The ways a player may have their hand laid out, which is a profile setting of theirs (server/profile.js) and not
 * anything a game decides.  'highLow' is what every hand has always been and what everybody starts with; the other
 * two are behind a shop unlock.
 */
export const CARD_ORDERS = ['highLow', 'lowHigh', 'random'];
export const DEFAULT_CARD_ORDER = 'highLow';
/** The shop unlock that lets somebody choose any of them but the default (server/shop.js). */
export const CARD_ORDER_ITEM = 'card-order';
/** True when `value` names one of them. */
export const isCardOrder = (value) => CARD_ORDERS.includes(value);

/**
 * A number between 0 and 1 for a string, the same one every time.  (FNV-1a: short, has no state, and spreads the
 * card ids well enough that a hand of thirteen does not come out in anything like rank order.)
 * @param {string} text
 * @returns {number}
 * Side effects: none.
 */
function hashed(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}

/**
 * Orders cards for a hand, the way the player has asked for them.
 *
 * - `highLow` (the default): the trump suit first if there is one, then hearts, spades, diamonds, and clubs (the
 *   Jokers last), each suit high to low, so the highest card is at the left, at the back of the fan.
 * - `lowHigh`: the same suits in the same places, each one turned round.
 * - `random`: no suits and no ranks, each card in a place of its own that it keeps.  The place comes from the card's
 *   name and the `salt`, so a hand looks shuffled but never *re*-shuffles: drawing a card slots it in somewhere and
 *   moves nothing else, and playing one closes the gap.  A hand that leapt about every time it changed would be
 *   unplayable, which is the whole difficulty with this option and the reason it is not simply `shuffle`.
 *
 * @param {object} [options]
 * @param {string} [options.order]  one of CARD_ORDERS (anything else is taken as the default)
 * @param {string|null} [options.trump]  suit letter to put first, or null for the plain order
 * @param {string} [options.salt]  makes `random` differ from table to table; the room's code does nicely
 * @returns {(a: string, b: string) => number} a comparator; two of the same card always tie, so a stable sort leaves
 *   duplicates (Cheat deals several packs) in the order they came in, and a hand can be drawn by position
 * Side effects: none.
 */
export function handComparator({ order = DEFAULT_CARD_ORDER, trump = null, salt = '' } = {}) {
  if (order === 'random') return (a, b) => hashed(a + salt) - hashed(b + salt) || a.localeCompare(b);
  const suits = trump ? [trump, ...DISPLAY_SUITS.filter((suit) => suit !== trump)] : DISPLAY_SUITS;
  const within = order === 'lowHigh' ? (a, b) => rankValue(a) - rankValue(b) : (a, b) => rankValue(b) - rankValue(a);
  return (a, b) => suits.indexOf(suitOf(a)) - suits.indexOf(suitOf(b)) || within(a, b) || a.localeCompare(b); // only the Jokers tie
}

/**
 * The hand itself, in that order.
 * @param {string[]} cards  the hand to order
 * @param {{ order?: string, trump?: string | null, salt?: string }} [options]  as handComparator
 * @returns {string[]} a new array (the input is not changed)
 * Side effects: none.
 */
export const orderHand = (cards, options) => [...cards].sort(handComparator(options));

/**
 * The hand in the order every game has always dealt it: high to low (see orderHand).  This is what a game's own rules
 * store, which is the same for everybody at the table; how one player is *shown* their hand is their own business and
 * happens in the client (src/cardOrder.js).
 * @param {string[]} cards  the hand to order
 * @param {string|null} [trump]  suit letter to put first, or null for the default order
 * @returns {string[]} a new sorted array (the input is not changed)
 * Side effects: none.
 */
export const sortHand = (cards, trump = null) => orderHand(cards, { trump });
