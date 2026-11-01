// A pegging specialist: counts the cards still out, plays to leave no easy fifteen, pair or run, and chases go and 31.
// Depends on ../scoring.js, ./greedy.js (its discard) and ./helpers.js. Also exports peggingValues, which sharp.js tunes.
import { pipValue, scorePlay } from '../scoring.js';
import { greedy } from './greedy.js';
import { replyOutlook, unseenFrom } from './helpers.js';

/**
 * Scores each playable card: points now, plus the go it may earn, minus what the next player may score back.
 * The small pip terms are tie-breakers: lead low (keep big cards safe from an easy reply), follow high.
 *
 * @param {object} ctx  the play context from the game, plus optional weights
 * @param {string[]} ctx.hand  the cards still held
 * @param {number} ctx.count  the running count
 * @param {string[]} ctx.sequence  the cards played since the count last reset
 * @param {string[]} [ctx.played=[]]  every card played this deal (known, so not in anyone's hand)
 * @param {string|null} [ctx.starter=null]  the starter card
 * @param {number[]} [ctx.cardsLeft=[]]  cards each seat still holds
 * @param {number} [ctx.me=0]  this player's seat
 * @param {number} [ctx.players=2]  table size
 * @param {number} [ctx.goBonus=1]  value of making the next player unable to play
 * @param {number} [ctx.pointsWeight=1]  multiplier on points scored now
 * @param {number} [ctx.dangerWeight=1]  multiplier on the expected reply
 * @returns {{ card: string, value: number, total: number, reply: number }[]} one entry per playable card
 * Side effects: none.
 */
export function peggingValues({ hand, count, sequence, played = [], starter = null, cardsLeft = [], me = 0, players = 2, goBonus = 1, pointsWeight = 1, dangerWeight = 1 }) {
  const unseen = unseenFrom(hand, played, starter ? [starter] : []);
  // Only the next seat that still holds cards can reply, so that is the opponent to fear.
  const next = Array.from({ length: players - 1 }, (_, k) => (me + 1 + k) % players).find((seat) => (cardsLeft[seat] ?? 1) > 0);
  const held = next === undefined ? 0 : (cardsLeft[next] ?? Math.min(4, unseen.length));
  const values = [];
  for (const card of hand) {
    if (count + pipValue(card) > 31) continue;
    const { total, count: after } = scorePlay([...sequence, card]);
    const { reply, stuck } = replyOutlook(sequence, card, unseen, held);
    const value = total * pointsWeight - reply * dangerWeight + (after < 31 ? stuck * goBonus * 0.6 : 0) + (sequence.length === 0 ? -pipValue(card) * 0.02 : pipValue(card) * 0.005);
    values.push({ card, value, total, reply });
  }
  return values;
}

export const pegger = {
  id: 'pegger',
  name: 'Pegger',
  description: 'Keeps the best hand and pegs carefully: counts the cards still out, avoids setting up fifteens and pairs, plays for go and 31.',
  weight: 1,
  discard: greedy.discard, // keeps the best-scoring hand, as the greedy player does
  /**
   * Plays the card with the best pegging value.
   *
   * @param {object} ctx  the play context (see peggingValues)
   * @returns {string | null} the card, or null when none can be played
   * Side effects: none.
   */
  play(ctx) {
    const values = peggingValues(ctx);
    if (!values.length) return null;
    return values.reduce((a, b) => (b.value > a.value ? b : a)).card;
  },
};
