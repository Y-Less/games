// Tournament mode as every game actually has it.  Nothing here is particular to one game: the same promises are
// asserted of all sixteen, because no game was asked for a line of code to take part and none of them may be quietly
// left behind.
//
// The two that matter most are the ones a game could break without knowing:
//   - the first table a tournament offers is a normal game *of that game* (four at Hearts, two at Cribbage), measured
//     off the game's own rules rather than read from its manifest, whose `minPlayers` means something else;
//   - a tournament lobby holds more people than the game seats, and the game must still be able to draw it, settle
//     its settings, and put somebody out while it does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as azulejo from '../modules/azulejo/game.js';
import * as cheat from '../modules/cheat/game.js';
import * as cribbage from '../modules/cribbage/game.js';
import * as dixnt from '../modules/dixnt/game.js';
import * as draw from '../modules/draw/game.js';
import * as gaudi from '../modules/gaudi/game.js';
import * as gtk from '../modules/gtk/game.js';
import * as hearts from '../modules/hearts/game.js';
import * as justOne from '../modules/just-one/game.js';
import * as nominationWhist from '../modules/nomination-whist/game.js';
import * as rummikub from '../modules/rummikub/game.js';
import * as scribblers from '../modules/scribblers/game.js';
import * as splendour from '../modules/splendour/game.js';
import * as tints from '../modules/tints-and-hints/game.js';
import * as trivium from '../modules/trivium/game.js';
import * as wavelength from '../modules/wavelength/game.js';
import { rosterLayout, seatLayout } from './layout.js';
import { seeded } from './random.js';
import { MAX_ENTRANTS } from './tournament.js';
import { createTournamentRules } from './tournamentRoom.js';

const NOW = 1_000_000;
const HOST = 1;

/** Every game that has tournament mode, which is every room-based game but the tour. */
const GAMES = Object.entries({ azulejo, cheat, cribbage, dixnt, draw, gaudi, gtk, hearts, 'just-one': justOne, 'nomination-whist': nominationWhist, rummikub, scribblers, splendour, 'tints-and-hints': tints, trivium, wavelength }).map(([name, game]) => ({
  name,
  game,
  // The two families name the same three numbers differently; the rules are what the tournament is measured against.
  min: game.MIN_SEATS ?? game.MIN_PLAYERS,
  max: game.MAX_SEATS ?? game.MAX_PLAYERS,
  normal: game.DEFAULT_SEATS ?? game.DEFAULT_PLAYERS,
}));

/** A lobby of this game with the host in it, and the tournament rules that go with it. */
function lobby(spec) {
  const room = spec.game.createRoom({ code: 'boss-aware-you', hostId: HOST, hostName: 'Ann', settings: {}, now: NOW });
  const seated = Array.isArray(room.seats);
  const layout = seated ? seatLayout : rosterLayout;
  const members = seated ? (r) => r.seats : (r) => r.players;
  // The manifest's numbers, deliberately wrong here: a tournament must measure the game itself rather than trust them.
  const rules = createTournamentRules({ game: spec.game, members, layout, limits: { min: 1, max: 99 }, rng: seeded(5) });
  return { room, rules, layout, members, places: () => layout.capacity(room, spec.max) };
}

/** Everybody else, joining one after another. */
const fill = (spec, room, upTo) => {
  for (let id = 2; id <= upTo; id++) spec.game.addHuman(room, id, `P${id}`);
};
/** Asking a game to draw a room, which is the thing an outsized lobby could break. */
const drawn = (spec, room, userId) => spec.game.viewFor(room, userId, { online: () => true, nameOf: (id) => `P${id}`, catalogue: [] });

