// The strongest: it samples the hands it cannot see, plays the rest of the round out many times, and picks the
// nomination (and later the card) with the best expected score.  Following suit, trumps, and the order of play are
// all handled by playing the round out with the real rules, so nothing is guessed.
import { suitOf } from '../../../shared/cards.js';
import { ledSuit, legalCards } from '../trick.js';
import { nearestAllowed, unseenCards, winningCard } from './cards.js';
import { withLastChance } from './endgame.js';
import { canTakeAllSeven, chooseCard, estimateTricks } from './standard.js';

// Monte Carlo sizes: how many random deals of the unseen cards are played out per decision.  More is sharper but slower;
// a nomination weighs several candidates once per deal, so it gets fewer samples than a card play.
const NOMINATE_SAMPLES = 36;
const PLAY_SAMPLES = 40;
// Stands in for winning the game outright when a made 7 with a 7-card hand ends it: far more than any round could score.
const INSTANT_WIN_BONUS = 60;
/** The card the standard rule would play gets this much benefit of the doubt, so sampling noise cannot talk it out of it. */
const STANDARD_BIAS = 0.25;

/**
 * What a round is worth to one player: 10 plus the nomination for a hit, otherwise the tricks taken (if misses score).
 *
 * @param {number} bid  the nomination
 * @param {number} taken  the tricks won
 * @param {object} [options]
 * @param {boolean} [options.missPoints=true]  whether a miss still scores the tricks taken
 * @param {boolean} [options.instantWin=false]  whether a made 7 on a full hand wins the game
 * @param {number} [options.cards=0]  the hand size this round
 * @returns {number} the points, with INSTANT_WIN_BONUS added for an instant win
 * Side effects: none.
 */
export function roundPoints(bid, taken, { missPoints = true, instantWin = false, cards = 0 } = {}) {
  const base = bid === taken ? 10 + bid : missPoints ? taken : 0;
  return base + (instantWin && bid === 7 && taken === 7 && cards === 7 ? INSTANT_WIN_BONUS : 0);
}

/**
 * Deals the unseen cards at random to the other seats: `needs` is [{ seat, count, voids }], where `voids` lists suits
 * the seat is known not to hold.  Falls back to ignoring voids if they cannot be satisfied.
 *
 * @param {string[]} unseen  the cards the player cannot see
 * @param {{seat: number, count: number, voids: string[]}[]} needs  the other seats, how many cards each holds and the suits each lacks
 * @param {() => number} rng  random source returning [0, 1)
 * @returns {Object<number, string[]>} the dealt hand for each seat
 * Side effects: advances rng.
 */
export function dealUnseen(unseen, needs, rng) {
  for (const respect of [true, false]) {
    const pool = [...unseen];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const hands = Object.fromEntries(needs.map((n) => [n.seat, []]));
    // Cards of a suit somebody is void in go first, to the seats that can take them.
    const voidSuits = new Set(respect ? needs.flatMap((n) => n.voids) : []);
    const ordered = [...pool.filter((c) => voidSuits.has(suitOf(c))), ...pool.filter((c) => !voidSuits.has(suitOf(c)))];
    let done = false;
    for (const card of ordered) {
      const open = needs.filter((n) => hands[n.seat].length < n.count && !(respect && n.voids.includes(suitOf(card))));
      if (needs.every((n) => hands[n.seat].length >= n.count)) {
        done = true;
        break;
      }
      if (!open.length) continue; // nobody can take this card: it stays in the undealt part of the deck
      // Weight by room left, so the seats fill evenly.
      const total = open.reduce((sum, n) => sum + n.count - hands[n.seat].length, 0);
      let roll = rng() * total;
      let chosen = open[open.length - 1];
      for (const n of open) {
        roll -= n.count - hands[n.seat].length;
        if (roll < 0) {
          chosen = n;
          break;
        }
      }
      hands[chosen.seat].push(card);
    }
    if (done || needs.every((n) => hands[n.seat].length === n.count)) return hands;
  }
  let at = 0;
  return Object.fromEntries(needs.map((n) => [n.seat, unseen.slice(at, (at += n.count))]));
}

