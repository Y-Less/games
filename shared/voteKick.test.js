// Putting somebody out by vote (shared/voteKick.js): who may ask, who may answer, when it carries and when it lapses.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VOTE_MS, answerRemoval, askToRemove, dropVote, needed, tidyVote, voteOn, voteView } from './voteKick.js';

/** A room and the people in it: Ann (1), Bob (2), Cy (3), Di (4) by default. */
const table = (n = 4) => ({ room: {}, people: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) });
const NOW = 1000;

test('more than half of the people who are not the one being voted on', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10].map(needed), [1, 2, 2, 3, 3, 4, 6]);
});

test('asking starts a vote, and whoever asks has said yes by asking', () => {
  const { room, people } = table();
  assert.deepEqual(askToRemove(room, 1, people, 3, NOW), { ok: true });
  assert.deepEqual(room.vote, { target: 3, by: 1, yes: [1], no: [], until: NOW + VOTE_MS });
  assert.deepEqual(voteView(room, 2, people, NOW), { target: 3, by: 1, yes: 1, no: 0, needed: 2, answered: null, mine: false });
  assert.deepEqual(voteView(room, 1, people, NOW), { target: 3, by: 1, yes: 1, no: 0, needed: 2, answered: true, mine: true });
});

test('a vote needs three people: with two, the only other person deciding alone is what the host is for', () => {
  const { room, people } = table(2);
  assert.deepEqual(askToRemove(room, 1, people, 2, NOW), { ok: false, error: 'needThreeToVote' });
  assert.equal(room.vote, undefined);
});

test('you cannot ask about yourself, about somebody who is not there, or if you are not there', () => {
  const { room, people } = table();
  assert.equal(askToRemove(room, 1, people, 1, NOW).error, 'cannotVoteOnYourself');
  assert.equal(askToRemove(room, 1, people, 99, NOW).error, 'playerNotInGame');
  assert.equal(askToRemove(room, 99, people, 2, NOW).error, 'notInGame');
  assert.equal(room.vote, undefined, 'and none of that starts a vote');
});

test('one vote at a time, until it is settled, dropped or has lapsed', () => {
  const { room, people } = table();
  assert.equal(askToRemove(room, 1, people, 3, NOW).ok, true);
  assert.equal(askToRemove(room, 2, people, 4, NOW).error, 'voteAlreadyRunning');
  assert.equal(askToRemove(room, 2, people, 4, NOW + VOTE_MS).ok, true, 'once it has lapsed the next one may be asked');
  assert.equal(room.vote.target, 4);
});

test('it carries as soon as enough have said yes, and the room is told to remove them', () => {
  const { room, people } = table(); // four people, so three may vote and two are needed
  assert.equal(askToRemove(room, 1, people, 3, NOW).ok, true);
  assert.deepEqual(answerRemoval(room, 2, true, people, NOW), { ok: true, passed: true, settled: true });
  assert.equal(room.vote, null, 'and the vote is over');
});

test('it fails as soon as enough have said no, with nothing left to wait for', () => {
  const { room, people } = table(5); // five people, so four may vote and three are needed
  assert.equal(askToRemove(room, 1, people, 5, NOW).ok, true);
  assert.deepEqual(answerRemoval(room, 2, false, people, NOW), { ok: true, passed: false, settled: false });
  assert.deepEqual(answerRemoval(room, 3, false, people, NOW), { ok: true, passed: false, settled: true }, 'two of four against can never be outvoted');
  assert.equal(room.vote, null);
});

test('changing your mind replaces your answer rather than counting twice', () => {
  const { room, people } = table(5);
  assert.equal(askToRemove(room, 1, people, 5, NOW).ok, true);
  assert.equal(answerRemoval(room, 2, false, people, NOW).settled, false);
  assert.deepEqual(voteView(room, 2, people, NOW), { target: 5, by: 1, yes: 1, no: 1, needed: 3, answered: false, mine: false });
  assert.deepEqual(answerRemoval(room, 2, true, people, NOW), { ok: true, passed: false, settled: false });
  assert.deepEqual(voteView(room, 2, people, NOW), { target: 5, by: 1, yes: 2, no: 0, needed: 3, answered: true, mine: false });
  assert.equal(answerRemoval(room, 3, true, people, NOW).passed, true);
});

test('the one being voted on does not answer, and nor does anybody outside the room', () => {
  const { room, people } = table();
  assert.equal(askToRemove(room, 1, people, 3, NOW).ok, true);
  assert.equal(answerRemoval(room, 3, false, people, NOW).error, 'cannotVoteOnYourself');
  assert.equal(answerRemoval(room, 99, true, people, NOW).error, 'notInGame');
  assert.equal(answerRemoval(room, 2, true, people, NOW + VOTE_MS).error, 'noVoteRunning', 'and not after it has lapsed');
});

test('only the one who asked may call it off', () => {
  const { room, people } = table();
  assert.equal(askToRemove(room, 1, people, 3, NOW).ok, true);
  assert.equal(dropVote(room, 2, NOW).error, 'onlyTheAskerDrops');
  assert.deepEqual(dropVote(room, 1, NOW), { ok: true });
  assert.equal(room.vote, null);
  assert.equal(dropVote(room, 1, NOW).error, 'noVoteRunning');
});

test('a vote about somebody who has gone, or one too few people are left for, is forgotten', () => {
  const { room, people } = table();
  assert.equal(askToRemove(room, 1, people, 3, NOW).ok, true);
  tidyVote(room, people, NOW);
  assert.ok(room.vote, 'while it still makes sense it stands');
  tidyVote(room, people.filter((p) => p.id !== 3), NOW);
  assert.equal(room.vote, null, 'the one it was about has gone');

  assert.equal(askToRemove(room, 1, people, 3, NOW).ok, true);
  tidyVote(room, people.slice(0, 2), NOW);
  assert.equal(room.vote, null, 'and two people cannot carry one');
});

test('a lapsed vote is no vote at all, however it is looked at', () => {
  const { room, people } = table();
  assert.equal(askToRemove(room, 1, people, 3, NOW).ok, true);
  assert.ok(voteOn(room, NOW + VOTE_MS - 1));
  assert.equal(voteOn(room, NOW + VOTE_MS), null);
  assert.equal(voteView(room, 2, people, NOW + VOTE_MS), null);
  tidyVote(room, people, NOW + VOTE_MS);
  assert.equal(room.vote, null, 'and tidying throws the lapsed one away');
});
