// What Cheat counts about each player (tally.js) for the statistics and the achievements: each counter on its own, the
// counters against the list module.json promises the site, the ones the table is shown while a game is on, and what is
// written down for a person when a game played over the real site ends.  An achievement is earned from these numbers
// and nothing else, so a counter that drifts hands out (or withholds) achievements without any rule being broken.
//
// game.test.js already takes the counters through the rules for a lie that stood, a brazen lie, a bad call, a clean
// getaway, an honest win, and a suit completed; those are not repeated here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RANKS } from '../../shared/cards.js';
import { launchModule, seeded, until } from '../../shared/testkit.js';
import * as game from './game.js';
import { BIG_PILE, BRAZEN_COUNT, PUBLIC_KEYS, STAT_KEYS, newTally, tallyCall, tallyCleanGetaway, tallyHand, tallyLieStood, tallyPickup, tallyPlay } from './tally.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'module.json'), 'utf8'));
process.env.CHEAT_BOT_DELAY = '0-4';

const suit = (letter) => RANKS.map((rank) => rank + letter);
/** The counters that are not zero, so a test can say everything that was counted and nothing else was. */
const counted = (tally) => Object.fromEntries(Object.entries(tally).filter(([, value]) => value !== 0));

test('a fresh tally has every counter, at zero', () => {
  const tally = newTally();
  assert.deepEqual(Object.keys(tally).sort(), [...STAT_KEYS].sort());
  assert.deepEqual(counted(tally), {});
});

test('an honest play counts for nothing; a lie is counted, and a lie with four cards is a brazen one', () => {
  const tally = newTally();
  for (const count of [1, 2, 3, 4]) tallyPlay(tally, { count, lie: false });
  assert.deepEqual(counted(tally), {}, 'telling the truth is not counted, however many cards');
  for (const count of [1, 2, 3]) tallyPlay(tally, { count, lie: true });
  assert.deepEqual(counted(tally), { liesTold: 3 });
  tallyPlay(tally, { count: 4, lie: true });
  assert.deepEqual(counted(tally), { liesTold: 4, brazenLies: 1 }, 'module.json: "Lies told with four cards"');
  assert.equal(BRAZEN_COUNT, game.MAX_PLAY, 'four is the most that can be played at once');
});

test('a call is counted for the caller, as right or wrong, and a lie caught is counted against the liar', () => {
  const caller = newTally();
  const liar = newTally();
  tallyCall(caller, liar, true);
  assert.deepEqual(counted(caller), { callsMade: 1, callsCorrect: 1 });
  assert.deepEqual(counted(liar), { liesCaught: 1 });
  const honest = newTally();
  tallyCall(caller, honest, false);
  assert.deepEqual(counted(caller), { callsMade: 2, callsCorrect: 1, badCalls: 1 }, 'a call on somebody telling the truth is a bad one');
  assert.deepEqual(counted(honest), {}, 'being wrongly accused is not counted against anybody');
});

test('a pile of thirty cards or more is a big pick-up, and twenty-nine is not', () => {
  assert.equal(BIG_PILE, 30, 'module.json: "Pick up a pile of thirty cards or more"');
  const tally = newTally();
  for (const size of [0, 1, 29]) tallyPickup(tally, size);
  assert.deepEqual(counted(tally), {});
  for (const size of [30, 31, 104]) tallyPickup(tally, size);
  assert.deepEqual(counted(tally), { bigPickups: 3 });
});

test('a lie nobody called, and going out on one, are each counted once', () => {
  const tally = newTally();
  tallyLieStood(tally);
  tallyLieStood(tally);
  tallyCleanGetaway(tally);
  assert.deepEqual(counted(tally), { liesGotAway: 2, cleanGetaways: 1 });
});

test('a whole suit is counted when it becomes whole, once for each suit, and not again while it stays whole', () => {
  const tally = newTally();
  tallyHand(tally, suit('H').slice(1), suit('H'));
  assert.equal(tally.fullSuits, 1, 'the thirteenth heart arrived');
  tallyHand(tally, suit('H'), [...suit('H'), '2C', '3C']);
  assert.equal(tally.fullSuits, 1, 'still holding it is not gathering it again');
  tallyHand(tally, ['2C'], [...suit('S'), ...suit('D'), '2C']);
  assert.equal(tally.fullSuits, 3, 'two suits completed by one pile are two');
  tallyHand(tally, suit('C').slice(0, 12), [...suit('C').slice(0, 12), ...suit('C').slice(0, 12)]);
  assert.equal(tally.fullSuits, 3, 'twelve of a suit twice over (two packs) is not all thirteen');
  tallyHand(tally, [], []);
  assert.equal(tally.fullSuits, 3);
});

test('a tally saved before a counter existed still counts (a missing counter reads as zero)', () => {
  const old = {};
  tallyPlay(old, { count: 4, lie: true });
  tallyPickup(old, 40);
  tallyLieStood(old);
  assert.deepEqual(old, { liesTold: 1, brazenLies: 1, bigPickups: 1, liesGotAway: 1 });
});

test('module.json lists exactly the statistics the game records, and every achievement is earned from one of them', () => {
  const listed = manifest.stats.map((stat) => stat.key);
  assert.equal(new Set(listed).size, listed.length, 'no statistic is listed twice');
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 3 }, now: 0 });
  game.fillWithBots(room, 1, 3);
  game.start(room, 1, seeded(1));
  room.phase = 'finished';
  room.winner = 0;
  const [row] = game.statsPlayers(room);
  assert.deepEqual(Object.keys(row.extras).sort(), [...listed].sort(), 'what is recorded for a person is what module.json says there is');
  for (const achievement of manifest.achievements) {
    if (achievement.stat !== undefined) assert.ok(listed.includes(achievement.stat), `the achievement "${achievement.key}" counts ${achievement.stat}, which is recorded`);
  }
});