// The legal cards for a hand given the plays (seat and card) on the table so far.
const legalFrom = (hand, trick) => legalCards(hand, trick.map((p) => p.card));

// The seat that wins a trick given its plays in order.
const winnerOf = (plays, trump) => {
  const best = winningCard(plays.map((p) => p.card), trump);
  return plays.find((p) => p.card === best).seat;
};

/**
 * Plays a round out from where it stands, every seat using the standard rule; returns the tricks each seat took.
 *
 * @param {object} state  the round as far as the sampling knows it
 * @param {string[][]} state.hands  every seat's remaining cards (not mutated)
 * @param {{seat: number, card: string}[]} state.trick  the plays already on the table
 * @param {number} state.turn  the seat to play next
 * @param {number[]} state.taken  the tricks each seat has won so far
 * @param {number[]} state.bids  every seat's nomination
 * @param {string | null} state.trump  the trump suit, or null
 * @param {number} state.players  the number of players
 * @param {string[]} state.played  the cards already played this round
 * @param {boolean} [state.jokers=false]  whether the Jokers are in the pack
 * @returns {number[]} the tricks each seat finishes with
 * Side effects: none (works on copies).
 */
export function playOut({ hands, trick, turn, taken, bids, trump, players, played, jokers = false }) {
  const hand = hands.map((h) => [...h]);
  const won = [...taken];
  const seen = [...played];
  let current = [...trick];
  let seat = turn;
  for (;;) {
    if (current.length === players) {
      const winner = winnerOf(current, trump);
      won[winner]++;
      current = [];
      seat = winner;
    }
    if (!hand[seat].length) break;
    const legal = legalFrom(hand[seat], current);
    const card = legal.length === 1 ? legal[0] : chooseCard({ hand: hand[seat], legal, trick: current.map((p) => p.card), trump, played: seen, need: bids[seat] - won[seat], players, jokers });
    hand[seat] = hand[seat].filter((c) => c !== card);
    current.push({ seat, card });
    seen.push(card);
    seat = (seat + 1) % players;
  }
  return won;
}

// Limits n to the range low..high.
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

/**
 * The suits each seat has shown it does not hold, from the trick in progress.
 *
 * @param {{seat: number, card: string}[]} trickPlays  the plays on the table so far
 * @returns {Object<number, string[]>} for each seat that failed to follow, the suit that was led
 * Side effects: none.
 */
function knownVoids(trickPlays) {
  const voids = {};
  const led = ledSuit(trickPlays.map((p) => p.card));
  if (led === null) return voids; // nothing led, or a Joker: no suit was followed or refused
  for (const { seat, card } of trickPlays) if (suitOf(card) !== led) voids[seat] = [led];
  return voids;
}

// The index of the largest value (the first, on a tie).
const bestIndex = (values) => values.reduce((best, value, i) => (value > values[best] ? i : best), 0);

/**
 * The nomination with the best average score over many deals of the unseen cards, among those near the hand's estimate (`centre`).
 * Candidates further than 2.2 from the estimate are ignored (they are never good and cost samples); 0 is always kept as a safe option.
 * The other seats' nominations are taken from `nominations` where already made, otherwise guessed from the standard estimate.
 *
 * @param {object} ctx  nomination context: hand, trump, players, allowed, instantWin, jokers, rng, seat, dealer, nominations, missPoints
 * @param {number} centre  the hand's estimated tricks
 * @returns {number} the nomination, always one of ctx.allowed
 * Side effects: advances ctx.rng.
 */
