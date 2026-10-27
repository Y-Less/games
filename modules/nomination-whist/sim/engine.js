// Plays one deal of Nomination Whist from the first nomination to the last trick, with computer players on every seat,
// and records what happened in a `Stats` (tables.js). It builds the same decision contexts the real game gives its AIs
// (`nominateContext` and `playContext` in ../game.js; sim.test.js checks they agree), so the real AIs can be used as they are.
//
// A deal is any combination of players, cards each and trump suit, not just the ones the 14-round schedule produces,
// so the tables cover every case.
import { shuffle, sortHand, suitOf, rankValue, SUITS } from '../../../shared/cards.js';
import { pickAI } from '../../../shared/ai.js';
import { AIS } from '../ai/index.js';
import { estimateTricks } from '../ai/standard.js';
import { forbiddenNomination, trickWinner } from '../game.js';
import { CARD_INDEX, DECK, ESTIMATE_BUCKETS, ESTIMATE_STEPS, MIN_PLAYERS, TRUMPS } from './tables.js';

const standard = AIS.find((ai) => ai.id === 'standard');
const byId = new Map(AIS.map((ai) => [ai.id, ai]));
const MAX_ROW = 7; // cards in a row of the hands file

/** Policies besides the AI ids: `contest` nominates like Standard but then every seat tries to win every trick. */
export const POLICIES = ['mix', 'contest', ...AIS.map((ai) => ai.id)];

/**
 * The AI for each seat of one deal. `policy` is a comma-separated list of AI ids (seat n uses entry n, repeating),
 * `mix` (each seat gets a random AI, by the game's own weights) or `contest` (see above).
 */
export function seatAIs(policy, players, rng) {
  const names = String(policy).split(',').map((s) => s.trim()).filter(Boolean);
  return Array.from({ length: players }, (_, seat) => {
    const name = names[seat % names.length];
    if (name === 'mix') return pickAI(AIS, rng);
    if (name === 'contest') return { nominate: standard.nominate, play: (ctx) => standard.play({ ...ctx, need: 99 }) };
    const ai = byId.get(name);
    if (!ai) throw new Error(`Unknown AI "${name}" (use one of ${POLICIES.join(', ')})`);
    return ai;
  });
}

const trumpKey = (trump) => TRUMPS.indexOf(trump ?? 'N');

function legalOf(hand, trick) {
  if (!trick.length) return hand;
  const led = suitOf(trick[0].card);
  const follow = hand.filter((card) => suitOf(card) === led);
  return follow.length ? follow : hand;
}

/**
 * Plays one deal and adds what it saw to `stats`.
 * @param {{ players: number, cards: number, trump: 'H'|'C'|'D'|'S'|'N', policy: string, instantWin?: boolean, missPoints?: boolean }} deal
 * @param {() => number} rng
 * @param {import('./tables.js').Stats} stats
 * @param {number[] | null} dump  when given, one row per hand is pushed to it (see README, "The hands file")
 */
