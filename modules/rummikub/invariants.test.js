// Seeded random whole games of Rummikub played through the rules, with people as well as computer players: legal moves
// (chosen at random, so nothing here depends on how well a computer plays) mixed with illegal ones, the turn timer on a
// fake clock, people leaving in the middle, and the room saved and loaded as it goes.  After every single step the
// things rules.md promises must hold: every tile is somewhere exactly once, every set on the table is a run or a
// group, a tile on the table stays on the table, the turn goes clockwise, a refused move changes nothing, a round is
// scored the way the rules say, and nobody's view holds a rack that is not theirs.
//
// bot.test.js and ai.test.js already play computer-only games with the tile-conservation check; what they cannot see
// is a *person's* move being judged, a refusal leaving something behind, or the scoring disagreeing with the rules.
//
// Every failure names its seed and step, so a run can be repeated: `playGame(seed)`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import * as bot from './bot.js';
import { AIS } from './ai/index.js';
import { JOKER_VALUE, dealSize, isJoker, rackValue, resolveSet, tileOf, totalTiles } from './rules.js';
import { assertInvariants, seeded } from './testing.js';

const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const sum = (list) => list.reduce((a, b) => a + b, 0);
/** A set as text that is the same whatever order its tiles are in. */
const keyOf = (set) => [...set].sort((a, b) => a - b).join(',');
const RANDOM_AI = AIS.find((ai) => ai.id === 'random');
const STRANGER = 999;

/** A lobby of two to five seats with one or more people (accounts 1, 2...) and computer players in the rest. */
function newGame(rng) {
  const size = 2 + Math.floor(rng() * 4);
  const settings = {
    numbers: 7 + Math.floor(rng() * 5),
    colours: 3 + Math.floor(rng() * 3),
    wildcards: Math.floor(rng() * 3),
    rounds: 1 + Math.floor(rng() * 3),
    meld: pick(rng, [0, 10, 20, 30]),
    timer: pick(rng, [0, 0, 30]),
    playOnMeld: rng() < 0.3,
  };
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size, settings, now: 0 });
  const people = 1 + Math.floor(rng() * size);
  for (let id = 2; id <= people; id++) assert.equal(game.addHuman(room, id, `p${id}`).ok, true);
  assert.equal(game.fillWithBots(room, 1, size).ok, true);
  return room;
}

/** What the rules say a finished round pays, from the racks as they stood when it ended (rules.md, "Ending a round and scoring"). */
function expectedDeltas(room, wentOut) {
  const totals = room.racks.map((rack) => rackValue(room.settings, rack));
  if (wentOut !== null) return totals.map((total, seat) => (seat === wentOut ? sum(totals) - total : -total));
  const lowest = Math.min(...totals);
  const winners = totals.filter((total) => total === lowest).length;
  const pot = sum(totals.map((total) => total - lowest));
  return totals.map((total) => (total === lowest ? Math.floor(pot / winners) : -(total - lowest)));
}

/** Every view of the room, checked against the room it was made from: a rack reaches its owner and nobody else. */
function checkViews(room, now) {
  const before = JSON.stringify(room);
  const total = totalTiles(room.settings);
  for (const id of [...room.seats.filter(game.isHuman).map((seat) => seat.id), STRANGER]) {
    const view = game.viewFor(room, id, { now });
    const me = game.seatOf(room, id);
    assert.equal(view.you, me, 'the view says where its reader sits');
    assert.deepEqual(view.rack, me === -1 ? [] : room.racks[me], 'a person is sent their own rack, and a stranger none');
    assert.equal(view.poolCount, room.pool.length, 'the pool is a count');
    assert.ok(!JSON.stringify(view).includes('"pool"'), 'the pool itself is never sent');
    assert.ok(!('racks' in view), 'the racks are never sent together');
    view.seats.forEach((seat, i) => {
      assert.equal(seat.count, room.racks[i].length, 'a seat shows how many tiles it holds');
      assert.equal(seat.score, room.scores[i], 'and its score');
      assert.ok(Object.values(seat).every((value) => !Array.isArray(value)), 'a seat shows counts, never tiles');
    });
    assert.equal(sum(view.seats.map((seat) => seat.count)) + view.poolCount + view.table.flat().length, total, 'every tile is accounted for in what a player can see');
    assert.equal(view.turn, room.turn);
    if (me === -1) assert.equal(view.drawn, null, 'a stranger drew nothing');
    for (const player of view.scoreboard.players) {
      assert.equal(sum(view.scoreboard.rounds.map((round) => round.deltas[player.id])), player.score, 'the rounds on the scoreboard add up to the score beside them');
    }
  }
  assert.equal(JSON.stringify(room), before, 'looking at a room does not change it');
}

