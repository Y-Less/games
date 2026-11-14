// "Play again" in the games that keep a list of players: the host sends a finished game back to the lobby, and the
// same table plays another.  A room outlives the game played in it (MODULES.md), so the code, the people, and the
// settings stay, and everything else is as in a room just made.  The same promises are asserted of every such game.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as draw from '../modules/draw/game.js';
import * as gtk from '../modules/gtk/game.js';
import * as justOne from '../modules/just-one/game.js';
import * as scribblers from '../modules/scribblers/game.js';
import * as tints from '../modules/tints-and-hints/game.js';
import * as trivium from '../modules/trivium/game.js';
import * as wavelength from '../modules/wavelength/game.js';
import { seeded } from './random.js';
import { backToLobby } from './roster.js';

const NOW = 1_000_000;

/**
 * Each game: its rules, what the socket layer hands `createRoom` beyond the usual, settings other than the defaults
 * (which the next game must keep), and anything else about the room the next game must keep.
 */
const GAMES = [
  { name: 'Draw!', game: draw, settings: { rounds: 2, drawTime: 60, wordChoices: 4 }, given: { chooseMs: 1000, betweenMs: 500 }, roomKeeps: ['chooseMs', 'betweenMs', 'language'], oneAi: true },
  { name: 'Just One', game: justOne, settings: { rounds: 3 } },
  { name: 'Tints and Hints', game: tints, settings: { rounds: 3 }, given: { colour: '#808080' }, playerKeeps: ['colour'] },
  { name: 'Wavelength', game: wavelength, settings: { rounds: 3, mode: 'team' }, given: { colour: '#808080' }, playerKeeps: ['colour'] },
  { name: 'GTK', game: gtk, settings: { rounds: 2, questionsPerTurn: 3, seconds: 30 } },
  { name: 'Scribblers', game: scribblers, settings: { rounds: 2, drawTime: 60, wordChoices: 4 }, given: { chooseMs: 1000, betweenMs: 500, added: ['zebra crossing'] }, roomKeeps: ['chooseMs', 'betweenMs', 'added', 'language'] },
  { name: 'Trivium', game: trivium, settings: { rounds: 2, perRound: 3 }, given: { colour: '#808080', counts: { history: 100, science: 50 }, answerMs: 1000, spinMs: 100, revealStep: 10, revealHold: 20 }, roomKeeps: ['wheel', 'answerMs', 'spinMs', 'revealStep', 'revealHold'], playerKeeps: ['colour'] },
];

/**
 * A room of the fewest people the game is for, and one computer player, with the settings changed and the game
 * under way.
 * @param {object} spec  one of GAMES
 * @returns {{ room: object, rng: () => number }}
 */
function underWay({ game, settings, given = {} }) {
  const rng = seeded(3);
  const room = game.createRoom({ code: 'boss-aware-you', hostId: 1, hostName: 'Ann', settings, now: NOW, ...given });
  for (let id = 2; id <= game.MIN_PLAYERS; id++) assert.equal(game.addHuman(room, id, `P${id}`).ok, true);
  assert.equal(game.addBot(room, 1).ok, true);
  assert.equal(game.start(room, 1, rng, NOW).ok, true);
  return { room, rng };
}

/**
 * The same room, over: there is no need to play a whole game to ask what happens after one, so the room is simply
 * told it has finished, with scores and a scoreboard row for the next game not to inherit.
 * @param {object} room  a room under way (mutated)
 * @returns {void}
 */
function finish(room) {
  room.phase = 'finished';
  room.recorded = true;
  for (const [n, player] of room.players.entries()) player.score = 10 + n;
  room.history.push({ label: 'a round', deltas: Object.fromEntries(room.players.map((p) => [p.slot, 5])), notes: {} });
}

