// Plays whole seeded games and records every view the rules send, for the view test (node) and the client's
// render-everything test (vitest): the same views reach both, so what the server sends is also what the table draws.
//
// The people are played here (the drawer chooses a word, some guessers get it, some do not, and one turn in each game
// is left to run out of time); a game may also be given computer players, which play themselves through the rules, so
// that the views of a table with them in are drawn as well.
import assert from 'node:assert/strict';
import { seeded } from '../../shared/random.js';
import * as game from './game.js';

/** The waits used while recording, in milliseconds: short, so a game is a few thousand ticks of the fake clock. */
const CHOOSE_MS = 1000;
const BETWEEN_MS = 500;

/**
 * Plays a seeded game through the rules alone and returns every view it sent.
 *
 * @param {number} seed  the seed for the random source
 * @param {number} size  how many people are at the table
 * @param {number} rounds  how many rounds they play
 * @param {number} [bots]  how many computer players to add as well
 * @returns {{ views: string[], finished: boolean }} every view as JSON, and whether the game ran to its end
 * Side effects: none outside the room it makes.
 */
export function recordedViews(seed, size, rounds, bots = 0) {
  const rng = seeded(seed);
  let now = 1000;
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings: { rounds, drawTime: 30 }, now, chooseMs: CHOOSE_MS, betweenMs: BETWEEN_MS });
  for (let id = 2; id <= size; id++) assert.equal(game.addHuman(room, id, `Player ${id}`).ok, true);
  for (let n = 0; n < bots; n++) assert.equal(game.addBot(room, 1).ok, true);
  const names = (id) => `Player ${id}`;
  const views = [];
  /** Records the view each of the players, and an outsider, would be sent now. */
  const look = () => {
    for (const id of [1, 2, size, 99]) {
      views.push(JSON.stringify(game.viewFor(room, id, { nameOf: names, now })));
      views.push(JSON.stringify(game.viewFor(room, id, { nameOf: names, online: () => false, now })));
    }
  };

  look();
  assert.equal(game.start(room, 1, rng, now).ok, true);
  look();

  let turns = 0;
  for (let guard = 0; guard < 2000 && room.phase !== 'finished'; guard++) {
    now += 100;
    const botAction = game.pendingBotAction(room);
    if (botAction && !(room.phase === 'drawing' && botAction.type === 'guess' && rng() < 0.5)) {
      // A computer player acts when it owes something; a guess only now and then, so the people get a turn too.
      assert.equal(game.runBotAction(room, rng, now, botAction), true);
      look();
      continue;
    }
    if (room.phase === 'choosing') {
      const choice = Math.floor(rng() * room.choices.length);
      assert.equal(game.chooseWord(room, room.drawer, choice, now).ok, true);
      turns++;
      look();
      continue;
    }
    if (room.phase === 'drawing') {
      const guessers = room.players.filter((p) => p.id !== room.drawer);
      // Every third turn nobody gets it and the drawing runs out of time; otherwise a wrong guess, a close one, and
      // then everybody gets there.
      if (turns % 3 === 0) {
        assert.equal(game.guess(room, guessers[0].id, 'nonsense', now).ok, true);
        look();
        now += room.drawTime * 1000;
        assert.equal(game.timeUp(room, rng, now, names).ok, true);
        look();
        continue;
      }
      assert.equal(game.guess(room, guessers[0].id, 'nonsense', now).ok, true);
      look();
      now += 1500; // apart enough that the rules' rate limit (five in three seconds) never bites
      assert.equal(game.guess(room, guessers[0].id, `${room.word}s`, now).ok, true); // nearly right
      look();
      for (const p of guessers) {
        now += 1500;
        if (!game.viewFor(room, p.id, { now }).youGuessed) assert.equal(game.guess(room, p.id, room.word, now).ok, true);
        look();
        if (room.phase !== 'drawing') break;
      }
      if (room.phase === 'drawing') {
        now += room.drawTime * 1000;
        assert.equal(game.timeUp(room, rng, now, names).ok, true);
        look();
      }
      continue;
    }
    if (room.phase === 'between') {
      now += BETWEEN_MS;
      assert.equal(game.timeUp(room, rng, now, names).ok, true);
      look();
      continue;
    }
    if (room.phase === 'scores') {
      // Only the people close the scores; a computer player is always ready, and the round starts as the last person does.
      for (const p of room.players) {
        if (room.phase !== 'scores' || p.kind === 'bot') continue;
        assert.equal(game.ready(room, p.id, rng, now).ok, true);
      }
      look();
      continue;
    }
    break;
  }
  look();
  return { views, finished: room.phase === 'finished' };
}