test('the table is shown the public counters for each seat and none of the private ones', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 3 }, now: 0 });
  game.fillWithBots(room, 1, 3);
  assert.ok(game.viewFor(room, 1).seats.every((seat) => seat.stats === undefined), 'there is nothing to show in the lobby');
  game.start(room, 1, seeded(2));
  room.tally[1] = Object.fromEntries(STAT_KEYS.map((key, i) => [key, i + 1]));
  for (const viewer of [1, 99]) {
    const shown = game.viewFor(room, viewer).seats[1].stats;
    assert.deepEqual(Object.keys(shown).sort(), [...PUBLIC_KEYS].sort());
    for (const key of PUBLIC_KEYS) assert.equal(shown[key], room.tally[1][key]);
  }
  // The ones the table sees are the ones the statistics page shows openly; the hidden ones are for achievements.
  assert.deepEqual([...PUBLIC_KEYS].sort(), manifest.stats.filter((stat) => stat.hidden !== true).map((stat) => stat.key).sort());
});

test('through the rules: picking up a pile of thirty is counted for whoever picks it up, liar or caller, and twenty-nine is not', () => {
  const pack = game.deckFor(3);
  /** A game of three in which seat 0 is about to play onto a pile of `under` cards; returns the room. */
  const staged = (under, card) => {
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 3 }, now: 0 });
    game.fillWithBots(room, 1, 3);
    game.start(room, 1, seeded(3));
    const rest = pack.filter((c) => c !== card && c !== 'KD');
    room.pile = rest.slice(0, under);
    room.hands = [[card, 'KD'], rest.slice(under, under + 10), rest.slice(under + 10)];
    room.turn = 0;
    room.plays = 0; // the rank to claim is the Ace
    room.last = null;
    return room;
  };
  // A lie onto twenty-nine makes thirty: the liar, caught, picks them all up.
  let room = staged(29, '7H');
  assert.equal(game.playCards(room, 0, ['7H']).ok, true);
  assert.deepEqual(game.callCheat(room, 1), { ok: true, lie: true });
  assert.equal(room.hands[0].length, 31);
  assert.equal(room.tally[0].bigPickups, 1);
  assert.equal(room.tally[1].bigPickups, 0);
  // The truth onto twenty-nine: the caller, who was wrong, picks them up instead.
  room = staged(29, 'AH');
  assert.equal(game.playCards(room, 0, ['AH']).ok, true);
  assert.deepEqual(game.callCheat(room, 2), { ok: true, lie: false });
  assert.equal(room.tally[2].bigPickups, 1);
  assert.equal(room.tally[0].bigPickups, 0);
  // One fewer and it is only a pile.
  room = staged(28, '7H');
  assert.equal(game.playCards(room, 0, ['7H']).ok, true);
  assert.equal(game.callCheat(room, 1).ok, true);
  assert.equal(room.hands[0].length, 30, 'twenty-nine picked up');
  assert.equal(room.tally[0].bigPickups, 0);
});

test('over the real site: what is recorded for a person at the end is what the table was showing for their seat', async (t) => {
  const site = await launchModule(t, { id: 'cheat', moduleDir: here });
  const ann = await site.person('ann').open();
  assert.equal((await ann.call('create', { seats: 3 })).ok, true);
  assert.equal((await ann.call('fillBots', { count: 3 })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  let turns = 0;
  await until(
    async () => {
      const s = ann.state;
      if (s?.phase === 'finished') return true;
      // One card a turn, whatever the rank (so mostly lies), a call now and then, and believing every last card.
      if (s?.canPlay) await ann.call('play', { cards: [s.hand[0]] });
      else if (s?.mustRespond) await ann.call('accept');
      else if (s?.canCall && turns++ % 6 === 0) await ann.call('call');
      return false;
    },
    'the game to finish',
    { timeout: 120000 },
  );
  const final = ann.state;
  const mine = final.seats[final.you];
  const recorded = () => site.site.db.prepare('SELECT rp.outcome AS outcome, rp.score AS score, rp.extras AS extras FROM result_players rp').all();
  await until(() => recorded().length > 0, 'the game to be recorded');
  const rows = recorded();
  assert.equal(rows.length, 1, 'one row: the person, once, and no computer player');
  const extras = JSON.parse(rows[0].extras);
  assert.deepEqual(Object.keys(extras).sort(), manifest.stats.map((stat) => stat.key).sort(), 'every statistic module.json lists was written down');
  for (const key of PUBLIC_KEYS) assert.equal(extras[key], mine.stats[key], `${key} is what the table showed`);
  assert.equal(extras.callsMade, extras.callsCorrect + extras.badCalls, 'every call was right or wrong');
  assert.equal(rows[0].outcome, final.winner === final.you ? 'win' : 'loss');
  assert.equal(rows[0].score, mine.cards, 'the score is the cards left in the hand');
  assert.equal(extras.honestWins, final.winner === final.you && extras.liesTold === 0 ? 1 : 0);
  // What the person is shown on their statistics page is the same numbers.
  const shown = (await ann.stats()).perGame[0];
  assert.equal(shown.played, 1);
  for (const key of PUBLIC_KEYS) assert.equal(shown.extras.find((e) => e.key === key).value, extras[key]);
});