export function playDeal({ players, cards, trump: trumpName, policy, instantWin = false, missPoints = true }, rng, stats, dump = null) {
  const trump = trumpName === 'N' ? null : trumpName;
  const ais = seatAIs(policy, players, rng);
  const dealer = Math.floor(rng() * players);
  const deck = shuffle(DECK, rng);
  const hands = Array.from({ length: players }, (_, seat) => sortHand(deck.slice(seat * cards, (seat + 1) * cards)));
  const start = hands.map((hand) => [...hand]);
  const roundInstant = instantWin && cards === 7;

  // Nominations: from the dealer's left round to the dealer, who may not make the total equal the tricks.
  const nominations = Array(players).fill(null);
  for (let i = 1; i <= players; i++) {
    const seat = (dealer + i) % players;
    const forbidden = seat === dealer ? forbiddenNomination(cards, nominations.reduce((sum, bid, s) => sum + (s === dealer ? 0 : bid ?? 0), 0)) : null;
    const allowed = Array.from({ length: cards + 1 }, (_, n) => n).filter((n) => n !== forbidden);
    const context = { hand: hands[seat], trump, players, allowed, instantWin: roundInstant, missPoints, seat, dealer, cards, nominations: [...nominations], rng };
    const number = ais[seat].nominate(context);
    nominations[seat] = allowed.includes(number) ? number : standard.nominate(context);
  }

  // The play.
  const taken = Array(players).fill(0);
  const played = [];
  const winners = new Set(); // the cards that won a trick
  let leader = (dealer + 1) % players;
  for (let t = 0; t < cards; t++) {
    const trick = [];
    const events = [];
    for (let k = 0; k < players; k++) {
      const seat = (leader + k) % players;
      const hand = hands[seat];
      const legal = legalOf(hand, trick);
      const context = {
        hand,
        legal,
        trick: trick.map((p) => p.card),
        trickPlays: trick.map((p) => ({ ...p })),
        trump,
        played: [...played],
        need: nominations[seat] - taken[seat],
        players,
        seat,
        nominations: [...nominations],
        taken: [...taken],
        handSizes: hands.map((h) => h.length),
        cards,
        instantWin: roundInstant,
        missPoints,
        rng,
      };
      let card = ais[seat].play(context);
      if (!legal.includes(card)) card = standard.play(context);
      const led = k === 0 ? null : suitOf(trick[0].card);
      const kind = k === 0 ? 0 : suitOf(card) === led ? 1 : trump && suitOf(card) === trump ? 2 : 3;
      events.push({ seat, card, cardsLeft: hand.length, position: k, kind });
      hands[seat] = hand.filter((c) => c !== card);
      trick.push({ seat, card });
      played.push(card);
    }
    const winner = trickWinner(trick, trump);
    taken[winner]++;
    for (const e of events) {
      if (e.seat === winner) winners.add(e.card);
      stats.add('play', [players - MIN_PLAYERS, trumpKey(trump), e.cardsLeft - 1, e.position, e.kind, CARD_INDEX.get(e.card)], e.seat === winner ? 1 : 0);
    }
    leader = winner;
  }

  // What each dealt hand and card turned out to be worth.
  const p = players - MIN_PLAYERS;
  const c = cards - 1;
  const tk = trumpKey(trump);
  for (let seat = 0; seat < players; seat++) {
    const hand = start[seat];
    const suitCount = Object.fromEntries(SUITS.map((suit) => [suit, hand.filter((card) => suitOf(card) === suit).length]));
    const voids = SUITS.filter((suit) => suitCount[suit] === 0).length;
    const trumpsHeld = trump ? suitCount[trump] : 0;
    for (const card of hand) {
      const won = winners.has(card) ? 1 : 0;
      const k = CARD_INDEX.get(card);
      const suit = suitOf(card);
      const higherHeld = hand.filter((o) => suitOf(o) === suit && rankValue(o) > rankValue(card)).length;
      stats.add('card', [p, c, tk, k], won);
      stats.add('cardSuit', [p, c, tk, k, suitCount[suit] - 1, higherHeld], won);
      stats.add('cardTrumps', [p, c, tk, k, trumpsHeld, Math.min(voids, 3)], won);
    }
    const estimate = Math.min(ESTIMATE_BUCKETS - 1, Math.round(estimateTricks(hand, trump, players) * ESTIMATE_STEPS));
    const seatOrder = (seat - dealer - 1 + players) % players;
    stats.add('hand', [p, c, tk, seatOrder, estimate, taken[seat]]);
    stats.add('bids', [p, c, tk, estimate, nominations[seat]], nominations[seat] === taken[seat] ? 1 : 0);
    if (dump) {
      dump.push(players, cards, tk, seatOrder, nominations[seat], taken[seat]);
      for (let i = 0; i < MAX_ROW; i++) dump.push(i < hand.length ? CARD_INDEX.get(hand[i]) : 255);
    }
  }
  stats.deals++;
}

export const DUMP_ROW_BYTES = 6 + MAX_ROW;
