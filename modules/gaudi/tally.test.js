// What Gaudi records for the statistics and the achievements when a game ends (tally.js, game.js statsPlayers, and
// module.json "stats" and "achievements").
//
// Gaudi keeps its counters on the seat as the game goes along, so there is no tally object to test on its own: what
// is protected here is the record of whole games.  Over a hundred seeded games are played through the rules - dice
// placed, tools used, turns taken back with Undo - while this test keeps its own book of what each seat did, and at
// the end the record must say exactly that, for the people only, with a score that is the one rules.md describes
// (public objectives, plus the private one, plus a point a favour token, minus a point an empty space).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as game from './game.js';
import { STAT_KEYS } from './tally.js';
import { CELLS, patternOf } from './rules.js';
import { assertInvariants, driveStep, seeded } from './testing.js';

const manifest = JSON.parse(fs.readFileSync(new URL('./module.json', import.meta.url), 'utf8'));
/** The statistics the site keeps for every game by itself (server/stats.js), which an achievement may also count. */
const SITE_STATS = ['played', 'wins', 'losses', 'draws', 'totalScore', 'bestScore'];

test('the statistics a game records are exactly the ones module.json declares, and every achievement counts one that exists', () => {
  const declared = manifest.stats.map((stat) => stat.key);
  assert.deepEqual([...declared].sort(), [...STAT_KEYS].sort(), 'tally.js and module.json name the same statistics');
  assert.equal(new Set(declared).size, declared.length, 'no statistic is declared twice');
  assert.deepEqual(game.STAT_KEYS, STAT_KEYS, 'the rules hand on the same list');
  for (const achievement of manifest.achievements) {
    if (achievement.stat !== undefined) assert.ok([...declared, ...SITE_STATS].includes(achievement.stat), `"${achievement.name}" counts ${achievement.stat}, which nothing records`);
  }
});

/**
 * Plays one seeded game to its end, with people in some seats and computer players in the rest, taking a turn back
 * with Undo now and then, and keeps a book of what every seat really did.
 * @returns {{ room: object, book: { placed: number, tools: number, kinds: Set<string> }[], people: number, undone: number }}
 */
function playedGame(seed) {
  const rng = seeded(seed);
  const size = 2 + (seed % 4);
  const people = 1 + Math.floor(rng() * size);
  const room = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'P1', size, settings: { badPrivate: seed % 3 === 0 } });
  for (let id = 2; id <= people; id++) assert.equal(game.addHuman(room, id, `P${id}`).ok, true);
  assert.equal(game.fillWithBots(room, 1).ok, true);
  assert.equal(game.start(room, 1, rng).ok, true);

  const fresh = () => ({ placed: 0, tools: 0, kinds: new Set() });
  const copy = (entry) => ({ placed: entry.placed, tools: entry.tools, kinds: new Set(entry.kinds) });
  const book = room.seats.map(fresh);
  let atTurnStart = null; // the book entry of the seat whose turn it is, as the turn began
  let undone = 0;
  for (let step = 0; step < 3000 && room.phase !== 'finished'; step++) {
    const label = `seed ${seed}, step ${step}`;
    const seat = room.phase === 'playing' ? room.turn.seat : -1;
    if (seat !== -1 && atTurnStart === null) atTurnStart = copy(book[seat]);
    const did = driveStep(room, rng);
    if (did.type === 'place') book[seat].placed++;
    if (did.type === 'tool') {
      book[seat].tools++;
      book[seat].kinds.add(did.tool);
    }
    if (did.type === 'end') atTurnStart = null;
    // "Undo turn takes the whole turn back to how it began": now and then, a turn that has done something is undone.
    if ((did.type === 'place' || did.type === 'tool') && rng() < 0.08) {
      assert.equal(game.undoTurn(room, seat).ok, true, `${label}: a turn that has done something can be taken back`);
      book[seat] = copy(atTurnStart);
      undone++;
    }
    assertInvariants(room, label);
  }
  assert.equal(room.phase, 'finished', `seed ${seed}: the game finishes`);
  return { room, book, people, undone };
}