/** Moves that must be refused whoever is to play, and must leave the room exactly as it was. */
function tryIllegalMoves(room, rng, now) {
  const seat = room.turn;
  const n = room.seats.length;
  const other = (seat + 1 + Math.floor(rng() * (n - 1))) % n;
  const rack = room.racks[seat];
  const snapshot = JSON.stringify(room);
  const refused = (result, what) => {
    assert.equal(result.ok, false, `${what} must be refused`);
    assert.equal(typeof result.error, 'string', `${what}: a refusal carries a code`);
    assert.equal(JSON.stringify(room), snapshot, `${what}: a refused move changed the room`);
  };
  refused(game.draw(room, other, now), 'drawing out of turn');
  refused(game.play(room, other, { table: room.table }, now), 'playing out of turn');
  for (const table of [undefined, null, 'x', 7, {}, [], [[]], [null], [[rack[0]]], [[rack[0], rack[0], rack[0]]], [['0', '1', '2']], [[-1, 1.5, NaN]]]) {
    refused(game.play(room, seat, { table }, now), `a table of ${JSON.stringify(table)}`);
  }
  refused(game.play(room, seat, undefined, now), 'a play with no arguments');
  refused(game.play(room, seat, { table: room.table.map((set) => [...set]) }, now), 'the table as it is, with nothing added');
  if (room.table.length) {
    refused(game.play(room, seat, { table: room.table.slice(1).map((set) => [...set]) }, now), 'taking a set off the table');
  }
  // Somebody else's tiles, and tiles still in the pool: three of them that would be a perfectly good set are still not
  // this player's to lay down.
  for (const [source, what] of [[room.racks[other], 'another rack'], [room.pool, 'the pool']]) {
    for (let i = 0; i + 2 < source.length && i < 12; i++) {
      const borrowed = [source[i], source[i + 1], source[i + 2]];
      refused(game.play(room, seat, { table: [...room.table.map((set) => [...set]), borrowed] }, now), `a set of tiles from ${what}`);
    }
  }
  refused(game.next(room, seat, rng, now), 'Continue during a round');
  refused(game.forceNext(room, rng, now), 'forcing the next round during a round');
  refused(game.timeout(room, room.deadline === null ? now + 1e9 : room.deadline - 1), 'the timer before the turn has run out');
  refused(game.start(room, room.hostId, rng, now), 'starting a game that has started');
  refused(game.setSettings(room, room.hostId, { rounds: 2 }), 'changing the settings mid-game');
  refused(game.playAgain(room, room.hostId), 'playing again before the game is over');
}

/**
 * Plays one seeded game to the end, checking everything after every step.
 * @param {number} seed
 * @returns {{ room: object, steps: number, reasons: string[], left: number, timedOut: number }}
 */