for (const spec of GAMES) {
  const { name } = spec;

  test(`${name}: the first table offered is two people and a normal game of it`, () => {
    const { room, rules } = lobby(spec);
    assert.deepEqual(rules.setTable(room, HOST, { on: true }), { ok: true });
    const block = rules.blockFor(room, HOST);
    // A normal game of this game, which is what "fill up with computer players" has always made: four at most games,
    // two at Cribbage.  The people come first and the computer players make the table up.
    assert.equal(block.size, spec.normal, 'a normal game of it');
    assert.equal(block.humans, Math.min(2, spec.normal));
    assert.equal(block.bots, spec.normal - block.humans);
    // The table it will allow is what the game's rules allow, not what its manifest says (several say one person).
    assert.deepEqual({ min: block.limits.min, max: block.limits.max }, { min: spec.min, max: spec.max });
  });

  test(`${name}: a tournament lobby holds a tournament's worth of people, and is drawn without the game`, () => {
    const { room, rules, places } = lobby(spec);
    assert.deepEqual(rules.setTable(room, HOST, { on: true }), { ok: true });
    assert.equal(places(), MAX_ENTRANTS, 'the lobby is as big as a tournament may be');
    fill(spec, room, MAX_ENTRANTS);
    const view = rules.viewFor(room, MAX_ENTRANTS);
    assert.equal(view.tournament.entrants.length, MAX_ENTRANTS, 'everybody is in it');
    // How long the evening would be, before anybody starts it: every combination of the people who have come.
    assert.equal(view.tournament.tablesInAll, (MAX_ENTRANTS * (MAX_ENTRANTS - 1)) / 2, 'sixteen people in pairs is a hundred and twenty games');
    assert.deepEqual([view.code, view.phase, view.you, view.isHost], [room.code, 'lobby', MAX_ENTRANTS, false]);
    // The game is not asked to draw this room — its hands and tallies are as long as its own table, and this is
    // sixteen people — but it must still cope with the rules a lobby runs while they are all in it.
    assert.doesNotThrow(() => spec.game.setSettings(room, HOST, {}), 'the settings still answer');
    assert.doesNotThrow(() => spec.game.kick(room, HOST, view.tournament.entrants.at(-1).slot, seeded(2), NOW), 'somebody may be put out');
    assert.doesNotThrow(() => spec.game.removeHuman(room, 5, seeded(2), NOW), 'and somebody may leave');
    assert.equal(rules.viewFor(room, HOST).tournament.entrants.length, MAX_ENTRANTS - 2, 'both of them are gone');
  });

  test(`${name}: an ordinary lobby of it is still the game's own, with the tournament offered beside it`, () => {
    const { room, rules } = lobby(spec);
    assert.equal(rules.viewFor(room, HOST), null, 'the game keeps its own lobby until the setting is on');
    assert.equal(rules.blockFor(room, HOST).on, false, 'but the lobby is told it could be a tournament');
    assert.doesNotThrow(() => drawn(spec, room, HOST), 'and the game draws its own lobby as it always did');
  });

  test(`${name}: switching tournament mode off puts the lobby back exactly as it was`, () => {
    const { room, rules, places } = lobby(spec);
    const before = places();
    assert.deepEqual(rules.setTable(room, HOST, { on: true }), { ok: true });
    fill(spec, room, MAX_ENTRANTS);
    // More people are now in the room than the game seats, so the lobby cannot go back to being one table: the host
    // is told to put somebody out first, exactly as they would be for any other way of making a room smaller.
    assert.deepEqual(rules.setTable(room, HOST, { on: false }), { ok: false, error: 'tournamentCrowded', params: { max: before } });
    assert.equal(places(), MAX_ENTRANTS, 'a refusal leaves the lobby alone');
    for (let id = 2; id <= MAX_ENTRANTS; id++) spec.game.removeHuman(room, id, seeded(2), NOW);
    assert.deepEqual(rules.setTable(room, HOST, { on: false }), { ok: true });
    assert.equal(places(), before, 'the room it was before');
    assert.equal(rules.settingOf(room), null, 'and no tournament');
  });

  test(`${name}: a tournament lobby takes no computer players, since its tables have their own`, () => {
    const { room, rules, members } = lobby(spec);
    assert.equal(rules.botsRefused(room), null, 'an ordinary lobby is welcome to them');
    assert.deepEqual(rules.setTable(room, HOST, { on: true }), { ok: true });
    assert.deepEqual(rules.botsRefused(room), { ok: false, error: 'tournamentNoBots' });
    assert.equal(members(room).filter((m) => m?.kind === 'bot').length, 0);
  });

  test(`${name}: switching it on takes out the computer players somebody had added`, () => {
    const { room, rules, members } = lobby(spec);
    spec.game.addBot(room, HOST);
    assert.equal(members(room).filter((m) => m?.kind === 'bot').length, 1, 'one was added');
    assert.deepEqual(rules.setTable(room, HOST, { on: true }), { ok: true });
    assert.equal(members(room).filter((m) => m?.kind === 'bot').length, 0, 'and it is gone again');
  });
}

