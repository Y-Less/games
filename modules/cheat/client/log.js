// The "Recent moves" list for Cheat. The server sends the table as it is, not a history, so the client keeps one: every
// state that arrives is compared with the one before it, and what changed (a play, a call, a pick-up) is added as a line.
// The list starts when the page does. It lives outside the table component so that every state is looked at.
import { rankWord } from './rank.js';

const LIMIT = 120;
const nameOf = (state, seat) => state.seats[seat]?.name ?? 'Someone';
const cards = (n) => `${n} ${n === 1 ? 'card' : 'cards'}`;

/** The log after `next` arrives, given the log so far and the previous state (null when there was none). */
export function advanceLog(log, prev, next) {
  if (!next || next.phase === 'lobby') return [];
  if (!prev || prev.code !== next.code) return [];
  if (prev.phase === 'lobby') return [{ text: 'The cards are dealt.' }];
  const out = [...log];
  const add = (text) => out.push({ text });

  if (next.plays > prev.plays && next.last) add(`${nameOf(next, next.last.seat)} plays ${cards(next.last.count)}, claiming ${rankWord(next.last.rank, next.last.count)}.`);
  const call = next.lastCall;
  if (call && JSON.stringify(call) !== JSON.stringify(prev.lastCall)) {
    add(`${nameOf(next, call.caller)} calls Cheat on ${nameOf(next, call.accused)}: it was ${call.lie ? 'a lie' : 'true'}, so ${nameOf(next, call.picker)} picks up ${cards(call.pileSize)}.`);
  }
  if (next.phase === 'finished' && prev.phase !== 'finished') add(`${nameOf(next, next.winner)} gets rid of every card and wins.`);
  return out.length > LIMIT ? out.slice(-LIMIT) : out;
}
