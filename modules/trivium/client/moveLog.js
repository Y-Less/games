// The "Recent moves" of a game, worked out on the client from the state it already receives: each new state is
// compared with the one before, and what changed becomes a line.  Nothing here needs the server to keep a log.
// Each line is a message (`{ key, params }`, see shared/messages.js) under the game's `log.*` keys, put into words by
// the table when it is drawn, so the list reads in the player's language whenever they switch.
import { msg } from '../../../shared/messages.js';

/**
 * The lines that the step from `prev` to `next` adds.
 *
 * @param {object|null} prev  the previous server view, or null for the first one received
 * @param {object|null} next  the new server view
 * @returns {object[]} the new log lines as messages, oldest first within the step (the list is shown newest first, so
 *   the answers go in before the line that says what the answer was)
 * Side effects: none.
 */
export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
  const out = [];
  const spun = next.spin?.category ?? null;

  // The round's category is written down once the wheel has stopped and its first question is up, not while it is
  // still turning: a line saying where it lands would spoil the watching.
  if (next.phase === 'question' && next.ask === 1 && spun && !(prev?.phase === 'question' && prev.round === next.round)) {
    out.push(msg('log.spin', { n: next.round, total: next.rounds, category: msg(`category.${spun}`) }));
  }
  if (next.phase === 'reveal' && prev?.phase !== 'reveal' && next.result && next.question) {
    for (const entry of next.result.entries) {
      out.push(msg(entry.right ? 'log.right' : 'log.wrong', { name: entry.name, answer: next.question.answers[entry.choice] ?? '', points: entry.points }));
    }
    for (const gone of next.result.missed) out.push(msg('log.missed', { name: gone.name }));
    out.push(msg('log.answer', { answer: next.question.answers[next.result.correct] ?? '' }));
  }
  if (next.phase === 'finished' && prev?.phase !== 'finished') {
    const winners = next.players.filter((p) => p.winner).map((p) => p.name);
    if (winners.length) out.push(msg('log.gameOver', { names: winners, count: winners.length }));
  }
  if (next.phase === 'abandoned' && prev?.phase !== 'abandoned') out.push(msg('log.ranOut'));
  return out;
}