function sampledNomination({ hand, trump, players, allowed, instantWin = false, jokers = false, rng, seat = 0, dealer = 0, nominations = [], missPoints = true }, centre) {
  const cards = hand.length;
  const candidates = allowed.filter((n) => Math.abs(n - centre) <= 2.2 || n === 0);
  if (candidates.length <= 1) return candidates[0] ?? nearestAllowed(allowed, centre);
  const unseen = unseenCards(hand, [], jokers);
  const others = Array.from({ length: players }, (_, s) => s).filter((s) => s !== seat);
  const totals = candidates.map(() => 0);
  for (let n = 0; n < NOMINATE_SAMPLES; n++) {
    const dealt = dealUnseen(unseen, others.map((s) => ({ seat: s, count: cards, voids: [] })), rng);
    const hands = Array.from({ length: players }, (_, s) => (s === seat ? hand : dealt[s]));
    const bids = hands.map((h, s) => nominations[s] ?? clamp(Math.round(estimateTricks(h, trump, players)), 0, cards));
    candidates.forEach((candidate, i) => {
      const taken = playOut({ hands, trick: [], turn: (dealer + 1) % players, taken: Array(players).fill(0), bids: bids.map((b, s) => (s === seat ? candidate : b)), trump, players, played: [], jokers });
      totals[i] += roundPoints(candidate, taken[seat], { missPoints, instantWin, cards });
    });
  }
  return candidates[bestIndex(totals)];
}

/** The sharp AI: Monte Carlo simulation of the rest of the round, with the standard rule playing every other seat. */
export const sharp = {
  id: 'sharp',
  name: 'Sharp',
  description: 'Simulates the rest of the round many times to pick the nomination and the card with the best expected score.',
  weight: 1.5,

  /**
   * Nominates 7 when it can clearly take every trick (instant win), the boosted estimate when only a 7 can win, and otherwise the
   * sampled best.
   *
   * @param {object} ctx  nomination context (see sampledNomination, plus the endgame fields)
   * @returns {number} the nomination, always one of ctx.allowed
   * Side effects: advances ctx.rng.
   */
  nominate(ctx) {
    const { hand, trump, players, allowed, instantWin = false } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    return withLastChance(ctx, (boost) => {
      const centre = estimateTricks(hand, trump, players, boost);
      // nothing to lose and only an instant win can win: read the hand at its boosted weight, which is all there is to say
      return boost ? nearestAllowed(allowed, centre) : sampledNomination(ctx, centre);
    });
  },

  /**
   * Plays the legal card with the best average score over many sampled deals of the unseen cards (respecting voids shown
   * so far), giving the standard rule's card a small bias so sampling noise cannot talk it out of a sound play.
   *
   * @param {object} ctx  play context: hand, legal, trump, played, players, rng, seat, nominations, taken, handSizes,
   *   trickPlays, missPoints, instantWin, jokers, cards, plus what chooseCard needs
   * @returns {string} the card to play
   * Side effects: advances ctx.rng.
   */
  play(ctx) {
    const { hand, legal, trump, played, players, rng, seat = 0, nominations, taken, handSizes, trickPlays = [], missPoints = true, instantWin = false, jokers = false, cards } = ctx;
    if (legal.length === 1) return legal[0];
    const bids = nominations;
    const unseen = unseenCards(hand, played, jokers);
    const voids = knownVoids(trickPlays);
    const others = Array.from({ length: players }, (_, s) => s).filter((s) => s !== seat);
    const preferred = chooseCard(ctx);
    const totals = legal.map(() => 0);
    for (let n = 0; n < PLAY_SAMPLES; n++) {
      const dealt = dealUnseen(unseen, others.map((s) => ({ seat: s, count: handSizes[s], voids: voids[s] ?? [] })), rng);
      legal.forEach((card, i) => {
        const hands = Array.from({ length: players }, (_, s) => (s === seat ? hand.filter((c) => c !== card) : dealt[s]));
        const result = playOut({ hands, trick: [...trickPlays, { seat, card }], turn: (seat + 1) % players, taken, bids, trump, players, played: [...played, card], jokers });
        totals[i] += roundPoints(bids[seat], result[seat], { missPoints, instantWin, cards });
      });
    }
    return legal[bestIndex(legal.map((card, i) => totals[i] / PLAY_SAMPLES + (card === preferred ? STANDARD_BIAS : 0)))];
  },
};
