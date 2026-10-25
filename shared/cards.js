// A standard 52-card deck, shared by every card game (server and client). A card is a short string: rank then suit,
// such as "QS" (queen of spades), "10H", "AC". Ranks run 2..10, J, Q, K, A; suits are C D H S.
export const SUITS = ['C', 'D', 'H', 'S'];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const SUIT_NAMES = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };
export const SUIT_SYMBOLS = { C: '♣', D: '♦', H: '♥', S: '♠' };
const RANK_NAMES = { J: 'jack', Q: 'queen', K: 'king', A: 'ace' };

export const suitOf = (card) => card.slice(-1);
export const rankOf = (card) => card.slice(0, -1);
/** 2..14 (ace high). */
export const rankValue = (card) => RANKS.indexOf(rankOf(card)) + 2;
export const isRed = (card) => suitOf(card) === 'D' || suitOf(card) === 'H';
export const isCard = (value) => typeof value === 'string' && /^(?:[2-9]|10|[JQKA])[CDHS]$/.test(value);

export const cardName = (card) => `${RANK_NAMES[rankOf(card)] ?? rankOf(card)} of ${SUIT_NAMES[suitOf(card)]}`;

export function fullDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}`));
}

/** A shuffled copy (Fisher-Yates). Pass a seeded rng in tests. */
export function shuffle(cards, rng = Math.random) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** Orders cards for a hand: suits grouped (clubs, diamonds, spades, hearts alternate colours), high to low. */
const DISPLAY_SUITS = ['C', 'D', 'S', 'H'];
export function sortHand(cards) {
  return [...cards].sort((a, b) => DISPLAY_SUITS.indexOf(suitOf(a)) - DISPLAY_SUITS.indexOf(suitOf(b)) || rankValue(a) - rankValue(b));
}
