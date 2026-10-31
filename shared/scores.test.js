import test from 'node:test';
import assert from 'node:assert/strict';
import { finalStandings, placements, playerScoreboardEntry, seatScoreboardEntry, standingsOf, totalsFromRounds, winnersOf } from './scores.js';

test('totals add up every round, including players missing from some rounds', () => {
  const rounds = [{ deltas: { a: 5, b: 0 } }, { deltas: { a: 3, b: 7, c: 1 } }, {}];
  assert.deepEqual(totalsFromRounds(rounds, ['a', 'b']), { a: 8, b: 7, c: 1 });
  assert.deepEqual(totalsFromRounds([], ['a']), { a: 0 });
});

test('placements share a position for ties and skip the next one', () => {
  assert.deepEqual(placements({ a: 10, b: 30, c: 30, d: 5 }), { a: 3, b: 1, c: 1, d: 4 });
  assert.deepEqual(placements({ a: 10, b: 30, c: 30, d: 5 }, { lowIsBetter: true }), { a: 2, b: 3, c: 3, d: 1 });
});

test('winners are everyone on the best score', () => {
  assert.deepEqual(winnersOf({ a: 3, b: 9, c: 9 }), ['b', 'c']);
  assert.deepEqual(winnersOf({ a: 3, b: 9, c: 3 }, { lowIsBetter: true }), ['a', 'c']);
  assert.deepEqual(winnersOf({}), []);
});

test('a seat scoreboard entry says who the seat is, whose turn it is and whether the person is away', () => {
  const online = (id) => id === 7;
  const person = { kind: 'human', id: 7, name: 'Ann' };
  assert.deepEqual(seatScoreboardEntry(person, 2, { score: 12, me: 2, current: true, online }), { id: 2, name: 'Ann', userId: 7, score: 12, isMe: true, bot: false, current: true, away: false });
  assert.deepEqual(seatScoreboardEntry({ kind: 'human', id: 8, name: 'Bo' }, 0, { score: 0, me: 2, current: false, online }), { id: 0, name: 'Bo', userId: 8, score: 0, isMe: false, bot: false, current: false, away: true });
  const bot = seatScoreboardEntry({ kind: 'bot', id: 'bot:1', name: 'Hazel' }, 1, { score: 3, me: -1, current: false, online });
  assert.deepEqual(bot, { id: 1, name: 'Hazel', userId: undefined, score: 3, isMe: false, bot: true, current: false, away: false });
  assert.deepEqual(Object.keys(bot), ['id', 'name', 'userId', 'score', 'isMe', 'bot', 'current', 'away']);
});

test('a player scoreboard entry is keyed by account id and has "ready" only when asked for', () => {
  const online = () => false;
  const person = { kind: 'human', id: 4, name: 'raw', score: 9 };
  assert.deepEqual(playerScoreboardEntry(person, { name: 'Cy', me: 4, current: false, online }), { id: 4, name: 'Cy', userId: 4, score: 9, isMe: true, bot: false, current: false, away: true });
  const ready = playerScoreboardEntry({ kind: 'bot', id: 'bot:2', name: 'Otis', score: 1 }, { name: 'Otis', me: 4, current: true, online, ready: false });
  assert.deepEqual(ready, { id: 'bot:2', name: 'Otis', userId: undefined, score: 1, isMe: false, bot: true, current: true, away: false, ready: false });
  assert.deepEqual(Object.keys(ready).at(-1), 'ready');
});

test('standings put the best first, share places for ties and mark every leader a winner, leaving the input alone', () => {
  const players = [{ id: 'a', score: 3 }, { id: 'b', score: 9 }, { id: 'c', score: 9 }, { id: 'd', score: 1 }];
  const standings = standingsOf(players);
  assert.deepEqual(standings.map((p) => [p.id, p.placement, p.winner]), [['b', 1, true], ['c', 1, true], ['a', 3, false], ['d', 4, false]]);
  assert.deepEqual(players.map((p) => p.id), ['a', 'b', 'c', 'd']);
  assert.equal('placement' in players[0], false);
  assert.deepEqual(standingsOf([]), []);
});

test('final standings are by player id, and empty until the game is over', () => {
  const players = [{ id: 1, score: 2 }, { id: 2, score: 5 }];
  assert.equal(finalStandings(players, false).size, 0);
  const final = finalStandings(players, true);
  assert.equal(final.get(2).placement, 1);
  assert.equal(final.get(2).winner, true);
  assert.equal(final.get(1).placement, 2);
  assert.equal(final.get(1).winner, false);
});