for (const spec of GAMES) {
  const { name, game, settings, roomKeeps = [], playerKeeps = [] } = spec;

  test(`${name}: only the host plays again, and only once the game is over`, () => {
    const { room } = underWay(spec);
    assert.deepEqual(game.playAgain(room, 1), { ok: false, error: 'notOver' }, 'not in the middle of a game: there is no ending one early');
    finish(room);
    assert.deepEqual(game.playAgain(room, 2), { ok: false, error: 'hostOnly' });
    assert.equal(room.phase, 'finished', 'a refusal changes nothing');
    assert.deepEqual(game.playAgain(room, 1), { ok: true });
    assert.deepEqual(game.playAgain(room, 1), { ok: false, error: 'notOver' }, 'already back in the lobby');
  });

  test(`${name}: the next game has the same code, people, and settings, and nothing else of the last one`, () => {
    const { room } = underWay(spec);
    finish(room);
    const before = structuredClone(room);
    assert.equal(game.playAgain(room, 1).ok, true);

    assert.equal(room.phase, 'lobby');
    assert.equal(room.code, before.code);
    assert.equal(room.hostId, before.hostId);
    for (const key of [...Object.keys(settings), ...roomKeeps]) assert.deepEqual(room[key], before[key], `${key} is kept`);
    assert.deepEqual(room.players.map((p) => [p.id, p.kind, p.name, p.slot]), before.players.map((p) => [p.id, p.kind, p.name, p.slot]), 'the same people, in the same places');
    for (const key of playerKeeps) assert.deepEqual(room.players.map((p) => p[key]), before.players.map((p) => p[key]), `each player's ${key} is kept`);
    assert.equal(room.nextSlot, before.nextSlot, 'so that somebody joining is not handed a slot already in use');

    assert.deepEqual(room.history, [], 'the scoreboard starts again');
    assert.equal(room.recorded, false, 'and the next game will be recorded in its own right');
    assert.equal(room.gameSeq, (before.gameSeq ?? 0) + 1, 'as the game after the one just played, which keeps its rounds');
    assert.ok(room.players.every((p) => p.score === 0), 'nobody carries a score over');
    assert.ok(room.players.every((p) => p.ai === undefined), 'a computer player is dealt its AI again at the next start');
  });

  test(`${name}: apart from what is kept, the room is as one just made`, () => {
    const { room } = underWay(spec);
    finish(room);
    assert.equal(game.playAgain(room, 1).ok, true);
    const made = game.createRoom({ code: room.code, hostId: 1, hostName: 'Ann', settings, now: NOW, ...(spec.given ?? {}) });
    const ours = ['players', 'size', 'nextBot', 'nextSlot', 'createdAt', 'updatedAt'];
    for (const key of Object.keys(made)) {
      if (ours.includes(key)) continue;
      assert.deepEqual(room[key], made[key], `${key} is as in a new room`);
    }
    const fresh = made.players[0];
    const kept = ['id', 'kind', 'name', 'slot', 'colour'];
    for (const player of room.players.filter((p) => p.kind === 'human')) {
      for (const key of Object.keys(fresh)) if (!kept.includes(key)) assert.deepEqual(player[key], fresh[key], `a player's ${key} is as a newcomer's`);
    }
  });

  test(`${name}: whoever left once the game was over is on its standings, and not at the table for the next one`, () => {
    const { room, rng } = underWay(spec);
    finish(room);
    const leaver = game.MIN_PLAYERS; // the last of the people to have joined
    const scores = room.players.map((p) => [p.id, p.score]);
    assert.equal(game.removeHuman(room, leaver, rng, NOW).ok, true);
    assert.deepEqual(room.players.map((p) => [p.id, p.score]), scores, 'the final scores still name them');
    assert.doesNotThrow(() => game.viewFor(room, 1), 'and the table that is left can still be shown them');
    assert.equal(game.playAgain(room, 1).ok, true);
    assert.equal(room.players.some((p) => p.id === leaver), false, 'they are not in the lobby of the next game');
    assert.equal(room.players.some((p) => p.id === 1), true, 'the host, who stayed, is');
    assert.equal(game.addHuman(room, leaver, 'Back again').ok, true, 'and they may join it afresh, like anybody with the code');
  });

  test(`${name}: the same table can start another game, and everybody can be shown it`, () => {
    const { room, rng } = underWay(spec);
    finish(room);
    assert.equal(game.playAgain(room, 1).ok, true);
    assert.doesNotThrow(() => room.players.forEach((p) => game.viewFor(room, p.id)), 'the lobby of the next game');
    assert.equal(game.start(room, 1, rng, NOW + 5000).ok, true);
    assert.notEqual(room.phase, 'lobby');
    // Draw! has the one kind of computer player, and so deals none.
    if (!spec.oneAi) assert.ok(room.players.filter((p) => p.kind === 'bot').every((p) => typeof p.ai === 'string'), 'the computer player has an AI again');
    assert.doesNotThrow(() => room.players.forEach((p) => game.viewFor(room, p.id)), 'the next game under way');
  });
}

test('a game that was abandoned can be played again as one that finished can', () => {
  const room = { phase: 'abandoned', hostId: 1, players: [{ id: 1, score: 4, ai: 'x', stoodInFor: 9 }], spare: 1, rounds: 3 };
  const outcome = backToLobby(room, 1, { blank: { phase: 'lobby', spare: 0, rounds: 1 }, keep: ['rounds'], freshPlayer: () => ({ score: 0 }) });
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(room, { phase: 'lobby', hostId: 1, players: [{ id: 1, score: 0 }], spare: 0, rounds: 3, gameSeq: 1, history: [], recorded: false });
});