function playGame(seed) {
  const rng = seeded(seed);
  let room = newGame(rng);
  let now = 1000;
  let step = 0;
  const seen = { reasons: [], left: 0, timedOut: 0 };
  let passes = 0; // turns passed in a row with the pool empty, counted here rather than read from the room
  try {
    assert.equal(game.start(room, 1, rng, now).ok, true);
    const n = room.seats.length;
    const s = room.settings;
    const hand = dealSize(s, n);

    /** A round has just been dealt: everybody holds a hand, the table is clear, and the first player is to move. */
    const checkDeal = (round, first) => {
      assert.equal(room.phase, 'playing');
      assert.equal(room.round, round, 'rounds are numbered one after another');
      if (first !== null) assert.equal(room.first, first, 'the first player moves along one seat each round');
      assert.equal(room.turn, room.first, 'the first player starts');
      assert.ok(room.racks.every((rack) => rack.length === hand), `everybody is dealt ${hand}`);
      assert.deepEqual(room.table, [], 'a round starts with a clear table');
      assert.equal(room.pool.length, totalTiles(s) - n * hand, 'the rest is the pool');
      assert.ok(room.melded.every((melded) => melded === false), 'nobody has melded yet');
      passes = 0;
    };

    /** The round has just ended: it was scored as the rules say, and the game is over after the last one. */
    const checkRoundEnd = (scoresBefore, wentOut) => {
      const deltas = expectedDeltas(room, wentOut);
      room.scores.forEach((score, seat) => assert.equal(score - scoresBefore[seat], deltas[seat], `seat ${seat} was paid what the rules say for the round`));
      assert.equal(room.history.length, room.round, 'one line of scores for each round played');
      seen.reasons.push(wentOut === null ? 'blocked' : 'out');
      if (room.round < s.rounds) return assert.equal(room.phase, 'between', 'there are rounds still to play');
      assert.equal(room.phase, 'finished', 'the game ends after the last round');
      const best = Math.max(...room.scores);
      assert.deepEqual([...room.winners].sort(), room.scores.flatMap((score, seat) => (score === best ? [seat] : [])), 'the highest total wins, and a tie is shared');
    };

    /** One turn by `seat`, made by `act`, checked against what the rules allow a turn to do. */
    const takeTurn = (seat, act) => {
      const before = { table: room.table.map((set) => [...set]), racks: room.racks.map((rack) => [...rack]), pool: [...room.pool], melded: room.melded[seat], scores: [...room.scores] };
      const result = act();
      assert.equal(result.ok, true, `a legal turn was refused: ${result.error}`);
      const onTable = new Set(room.table.flat());
      const wasOnTable = new Set(before.table.flat());
      const added = [...onTable].filter((id) => !wasOnTable.has(id));
      const grew = room.racks[seat].length - before.racks[seat].length;
      room.racks.forEach((rack, i) => i !== seat && assert.deepEqual(rack, before.racks[i], 'nobody else\'s rack changes on your turn'));
      if (added.length) {
        // A play.
        passes = 0;
        for (const set of room.table) assert.equal(resolveSet(s, set).ok, true, `every set on the table is a run or a group: ${JSON.stringify(set)}`);
        for (const id of wasOnTable) assert.ok(onTable.has(id), `tile ${id} was on the table and must stay on it`);
        for (const id of added) assert.ok(before.racks[seat].includes(id), `tile ${id} was laid from somewhere other than the player's own rack`);
        assert.deepEqual([...room.racks[seat]].sort((a, b) => a - b), before.racks[seat].filter((id) => !added.includes(id)).sort((a, b) => a - b), 'the rack lost exactly the tiles laid');
        assert.deepEqual(room.pool, before.pool, 'a play does not touch the pool');
        if (!before.melded) {
          const old = new Set(before.table.map(keyOf));
          const fresh = room.table.filter((set) => !old.has(keyOf(set)));
          const ownOnly = fresh.filter((set) => set.every((id) => added.includes(id)));
          assert.ok(sum(ownOnly.map((set) => resolveSet(s, set).value)) >= s.meld, `a first meld is worth at least ${s.meld} in sets of the player's own tiles`);
          if (!s.playOnMeld) for (const key of old) assert.ok(room.table.some((set) => keyOf(set) === key), 'before melding, the sets already on the table stay exactly as they are');
        }
        assert.equal(room.melded[seat], true, 'whoever has laid tiles has melded');
      } else {
        // A draw, or a pass once the pool is empty.
        assert.deepEqual(room.table, before.table, 'drawing leaves the table alone');
        if (before.pool.length) {
          passes = 0;
          assert.equal(grew, 1, 'a draw is one tile');
          const drawn = room.racks[seat].filter((id) => !before.racks[seat].includes(id));
          assert.equal(drawn.length, 1);
          assert.ok(before.pool.includes(drawn[0]), 'and it comes from the pool');
          assert.equal(room.pool.length, before.pool.length - 1);
        } else {
          passes++;
          assert.equal(grew, 0, 'with the pool empty a draw is a pass');
        }
      }
      const wentOut = room.racks[seat].length === 0;
      const blocked = !added.length && !room.pool.length && passes >= n;
      if (wentOut || blocked) {
        assert.notEqual(room.phase, 'playing', wentOut ? 'emptying the rack ends the round' : 'everybody passing with the pool empty ends the round');
        checkRoundEnd(before.scores, wentOut ? seat : null);
      } else {
        assert.equal(room.phase, 'playing', 'the round goes on');
        assert.equal(room.turn, (seat + 1) % n, 'play goes clockwise, one seat at a time');
      }
    };

    /** A legal turn for a person, chosen at random: a draw, or whatever a random or the standard logic finds to lay. */
    const personTurn = (seat) => {
      if (rng() < 0.2) return game.draw(room, seat, now);
      const ai = rng() < 0.5 ? RANDOM_AI : AIS[0];
      const plan = ai.plan(bot.situation(room, seat), seat, { rng });
      return plan ? game.play(room, seat, { table: plan.table }, now) : game.draw(room, seat, now);
    };

    checkDeal(1, null);
    while (room.phase !== 'finished') {
      step++;
      assert.ok(step < 6000, 'the game must end');
      now += 1 + Math.floor(rng() * 500);
      const people = room.seats.flatMap((seat, i) => (game.isHuman(seat) ? [i] : []));

      if (rng() < 0.01 && people.length > 1) {
        // Somebody walks out: a computer player takes the seat and keeps the rack, and a person is still the host.
        const seat = pick(rng, people);
        const leaver = room.seats[seat].id;
        const rack = [...room.racks[seat]];
        const round = room.round;
        const result = game.removeHuman(room, leaver, rng, now);
        assert.deepEqual([result.ok, result.empty, result.replaced], [true, false, true]);
        assert.equal(game.isBot(room.seats[seat]), true, 'a computer player took the seat');
        if (room.round === round) assert.deepEqual(room.racks[seat], rack, 'and kept the rack');
        assert.ok(game.isHuman(room.seats[game.seatOf(room, room.hostId)]), 'the host is still a person');
        assert.equal(game.hasPlayer(room, leaver), false);
        seen.left++;
        if (room.round !== round) checkDeal(round + 1, null); // they were the last one the table was waiting for
      } else if (room.phase === 'between') {
        const round = room.round;
        const first = room.first;
        const snapshot = JSON.stringify(room);
        for (const result of [game.draw(room, first, now), game.play(room, first, { table: [] }, now), game.next(room, -1, rng, now), game.next(room, n + 3, rng, now)]) {
          assert.equal(result.ok, false, 'no turns between rounds, and Continue is for the people at the table');
        }
        assert.equal(JSON.stringify(room), snapshot, 'a refused move changed the room');
        if (rng() < 0.2) assert.equal(game.forceNext(room, rng, now).ok, true, 'the wait ran out');
        else {
          const seat = pick(rng, people.filter((i) => !room.ready.includes(i))); // somebody who has yet to press Continue
          assert.equal(game.next(room, seat, rng, now).ok, true);
          const everyone = people.every((i) => room.ready.includes(i)) || room.phase === 'playing';
          assert.equal(room.phase === 'playing', everyone && room.round === round + 1, 'the next round starts when every person is ready, and not before');
        }
        if (room.phase === 'playing') checkDeal(round + 1, (first + 1) % n);
      } else {
        const seat = room.turn;
        if (rng() < 0.3) tryIllegalMoves(room, rng, now);
        if (room.deadline !== null && rng() < 0.15) {
          // The turn timer runs out: the player draws, exactly as if they had pressed the button.
          now = room.deadline + Math.floor(rng() * 50);
          takeTurn(seat, () => game.timeout(room, now));
          seen.timedOut++;
        } else if (game.isBot(room.seats[seat])) {
          assert.deepEqual(bot.pendingAction(room), { type: 'turn', seat });
          takeTurn(seat, () => bot.runPending(room, rng, now));
        } else {
          assert.equal(bot.pendingAction(room), null, 'the computer players wait for a person');
          takeTurn(seat, () => personTurn(seat));
        }
      }

      assertInvariants(room, 'after the step');
      if (step % 7 === 0) checkViews(room, now);
      if (step % 31 === 0) {
        // The room is saved as JSON; what comes back must be the same room, and the game carries on from the copy.
        const loaded = JSON.parse(JSON.stringify(room));
        assert.deepEqual(loaded, room, 'a saved room loads as it was');
        room = loaded;
      }
    }

    checkViews(room, now);
    const rows = game.statsPlayers(room);
    const people = room.seats.flatMap((seat, i) => (game.isHuman(seat) ? [i] : []));
    assert.deepEqual(rows.map((row) => row.userId), people.map((i) => room.seats[i].id), 'the statistics have a row for each person still seated, and none for a computer player');
    rows.forEach((row, at) => {
      const seat = people[at];
      assert.equal(row.outcome, room.winners.includes(seat) ? 'win' : 'loss');
      assert.equal(row.score, room.scores[seat]);
      assert.equal(row.placement, 1 + room.scores.filter((score) => score > room.scores[seat]).length, 'a place is one more than the number who did better');
      assert.equal(row.extras.roundsPlayed, s.rounds);
    });
  } catch (error) {
    error.message = `seed ${seed}, step ${step}: ${error.message}`;
    throw error;
  }
  return { room, steps: step, ...seen };
}