test('whole games record for each person the dice in their window and the tools they used, and nothing a turn that was undone did', () => {
  const seen = { undone: 0, tools: 0, thrifty: 0, spenders: 0, bots: 0 };
  for (let seed = 1; seed <= 120; seed++) {
    const { room, book, people, undone } = playedGame(seed);
    const rows = game.statsPlayers(room);
    assert.deepEqual(rows.map((row) => row.userId), Array.from({ length: people }, (unused, n) => n + 1), `seed ${seed}: one row a person, none for a computer player`);
    seen.undone += undone;
    seen.bots += room.seats.length - people;

    for (const row of rows) {
      const seat = room.seats.findIndex((s) => s.id === row.userId);
      const who = `seed ${seed}, seat ${seat}`;
      const dice = room.grids[seat].filter(Boolean);
      const mine = book[seat];
      assert.deepEqual(Object.keys(row.extras).sort(), [...STAT_KEYS].sort(), `${who}: every declared statistic, and no other`);
      for (const [key, value] of Object.entries(row.extras)) assert.ok(Number.isInteger(value) && value >= 0, `${who}: ${key} is a count (${value})`);

      // A die reaches a window by being placed there, on a turn or by a tool, and only Undo takes one out again: so
      // the dice placed are the dice in the window, and never fewer than the turns that placed one.
      assert.equal(row.extras.dicePlaced, dice.length, `${who}: dice placed`);
      assert.ok(mine.placed <= dice.length, `${who}: at least the dice placed on turns that stood`);
      assert.equal(row.extras.toolsUsed, mine.tools, `${who}: tools used`);
      assert.equal(row.extras.emptySpaces, CELLS - dice.length, `${who}: empty spaces`);
      assert.equal(row.extras.perfectWindows, dice.length === CELLS ? 1 : 0, `${who}: a window with no empty space`);
      assert.ok(row.extras.perfectBoards <= row.extras.perfectWindows, `${who}: a perfect board is a full window first`);
      assert.equal(row.extras.allToolsUsed, mine.kinds.size === room.tools.length ? 1 : 0, `${who}: whether all three tools were used`);

      // "Games finished with every favour token unspent": the tokens you were given are your window's difficulty.
      const unspent = room.tokens[seat] === patternOf(room.patterns[seat]).difficulty;
      assert.equal(row.extras.thriftyGames, unspent ? 1 : 0, `${who}: whether every favour token is unspent`);
      assert.equal(unspent, mine.tools === 0, `${who}: only a tool costs a favour token`);

      // The private objective: the shades of the dice of your colour added together, or a flat 3 each.
      const ofColour = dice.filter((die) => die.c === room.privateColours[seat]);
      const privatePoints = room.settings.badPrivate ? 3 * ofColour.length : ofColour.reduce((sum, die) => sum + die.v, 0);
      assert.equal(row.extras.privateTotal, privatePoints, `${who}: points from the private objective`);

      // The score: public objectives + private objective + a point a token - a point an empty space.
      const final = room.final.players[seat];
      assert.equal(row.extras.bestPublicObjective, Math.max(0, ...final.publics.map((p) => p.points)), `${who}: the best single public objective`);
      assert.equal(row.score, final.publicTotal + privatePoints + room.tokens[seat] - (CELLS - dice.length), `${who}: the score rules.md describes`);
      assert.equal(row.outcome, room.winners.includes(seat) ? 'win' : 'loss', `${who}: the outcome`);
      assert.ok(row.placement >= 1 && row.placement <= room.seats.length, `${who}: a placement at the table`);

      seen.tools += mine.tools;
      seen.thrifty += row.extras.thriftyGames;
      seen.spenders += 1 - row.extras.thriftyGames;
    }

    // The highest score wins, and somebody always does.
    const best = Math.max(...room.final.players.map((p) => p.total));
    assert.ok(room.winners.length >= 1, `seed ${seed}: somebody won`);
    for (const seat of room.winners) assert.equal(room.final.players[seat].total, best, `seed ${seed}: a winner has the highest score`);
  }
  // The games were varied enough to have reached everything above.
  assert.ok(seen.undone > 50, `turns were taken back (${seen.undone})`);
  assert.ok(seen.tools > 0, 'tools were used');
  assert.ok(seen.thrifty > 0 && seen.spenders > 0, 'some people spent favour tokens and some kept them all');
  assert.ok(seen.bots > 0, 'and there were computer players to leave out');
});

test('somebody who left before the end is not recorded, and the computer player in their seat is not either', () => {
  const rng = seeded(11);
  const room = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'P1', size: 3 });
  for (const id of [2, 3]) assert.equal(game.addHuman(room, id, `P${id}`).ok, true);
  assert.equal(game.start(room, 1, rng).ok, true);
  for (let step = 0; step < 40; step++) driveStep(room, rng);
  assert.equal(room.phase, 'playing');
  assert.equal(game.removeHuman(room, 2, rng).ok, true);
  for (let step = 0; step < 3000 && driveStep(room, rng); step++);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(game.statsPlayers(room).map((row) => row.userId), [1, 3]);
});
