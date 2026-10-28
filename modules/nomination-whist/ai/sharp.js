// The strongest: it samples the hands it cannot see, plays the rest of the round out many times, and picks the
// nomination (and later the card) with the best expected score. Following suit, trumps and the order of play are
// all handled by playing the round out with the real rules, so nothing is guessed.
import { suitOf } from '../../../shared/cards.js';
import { ledSuit, legalCards } from '../trick.js';
import { nearestAllowed, unseenCards, winningCard } from './cards.js';
import { lastChanceBoost } from './endgame.js';
import { canTakeAllSeven, chooseCard, estimateTricks } from './standard.js';

const NOMINATE_SAMPLES = 36;
const PLAY_SAMPLES = 40;
const INSTANT_WIN_BONUS = 60;
/** The card the standard rule would play gets this much benefit of the doubt, so sampling noise cannot talk it out of it. */
const STANDARD_BIAS = 0.25;

/** What a round is worth to one player. */
export function roundPoints(bid, taken, { missPoints = true, instantWin = false, cards = 0 } = {}) {
  const base = bid === taken ? 10 + bid : missPoints ? taken : 0;
  return base + (instantWin && bid === 7 && taken === 7 && cards === 7 ? INSTANT_WIN_BONUS : 0);
}

/**
 * Deals the unseen cards at random to the other seats: `needs` is [{ seat, count, voids }], where `voids` lists suits
 * the seat is known not to hold. Falls back to ignoring voids if they cannot be satisfied.
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

const legalFrom = (hand, trick) => legalCards(hand, trick.map((p) => p.card));

const winnerOf = (plays, trump) => {
  const best = winningCard(plays.map((p) => p.card), trump);
  return plays.find((p) => p.card === best).seat;
};

/** Plays a round out from where it stands, every seat using the standard rule; returns the tricks each seat took. */
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

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

/** The suits each seat has shown it does not hold, from the trick in progress. */
function knownVoids(trickPlays) {
  const voids = {};
  const led = ledSuit(trickPlays.map((p) => p.card));
  if (led === null) return voids; // nothing led, or a Joker: no suit was followed or refused
  for (const { seat, card } of trickPlays) if (suitOf(card) !== led) voids[seat] = [led];
  return voids;
}

const bestIndex = (values) => values.reduce((best, value, i) => (value > values[best] ? i : best), 0);

export const sharp = {
  id: 'sharp',
  name: 'Sharp',
  description: 'Simulates the rest of the round many times to pick the nomination and the card with the best expected score.',
  weight: 1.5,

  nominate(ctx) {
    const { hand, trump, players, allowed, instantWin = false, jokers = false, rng = Math.random, seat = 0, dealer = 0, nominations = [], missPoints = true } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    const cards = hand.length;
    const boost = lastChanceBoost(ctx);
    const centre = estimateTricks(hand, trump, players, boost);
    // nothing to lose and only an instant win can win: read the hand at its boosted weight, which is all there is to say
    if (boost) return nearestAllowed(allowed, centre);
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
  },

  play(ctx) {
    const { hand, legal, trump, played, players, rng = Math.random, seat = 0, nominations, taken, handSizes, trickPlays = [], missPoints = true, instantWin = false, jokers = false, cards } = ctx;
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
