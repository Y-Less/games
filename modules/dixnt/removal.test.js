// The host can remove any other player at any time: people (a computer player takes over mid-round) and computer
// players (in the lobby, where they still belong to nobody).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom } from './harness.js';

/** Ann (the host), Bob, Cat and one computer player, in a game under way. */
function started() {
  const made = makeRoom(['Ann', 'Bob', 'Cat'], { bots: 1, rounds: 10, rng: () => 0.5, start: true });
  return { ...made, botId: 'bot:1' };
}

test('the host removes a computer player in the lobby, and cannot once the game is on', () => {
  const made = makeRoom(['Ann', 'Bob', 'Cat'], { bots: 1, rng: () => 0.5 });
  const { game, room, rng } = made;
  assert.equal(room.players.length, 4);
  assert.equal(game.removeBot(room, 1, room.players.find((p) => p.id === 'bot:1').slot, rng).ok, true);
  assert.equal(room.players.length, 3);
  assert.equal(room.players.some((p) => p.id === 'bot:1'), false);

  assert.equal(game.addBot(room, 1).ok, true);
  assert.equal(game.start(room, 1, rng).ok, true);
  assert.equal(game.removeBot(room, 1, room.players.find((p) => p.id === 'bot:2').slot, rng).error, 'botsRemoveLobbyOnly', 'its turns are part of the game now');
});

test('the host removes a person mid-round: a computer player takes their place', () => {
  const { game, room, rng } = started();
  assert.equal(game.kick(room, 1, game.playerOf(room, 2).slot, rng, 0).ok, true);
  assert.equal(room.players.length, 4, 'the place is kept, so no turn is lost');
  assert.equal(game.playerOf(room, 2), undefined);
  const stand = room.players[1];
  assert.equal(stand.kind, 'bot');
  assert.notEqual(stand.name, 'Bob');
  assert.ok(stand.ai, 'it is given an AI so it can carry on');
});

test('somebody put out by the host is barred, so the invitation does not let them straight back in', () => {
  const { game, room, rng } = started();
  assert.equal(game.kick(room, 1, game.playerOf(room, 2).slot, rng, 0).ok, true);
  assert.deepEqual(room.barred, [2]);
  assert.equal(game.addHuman(room, 2, 'Bob').error, 'removedFromGame');
});

test('leaving a finished game leaves the final standings for the others', () => {
  const { game, room, rng } = started();
  room.phase = 'finished';
  const left = game.removeHuman(room, 2, rng, 0);
  assert.equal(left.ok, true);
  assert.equal(left.replaced, false, 'no computer player takes their place once the game is over');
  assert.equal(game.playerOf(room, 2).left, true, 'they are marked as gone');
  assert.deepEqual(room.players.map((p) => p.name), ['Ann', 'Bob', 'Cat', room.players[3].name], 'the standings still name everybody');
  assert.equal(game.kick(room, 1, game.playerOf(room, 3).slot, rng, 0).error, 'gameOverNobodyToRemove', 'the host cannot remove anybody once the game is over');
});

test('only the host removes others, and nonsense ids change nothing', () => {
  const { game, room, rng, botId } = started();
  assert.equal(game.kick(room, 2, game.playerOf(room, 1).slot, rng, 0).error, 'hostOnlyRemove');
  assert.equal(game.kick(room, 1, room.players.find((p) => p.id === botId).slot, rng, 0).error, 'playerNotInGame', 'a computer player is not kicked: it is removed');
  assert.equal(game.kick(room, 1, game.playerOf(room, 1).slot, rng, 0).error, 'playerNotInGame', 'the host cannot remove themselves');
  const before = JSON.stringify(room);
  for (const id of ['nobody', 99999, null, undefined, {}, [], 's99', 1]) assert.equal(game.kick(room, 1, id, rng, 0).ok, false);
  assert.equal(JSON.stringify(room), before);
});

test('the last person leaving empties the room, so computer players alone never keep one alive', () => {
  const { game, room, rng } = started();
  assert.equal(game.removeHuman(room, 2, rng, 0).empty, false);
  assert.equal(game.removeHuman(room, 3, rng, 0).empty, false);
  const last = game.removeHuman(room, 1, rng, 0);
  assert.equal(last.empty, true, 'the server drops a room like this');
});
