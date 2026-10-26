// A pegging specialist: counts the cards still out, plays to leave no easy fifteen, pair or run, and chases go and 31.
import { pipValue, scorePlay } from '../scoring.js';
import { greedy } from './greedy.js';
import { replyOutlook, unseenFrom } from './helpers.js';

/** Scores each playable card: points now, plus the go it may earn, minus what the next player may score back. */
export function peggingValues({ hand, count, sequence, played = [], starter = null, cardsLeft = [], me = 0, players = 2, goBonus = 1, pointsWeight = 1, dangerWeight = 1 }) {
  const unseen = unseenFrom(hand, played, starter ? [starter] : []);
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
  discard: greedy.discard,
  play(ctx) {
    const values = peggingValues(ctx);
    if (!values.length) return null;
    return values.reduce((a, b) => (b.value > a.value ? b : a)).card;
  },
};