// ---- the refusals, which need only one game to say ----

test('a table the game could not deal is refused, and the lobby is left as it was', () => {
  // Cribbage is for two to five, and a normal game of it is two: the one game whose first table is not four.
  const { room, rules } = lobby({ game: cribbage, min: cribbage.MIN_SEATS, max: cribbage.MAX_SEATS, normal: cribbage.DEFAULT_SEATS });
  assert.deepEqual(rules.setTable(room, HOST, { on: true }), { ok: true });
  assert.deepEqual(rules.blockFor(room, HOST).size, 2);
  assert.deepEqual(rules.setTable(room, HOST, { bots: 3 }), { ok: true }, 'five is a game of Cribbage');
  assert.deepEqual(rules.setTable(room, HOST, { bots: 4 }), { ok: false, error: 'tournamentSize', params: { min: 2, max: 5 } });
  assert.deepEqual(rules.blockFor(room, HOST).bots, 3, 'the refused table was not taken');
  assert.deepEqual(rules.setTable(room, HOST, { humans: 0 }), { ok: false, error: 'tournamentPeople', params: { max: MAX_ENTRANTS } });
  assert.deepEqual(rules.setTable(room, HOST, { humans: 'two' }), { ok: false, error: 'tournamentTable' });
  assert.deepEqual(rules.setTable(room, HOST, null), { ok: false, error: 'tournamentTable' });
});

test('only the host sets the table, and only before the tournament starts', () => {
  const { room, rules } = lobby({ game: hearts, min: hearts.MIN_SEATS, max: hearts.MAX_SEATS, normal: hearts.DEFAULT_SEATS });
  hearts.addHuman(room, 2, 'Bo');
  assert.deepEqual(rules.setTable(room, 2, { on: true }), { ok: false, error: 'hostOnly' });
  assert.deepEqual(rules.setTable(room, HOST, { on: true }), { ok: true });
  room.phase = 'playing';
  assert.deepEqual(rules.setTable(room, HOST, { humans: 3 }), { ok: false, error: 'settingsBeforeStart' });
});

test('a game without tournaments says so, and never carries one', () => {
  const { room } = lobby({ game: hearts, min: hearts.MIN_SEATS, max: hearts.MAX_SEATS, normal: hearts.DEFAULT_SEATS });
  const none = createTournamentRules({ game: hearts, members: (r) => r.seats, layout: seatLayout, limits: { min: 3, max: 7 }, rng: seeded(1), enabled: false });
  assert.deepEqual(none.setTable(room, HOST, { on: true }), { ok: false, error: 'tournamentNotHere' });
  assert.equal(none.blockFor(room, HOST), null);
  assert.equal(none.settingOf(room), null);
  assert.equal(none.botsRefused(room), null);
});

test('a room that is neither a tournament nor a lobby carries nothing about one', () => {
  const { room, rules } = lobby({ game: hearts, min: hearts.MIN_SEATS, max: hearts.MAX_SEATS, normal: hearts.DEFAULT_SEATS });
  assert.ok(rules.blockFor(room, HOST), 'a lobby says what it would be, so the host can switch it on');
  room.phase = 'playing';
  assert.equal(rules.blockFor(room, HOST), null, 'a game under way has nothing to say about tournaments');
});
