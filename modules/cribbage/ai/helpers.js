// Shared building blocks for the cribbage AIs. Everything here is a pure function of plain data (cards such as "5H").
import { fullDeck } from '../../../shared/cards.js';
import { pipValue, scoreHand, scorePlay } from '../scoring.js';

/** Every way of keeping `hand.length - discardCount` cards: [{ keep, discards }]. */
export function splits(hand, discardCount) {
  const keepCount = hand.length - discardCount;
  const found = [];
  const walk = (start, chosen) => {
    if (chosen.length === keepCount) {
      found.push({ keep: chosen.map((i) => hand[i]), discards: hand.filter((_, i) => !chosen.includes(i)) });
      return;
    }
    for (let i = start; i < hand.length; i++) walk(i + 1, [...chosen, i]);
  };
  walk(0, []);
  return found;
}

/** The cards that could still turn up: the whole deck minus what is known. */
export const unseenFrom = (...known) => {
  const gone = new Set(known.flat());
  return fullDeck().filter((card) => !gone.has(card));
};

/** What a kept hand is worth on average over every starter that could be cut. */
export function averageHandScore(keep, unseen) {
  let sum = 0;
  for (const starter of unseen) sum += scoreHand(keep, starter).total;
  return sum / unseen.length;
}

/** A random element, or undefined for an empty list. */
export const sample = (list, rng) => list[Math.floor(rng() * list.length)];

/** A small deterministic generator, so an AI that samples still answers the same way for the same cards. */
export function hashedRng(text) {
  let a = 2166136261;
  for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 16777619) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The cards in a hand that can be played without taking the count over 31. */
export const legalPlays = (hand, count) => hand.filter((card) => count + pipValue(card) <= 31);

/**
 * Roughly what the next player might score in reply to `card`: opponents' cards are drawn from `unseen`, and the
 * opponent has `held` of them. Returns { reply, stuck }: the expected points of their best reply, and the chance they
 * have nothing playable at all (so the play ends and the last card earns a go).
 */
export function replyOutlook(sequence, card, unseen, held) {
  const after = [...sequence, card];
  const { count } = scorePlay(after);
  if (count >= 31 || held <= 0 || !unseen.length) return { reply: 0, stuck: count >= 31 ? 0 : 1 };
  const chance = Math.min(1, held / unseen.length);
  const replies = [];
  let illegal = 0;
  for (const other of unseen) {
    if (count + pipValue(other) > 31) illegal++;
    else replies.push(scorePlay([...after, other]).total);
  }
  replies.sort((a, b) => b - a);
  let reply = 0;
  let missed = 1;
  for (const points of replies) {
    reply += points * chance * missed;
    missed *= 1 - chance;
  }
  let stuck = 1;
  for (let i = 0; i < held; i++) stuck *= Math.max(0, illegal - i) / (unseen.length - i);
  return { reply, stuck };
}

/**
 * What the crib is worth on average with these discards in it: the other crib cards and the starter are dealt at random
 * from `unseen` (the cards this player cannot see), `samples` times.
 */
export function cribEstimate(discards, unseen, samples, rng) {
  const others = 4 - discards.length;
  let sum = 0;
  for (let n = 0; n < samples; n++) {
    const pool = [...unseen];
    const drawn = [];
    for (let i = 0; i < others + 1; i++) drawn.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    const starter = drawn.pop();
    sum += scoreHand([...discards, ...drawn], starter, { crib: true }).total;
  }
  return sum / samples;
}
