// A standard 52-card deck, shared by every card game (server and client). A card is a short string: rank then suit,
// such as "QS" (queen of spades), "10H", "AC". Ranks run 2..10, J, Q, K, A; suits are C D H S.
// Games that use Jokers add the two in `JOKERS` ("JK1" black, "JK2" red) with `deckFor(true)`. A Joker belongs to no real
// suit (`suitOf` gives "J", which is none of SUITS) and ranks above the ace; what a Joker does in a trick is up to the game.
export const SUITS = ['C', 'D', 'H', 'S'];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const SUIT_NAMES = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };
export const SUIT_SYMBOLS = { C: '♣', D: '♦', H: '♥', S: '♠' };
const RANK_NAMES = { J: 'jack', Q: 'queen', K: 'king', A: 'ace' };

export const JOKERS = ['JK1', 'JK2'];
export const isJoker = (card) => card.startsWith('JK');
export const suitOf = (card) => (isJoker(card) ? 'J' : card.slice(-1));
export const rankOf = (card) => card.slice(0, -1);
/** 2..14 (ace high); a Joker is 15. */
export const rankValue = (card) => (isJoker(card) ? 15 : RANKS.indexOf(rankOf(card)) + 2);
export const isRed = (card) => card === 'JK2' || suitOf(card) === 'D' || suitOf(card) === 'H';
export const isCard = (value) => typeof value === 'string' && /^(?:[2-9]|10|[JQKA])[CDHS]$/.test(value);

export const cardName = (card) => (isJoker(card) ? `${isRed(card) ? 'red' : 'black'} joker` : `${RANK_NAMES[rankOf(card)] ?? rankOf(card)} of ${SUIT_NAMES[suitOf(card)]}`);

export function fullDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}`));
}

/** The 52 cards, plus the two Jokers when `jokers` is true. */
export const deckFor = (jokers) => (jokers ? [...fullDeck(), ...JOKERS] : fullDeck());

/** A shuffled copy (Fisher-Yates). Pass a seeded rng in tests. */
export function shuffle(cards, rng = Math.random) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Orders cards for a hand: the trump suit first if there is one, then hearts, spades, diamonds and clubs (the Jokers last),
 * each suit high to low, so that the highest card is at the left, at the back of the fan.
 */
const DISPLAY_SUITS = ['H', 'S', 'D', 'C', 'J'];
export function sortHand(cards, trump = null) {
  const order = trump ? [trump, ...DISPLAY_SUITS.filter((suit) => suit !== trump)] : DISPLAY_SUITS;
  return [...cards].sort((a, b) => order.indexOf(suitOf(a)) - order.indexOf(suitOf(b)) || rankValue(b) - rankValue(a) || a.localeCompare(b)); // only the Jokers tie
}