test('random games with people in them: every step keeps the tiles, the table, the turn order, and the scoring as the rules say', () => {
  let steps = 0;
  const reasons = new Set();
  let left = 0;
  let timedOut = 0;
  const GAMES = 40;
  for (let seed = 1; seed <= GAMES; seed++) {
    const result = playGame(seed);
    steps += result.steps;
    for (const reason of result.reasons) reasons.add(reason);
    left += result.left;
    timedOut += result.timedOut;
  }
  // The run has to have gone where the checks are, or passing means nothing.
  assert.deepEqual([...reasons].sort(), ['blocked', 'out'], 'rounds ended both ways: somebody going out, and everybody passing');
  assert.ok(left > 0, 'somebody left mid-game');
  assert.ok(timedOut > 0, 'the turn timer ran out on somebody');
  console.log(`  ${GAMES} games, ${steps} steps, ${left} people left mid-game, ${timedOut} turns timed out`);
});

test('a game is the same game every time for a seed: the rules use only the random numbers and the clock they are given', () => {
  for (const seed of [3, 17]) assert.equal(JSON.stringify(playGame(seed).room), JSON.stringify(playGame(seed).room), `seed ${seed}`);
});

test('a wildcard left in a rack costs thirty, and every other tile its number', () => {
  // The scoring above leans on rackValue, so it is pinned here to the rule itself rather than to itself.
  const s = { numbers: 13, colours: 4, wildcards: 2 };
  for (let id = 0; id < totalTiles(s); id++) {
    const expected = isJoker(s, id) ? JOKER_VALUE : tileOf(s, id).number;
    assert.equal(rackValue(s, [id]), expected);
  }
  assert.equal(JOKER_VALUE, 30);
  assert.equal(rackValue(s, [0, 12, 104]), 1 + 13 + 30, 'a 1, a 13, and a wildcard');
});

test('settings that are refused leave the lobby exactly as it was, the number of seats included', () => {
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', now: 0 });
  const seats = room.seats.length;
  const result = game.setSettings(room, 1, { size: 3, numbers: 'lots' });
  assert.equal(result.ok, false, 'a setting that is not a number is refused');
  assert.equal(room.seats.length, seats, 'and the table is the size it was');
});
