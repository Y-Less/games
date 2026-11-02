// Messages and refusals: what the server hands a client instead of a sentence (see shared/messages.js and MODULES.md,
// Languages).  The client turns these into words, so what matters here is that the shapes are right and that nothing a
// developer wrote can reach a player as it stands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardMsg, isMessage, msg, refusal, refusalReply, suitMsg } from './messages.js';

test('a message is a key, with the values its words need', () => {
  assert.deepEqual(msg('hand'), { key: 'hand' });
  assert.deepEqual(msg('hand', { n: 2 }), { key: 'hand', params: { n: 2 } });
  assert.ok(isMessage(msg('hand')));
  for (const not of ['hand', 2, null, undefined, [], {}, { params: {} }]) assert.equal(isMessage(not), false, JSON.stringify(not));
});

test('a card is named by its rank and suit, so a language orders them itself', () => {
  assert.deepEqual(cardMsg('QS'), { key: 'cards.name', params: { rank: { key: 'cards.rank.Q' }, suit: { key: 'cards.suit.S' } } });
  assert.deepEqual(cardMsg('10H').params.rank, { key: 'cards.rank.10' });
  assert.deepEqual(cardMsg('JK1'), { key: 'cards.joker.black' });
  assert.deepEqual(cardMsg('JK2'), { key: 'cards.joker.red' });
  assert.deepEqual(suitMsg('H'), { key: 'cards.suit.H' });
});

test('a refusal thrown out of createRoom keeps its code and values', () => {
  const thrown = refusal('playersRange', { min: 2, max: 4 });
  assert.ok(thrown instanceof Error);
  assert.deepEqual(refusalReply(thrown), { ok: false, error: 'playersRange', params: { min: 2, max: 4 } });
  assert.deepEqual(refusalReply(refusal('freeWallSetting')), { ok: false, error: 'freeWallSetting' }, 'no params when the words need none');
});

test('anything else thrown out of createRoom is a server error, never a developer sentence', () => {
  // A rules bug, a thrown string, a sentence that happens to be thrown: none of it is the player's to read.
  for (const thrown of [new Error('A game is for 2 to 4 players.'), new Error('Cannot read properties of undefined'), new Error(''), new TypeError('x is not a function'), null, undefined, 'a string']) {
    assert.deepEqual(refusalReply(thrown), { ok: false, error: 'serverError' }, String(thrown));
  }
  // Not even a code-shaped message counts unless the rules meant it as a refusal.
  assert.deepEqual(refusalReply(new Error('playersRange')), { ok: false, error: 'serverError' });
});
