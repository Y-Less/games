// The host can remove any other player at any time: people (a computer player takes over mid-round) and computer players.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError } from './game.js';

const cards = (n) => Array.from({ length: n }, (_, i) => i + 1);
function started() {
  const game = new Game({ getCardIds: () => cards(100), hints: [], rng: () => 0.5 });
  const host = game.addPlayer('Ann', 't1');
  game.addPlayer('Bob', 't2');
  game.addPlayer('Cat', 't3');
  const { id: botId } = game.addBot(host.id);
  game.setRounds(host.id, 10);
  game.start(host.id);
  return { game, host, botId };
}

test('the host removes a computer player in the middle of a round, and the game goes on', () => {
  const { game, host, botId } = started();
  assert.equal(game.s.players.length, 4);
  game.removePlayer(host.id, botId);
  assert.equal(game.s.players.length, 3);
  assert.equal(game.s.players.some((p) => p.id === botId), false);
  assert.notEqual(game.s.phase, 'lobby');
});

test('the host removes a person mid-round: a computer player takes the seat', () => {
  const { game, host } = started();
  const bob = game.s.players.find((p) => p.name === 'Bob');
  game.leave(host.id, bob.id);
  assert.equal(game.s.players.length, 4);
  assert.equal(game.player(bob.id).kind, 'bot');
  assert.notEqual(game.player(bob.id).name, 'Bob');
});

test('leaving a finished game leaves the final standings for the others, even when fewer than three remain', () => {
  const { game, host } = started();
  game.s.phase = 'finished';
  const bob = game.s.players.find((p) => p.name === 'Bob');
  const cat = game.s.players.find((p) => p.name === 'Cat');
  game.leave(bob.id, bob.id);
  game.leave(cat.id, cat.id);
  assert.equal(game.s.phase, 'finished', 'the game is not sent back to the lobby');
  assert.deepEqual(game.s.players.map((p) => p.name), ['Ann', game.s.players[1].name]);
  assert.throws(() => game.leave(host.id, game.s.players[1].id), GameError, 'the host cannot remove anybody once the game is over');
});

test('only the host removes others, and nonsense ids change nothing', () => {
  const { game, host, botId } = started();
  const bob = game.s.players.find((p) => p.name === 'Bob');
  assert.throws(() => game.leave(bob.id, host.id), GameError);
  assert.throws(() => game.leave(bob.id, botId), GameError);
  const before = JSON.stringify(game.s);
  for (const id of ['nobody', 99999, null, undefined, {}, []]) assert.throws(() => game.leave(host.id, id), GameError);
  assert.equal(JSON.stringify(game.s), before);
});

