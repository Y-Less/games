// Seeded random whole games of Draw! played through the rules: people (and strangers) choosing, guessing right, nearly
// right, and nonsense, in any order and at the wrong moments, the clock running out, computer players doing their
// part, and people leaving, being removed, and arriving late.  After every step the things rules.md promises must
// hold: two players draw each turn and every pair draws as often as the host asked, the first drawing named ends the
// turn and scores a point for that drawer and that guesser and nobody else, a drawer never guesses, the scores are
// the scoreboard added up, a refused action changes nothing, and nothing in the room still names somebody who has gone.
//
// game.test.js stages each rule once; this is the same rules meeting each other in every order a seed can find.
// Every failure names its seed and step, so a run can be repeated: `playGame(seed)`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';

const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const sum = (list) => list.reduce((a, b) => a + b, 0);
const STRANGER = 999;
const PLACES = [0, 1, 2, 0, 1, -1, 99, 1.5, null, undefined, 'x', '', '   ', {}];
const NONSENSE = ['qqqq zzzz', '', '   ', null, undefined, {}, [], 'x'.repeat(200), 'two\nlines', 7];

/** A lobby of three to eight players: one or more people (accounts 1, 2...) and computer players for the rest. */
function newGame(rng) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Zeb1', settings: { rounds: pick(rng, [1, 1, 2]), wordChoices: pick(rng, [2, 3, 5]) }, now: 0 });
  const size = pick(rng, [3, 3, 4, 4, 5, 6, 8]);
  const people = 1 + Math.floor(rng() * size);
  for (let id = 2; id <= people; id++) assert.equal(game.addHuman(room, id, `Zeb${id}`).ok, true);
  assert.equal(game.fillWithBots(room, 1, size).ok, true);
  assert.equal(room.players.length, size);
  return room;
}

/** The order of play: every pair of players as many times as the host asked, and nobody three turns running. */
function checkOrder(room) {
  const ids = room.players.map((p) => p.id);
  const times = new Map();
  room.order.forEach((pair, turn) => {
    assert.equal(pair.length, 2, 'two players draw each turn');
    assert.notEqual(pair[0], pair[1], 'and they are two different players');
    for (const id of pair) assert.ok(ids.includes(id), `turn ${turn + 1} is drawn by ${id}, who is not at the table`);
    const key = [...pair].map(String).sort().join(' & ');
    times.set(key, (times.get(key) ?? 0) + 1);
    if (turn >= 2) for (const id of pair) assert.ok(!(room.order[turn - 1].includes(id) && room.order[turn - 2].includes(id)), `${id} draws three turns running`);
  });
  const pairs = (ids.length * (ids.length - 1)) / 2;
  assert.equal(times.size, pairs, 'every pair of players draws against each other');
  for (const [pair, count] of times) assert.equal(count, room.rounds, `${pair} draw together once a round`);
}

/** Everything that must be true of a room whatever has just happened. */
function checkRoom(room) {
  const ids = room.players.map((p) => p.id);
  const slots = new Map(room.players.map((p) => [p.slot, p]));
  assert.equal(new Set(ids).size, ids.length, 'nobody is at the table twice');
  assert.equal(slots.size, ids.length, 'nobody shares a place');
  assert.ok(['choosing', 'drawing', 'between', 'finished'].includes(room.phase), `a phase the game has: ${room.phase}`);
  assert.ok(room.players.some(game.isHuman), 'a person is still at the table');
  assert.ok(game.isHuman(room.players.find((p) => p.id === room.hostId)), 'and one of them is the host');
  assert.ok(room.turn >= 0 && room.turn < room.order.length, 'the turn is one of the turns of the game');
  const drawers = game.drawersOf(room);

  // Nothing the room has written down names somebody who is not at the table (a place changes hands by renaming).
  for (const [what, table] of [['words', room.words], ['choices', room.choices], ['preChoice', room.preChoice], ['reveal.words', room.reveal?.words ?? {}]]) {
    for (const key of Object.keys(table)) assert.ok(ids.map(String).includes(key), `${what} names ${key}, who is not at the table`);
  }
  for (const winner of [room.winner, room.reveal?.winner]) {
    if (winner) for (const id of [winner.drawer, winner.guesser]) assert.ok(ids.includes(id), `the winner names ${id}, who is not at the table`);
  }

  if (room.phase === 'choosing') {
    const offered = drawers.flatMap((id) => room.choices[id] ?? []);
    assert.equal(new Set(offered).size, offered.length, 'no word is offered to both drawers, or twice to one');
    for (const word of offered) if (!Object.values(room.words).includes(word)) assert.ok(!room.used.includes(word), `"${word}" has been played this game and is offered again`);
    for (const id of drawers) if (!room.words[id]) assert.equal(room.choices[id].length, room.wordChoices, 'a drawer is offered as many words as the host asked for');
    assert.ok(drawers.some((id) => !room.words[id]), 'the drawing starts once both have chosen');
  }
  if (room.phase === 'drawing') {
    const words = drawers.map((id) => room.words[id]);
    assert.ok(words.every((word) => typeof word === 'string' && word.length > 0), 'both drawers have a word to draw');
    assert.notEqual(words[0], words[1], 'each a word of their own');
    assert.equal(room.winner, null, 'nobody has named a drawing yet');
  }
  assert.equal(new Set(room.used).size, room.used.length, 'no word is played twice in a game');

  // The scores: one row of the scoreboard for every turn that has ended, and a player's score is their rows added up.
  const ended = room.turn + (['between', 'finished'].includes(room.phase) ? 1 : 0);
  assert.equal(room.history.length, ended, 'one line on the scoreboard for each turn that has ended');
  for (const row of room.history) {
    const scored = Object.values(row.deltas).filter((points) => points !== 0);
    assert.ok(scored.length === 0 || scored.length === 2, 'a turn scores for two players or for nobody');
    assert.ok(scored.every((points) => points === 1), 'a point each');
  }
  for (const player of room.players) {
    assert.equal(player.score, sum(room.history.map((row) => row.deltas[player.slot] ?? 0)), `${player.id}: the score is the scoreboard added up`);
    assert.equal(player.drawn, player.wasNamed + player.wentUnnamed, `${player.id}: every drawing was named or was not`);
    assert.equal(player.score, player.wasNamed + player.guessedFirst, `${player.id}: a point for each drawing of theirs that was named, and each they named first`);
  }
  assert.equal(sum(room.players.map((p) => p.wasNamed)), sum(room.players.map((p) => p.guessedFirst)), 'every drawing named was named by somebody');
  assert.ok(room.feed.every((line, n) => n === 0 || line.n > room.feed[n - 1].n), 'the guess panel is in order');
  if (room.phase === 'finished') assert.equal(room.turn, room.order.length - 1, 'the game ends after the last pair has drawn');
}

/**
 * Plays one seeded game, checking everything after every step.
 * @param {number} seed
 * @returns {{ room: object, steps: number, finished: boolean, seen: Record<string, number> }}
 */
function playGame(seed) {
  const rng = seeded(seed);
  let room = newGame(rng);
  let step = 0;
  let now = 1000;
  let nextId = 100; // accounts that turn up after the start
  const barred = [];
  const seen = { named: 0, unnamed: 0, clockChose: 0, left: 0, joined: 0, kicked: 0, skipped: 0, refused: 0 };
  try {
    assert.equal(game.start(room, 1, rng, now).ok, true);
    assert.equal(room.order.length, ((room.players.length * (room.players.length - 1)) / 2) * room.rounds, 'a round is every pair of players having drawn once');
    assert.deepEqual([room.phase, room.turn], ['choosing', 0]);
    checkOrder(room);
    checkRoom(room);

    /** A turn has just ended: the row it added to the scoreboard is what the rules say it scores. */
    const checkTurnEnd = (before, expected) => {
      assert.equal(room.phase, 'between', 'both words go up, and the game waits a moment');
      const row = room.history.at(-1);
      const scorers = room.players.filter((p) => row.deltas[p.slot] === 1).map((p) => p.id);
      assert.deepEqual(scorers.sort(), expected ? [expected.drawer, expected.guesser].sort() : [], expected ? 'that drawer and that guesser each score a point, and nobody else' : 'nobody named either drawing, so nobody scores');
      for (const player of room.players) assert.equal(player.score, before.scores.get(player.id) + (scorers.includes(player.id) ? 1 : 0));
      assert.deepEqual(room.reveal.words, before.words, 'both words are shown');
      if (expected) seen.named++;
      else seen.unnamed++;
    };
    const snapshot = () => ({ phase: room.phase, turn: room.turn, drawers: [...game.drawersOf(room)], words: { ...room.words }, choices: JSON.parse(JSON.stringify(room.choices)), scores: new Map(room.players.map((p) => [p.id, p.score])), feed: room.feed.length });

    while (room.phase !== 'finished' && step < 700) {
      step++;
      now += Math.floor(rng() * 1500);
      const before = snapshot();
      const text = JSON.stringify(room);
      const ids = room.players.map((p) => p.id);
      const people = room.players.filter(game.isHuman).map((p) => p.id);
      const actor = pick(rng, [...ids, ...ids, STRANGER]);
      const roll = rng();
      /** @type {{ ok: boolean, error?: string } | null} */
      let result = null;

      if (roll < 0.012 && people.length > 1) {
        // Somebody walks out: a computer player takes their place, score, word, and all.
        const leaver = pick(rng, people);
        const was = room.players.find((p) => p.id === leaver);
        const kept = { slot: was.slot, score: was.score, drew: before.drawers.indexOf(leaver), word: room.words[leaver] };
        const outcome = game.removeHuman(room, leaver, rng, now);
        assert.deepEqual([outcome.ok, outcome.empty, outcome.replaced], [true, false, true]);
        const stand = room.players.find((p) => p.slot === kept.slot);
        assert.equal(game.isBot(stand), true, 'a computer player took their place');
        assert.equal(stand.score, kept.score, 'with their score');
        assert.equal(game.drawersOf(room).indexOf(stand.id), kept.drew, 'and their place in the order, on the same board');
        assert.equal(room.words[stand.id], kept.word, 'and carries on with the word they had');
        checkOrder(room);
        seen.left++;
      } else if (roll < 0.024) {
        // Somebody arrives late: they take a computer player's place the same way round, or are told the table is full.
        const bots = room.players.filter(game.isBot);
        const id = nextId++;
        const outcome = game.addHuman(room, id, `Late${id}`);
        assert.equal(outcome.ok, bots.length > 0, 'a latecomer takes a computer player\'s place if there is one');
        if (outcome.ok) {
          const took = bots.find((b) => !room.players.some((p) => p.id === b.id));
          const me = room.players.find((p) => p.id === id);
          assert.deepEqual([me.slot, me.score], [took.slot, took.score], 'its place and its score');
          assert.equal(room.words[id], before.words[took.id], 'and its word');
          checkOrder(room);
          seen.joined++;
        } else result = outcome;
      } else if (roll < 0.032 && people.length > 1) {
        // The host removes somebody: as leaving, and the invitation no longer lets them back in.
        const target = room.players.find((p) => game.isHuman(p) && p.id !== room.hostId);
        const outcome = game.kick(room, room.hostId, target.slot, rng, now);
        assert.deepEqual([outcome.ok, outcome.userId, outcome.replaced], [true, target.id, true]);
        assert.equal(game.hasPlayer(room, target.id), false);
        barred.push(target.id);
        checkOrder(room);
        seen.kicked++;
      } else if (roll < 0.04 && barred.length) {
        result = game.addHuman(room, pick(rng, barred), 'Back');
        assert.equal(result.ok, false, 'somebody the host removed does not come back');
      } else if (roll < 0.05) {
        // Things only the lobby allows, and things only the host may do.
        result = pick(rng, [
          () => game.start(room, room.hostId, rng, now),
          () => game.setSettings(room, room.hostId, { rounds: 3 }),
          () => game.addBot(room, room.hostId),
          () => game.fillWithBots(room, room.hostId, 8),
          () => game.playAgain(room, people.find((id) => id !== room.hostId) ?? STRANGER),
          () => game.kick(room, STRANGER, room.players[0].slot, rng, now),
          () => game.kick(room, room.hostId, room.players.find((p) => p.id === room.hostId).slot, rng, now),
          () => game.removeHuman(room, STRANGER, rng, now),
        ])();
        assert.equal(result.ok, false, 'a lobby action, or a host\'s action by somebody else, is refused mid-game');
      } else if (roll < 0.06 && ['choosing', 'drawing'].includes(room.phase)) {
        // Neither drawer is there to draw (the server decides that): the turn is given up, and nobody scores.
        assert.equal(game.skipTurn(room, now).ok, true);
        checkTurnEnd(before, null);
        seen.skipped++;
      } else if (roll < 0.25 || (room.phase === 'between' && roll < 0.6)) {
        // The clock runs out on whatever the room was waiting for.
        now = Math.max(now, room.deadline);
        const outcome = game.timeUp(room, rng, now);
        assert.equal(outcome.ok, true);
        if (before.phase === 'choosing') {
          assert.equal(room.phase, 'drawing', 'dither, and the game picks for you');
          for (const drawer of before.drawers) {
            if (before.words[drawer]) assert.equal(room.words[drawer], before.words[drawer], 'a word already chosen stands');
            else {
              assert.ok(before.choices[drawer].includes(room.words[drawer]), 'the clock picks one of the words that drawer was offered');
              seen.clockChose++;
            }
          }
          assert.equal(room.deadline, now + room.drawTime * 1000, 'the drawing lasts as long as the host set');
        } else if (before.phase === 'drawing') checkTurnEnd(before, null);
        else if (before.turn + 1 < room.order.length) assert.deepEqual([room.phase, room.turn], ['choosing', before.turn + 1], 'the next pair draw');
        else assert.deepEqual([room.phase, outcome.finished], ['finished', true], 'the last pair have drawn: the game is over');
      } else if (game.pendingBotAction(room) && roll < 0.5) {
        // A computer player picks its word, or has a guess (which may be right).
        const action = game.pendingBotAction(room);
        assert.equal(game.isBot(room.players.find((p) => p.id === action.id)), true, 'only a computer player is moved by the server');
        assert.equal(game.runBotAction(room, rng, now, action), true, 'a computer player\'s move is always one the rules accept');
        if (action.type === 'word') assert.ok(before.choices[action.id].includes(room.words[action.id]), 'it picked one of the words it was offered');
        else if (room.phase === 'between') checkTurnEnd(before, { drawer: room.reveal.winner.drawer, guesser: action.id });
      } else if (room.phase === 'choosing' && roll < 0.75) {
        const place = pick(rng, PLACES);
        result = game.chooseWord(room, actor, place, now);
        const mayChoose = before.drawers.includes(actor) && !before.words[actor];
        if (!mayChoose) assert.equal(result.ok, false, 'only a drawer who has not chosen yet may choose');
        else if (Number.isInteger(place) && place >= 0 && place < before.choices[actor].length) {
          assert.equal(result.ok, true, result.error);
          assert.equal(room.words[actor], before.choices[actor][place], 'the word they picked');
          const other = before.drawers.find((id) => id !== actor);
          assert.equal(room.phase, before.words[other] ? 'drawing' : 'choosing', 'the drawing starts once both have chosen, so neither gets a head start');
        } else assert.equal(result.ok, false, `there is no word number ${JSON.stringify(place)}: a blank or nonsense choice picks nothing`);
      } else {
        // A guess: one of the two words, something close to one, or nonsense.
        const target = pick(rng, before.drawers);
        const word = before.words[target];
        const kind = rng();
        const guessed = word && kind < 0.3 ? word : word && kind < 0.45 ? word.toUpperCase() : word && kind < 0.6 ? `${word}s` : pick(rng, NONSENSE);
        result = game.guess(room, actor, guessed, now);
        const mayGuess = before.phase === 'drawing' && ids.includes(actor) && !before.drawers.includes(actor);
        if (!mayGuess) assert.equal(result.ok, false, before.drawers.includes(actor) ? 'the two drawers do not type' : 'only a guesser may guess, and only while the drawings are being drawn');
        else if (result.ok && result.quality === 'exact') {
          const named = before.drawers.find((id) => before.words[id] === room.reveal.winner.word);
          assert.equal(room.reveal.winner.drawer, named);
          checkTurnEnd(before, { drawer: named, guesser: actor });
        } else if (result.ok) {
          assert.equal(room.phase, 'drawing', 'a guess that names neither drawing leaves the turn going');
          assert.equal(room.feed.at(-1).id, actor, 'and is shown in the guess panel');
          for (const player of room.players) assert.equal(player.score, before.scores.get(player.id), 'nobody scores for a wrong guess');
        }
        // Naming a word exactly, as it is written or in capitals, is always enough (unless they are typing too fast).
        if (mayGuess && word && kind < 0.45 && result.error !== 'tooFast') assert.deepEqual([result.ok, result.quality], [true, 'exact'], 'the first to name either drawing ends the turn');
      }

      if (result && result.ok === false) {
        seen.refused++;
        assert.equal(typeof result.error, 'string', 'a refusal carries a code');
        // (Being told you are typing too fast is the one refusal that keeps a note: of when you last typed.)
        if (result.error !== 'tooFast') assert.equal(JSON.stringify(room), text, `a refused action (${result.error}) changed the room`);
      }
      checkRoom(room);
      if (step % 37 === 0) {
        // The room is saved as JSON and brought up to date on loading; what comes back must be the same room.
        const loaded = game.migrate(JSON.parse(JSON.stringify(room)));
        assert.deepEqual(loaded, room, 'a saved room loads as it was');
        room = loaded;
      }
    }

    if (room.phase === 'finished') {
      const best = Math.max(...room.players.map((p) => p.score));
      const rows = game.statsPlayers(room);
      const people = room.players.filter(game.isHuman);
      assert.deepEqual(rows.map((row) => row.userId).sort(), people.map((p) => p.id).sort(), 'the statistics have a row for each person, and none for a computer player');
      for (const row of rows) {
        const player = people.find((p) => p.id === row.userId);
        assert.equal(row.outcome, player.score === best ? 'win' : 'loss', 'the most points wins, and everybody on the top score wins');
        assert.equal(row.score, player.score);
        assert.equal(row.placement, 1 + room.players.filter((p) => p.score > player.score).length);
        assert.deepEqual(row.extras, { drawn: player.drawn, guessedFirst: player.guessedFirst, wasNamed: player.wasNamed, wentUnnamed: player.wentUnnamed });
      }
    }
  } catch (error) {
    error.message = `seed ${seed}, step ${step}: ${error.message}`;
    throw error;
  }
  return { room, steps: step, finished: room.phase === 'finished', seen };
}

test('random legal and illegal play: every step keeps the pairs, the scoring, and the table as the rules say', () => {
  const GAMES = 300;
  let finished = 0;
  let steps = 0;
  const totals = {};
  const tables = new Set();
  for (let seed = 1; seed <= GAMES; seed++) {
    const result = playGame(seed);
    if (result.finished) finished++;
    steps += result.steps;
    tables.add(result.room.players.length);
    for (const [key, value] of Object.entries(result.seen)) totals[key] = (totals[key] ?? 0) + value;
  }
  // The run has to have gone where the checks are, or passing means nothing.
  assert.deepEqual([...tables].sort(), [3, 4, 5, 6, 8], 'tables from the smallest to the largest were played');
  for (const key of ['named', 'unnamed', 'clockChose', 'left', 'joined', 'kicked', 'skipped', 'refused']) assert.ok(totals[key] > 0, `the games included ${key}`);
  assert.ok(finished > GAMES / 2, `most of the games were played to the end (${finished} of ${GAMES})`);
  console.log(`  ${GAMES} games (${finished} finished), ${steps} steps: ${JSON.stringify(totals)}`);
});

test('a game is the same game every time for a seed: the rules use only the random numbers and the clock they are given', () => {
  for (const seed of [6, 40, 91]) assert.equal(JSON.stringify(playGame(seed).room), JSON.stringify(playGame(seed).room), `seed ${seed}`);
});

test('a person replaced between turns is renamed everywhere the room names them, the two words being shown included', () => {
  const rng = seeded(1);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Zeb1', now: 0 });
  game.addHuman(room, 2, 'Zeb2');
  game.addHuman(room, 3, 'Zeb3');
  assert.equal(game.start(room, 1, rng, 0).ok, true);
  for (const drawer of game.drawersOf(room)) assert.equal(game.chooseWord(room, drawer, 0, 0).ok, true);
  assert.equal(game.timeUp(room, rng, 1e6).ok, true, 'the drawing ran out of time');
  assert.equal(room.phase, 'between');
  const leaver = game.drawersOf(room).find((id) => id !== room.hostId);
  assert.equal(game.removeHuman(room, leaver, rng, 1e6).ok, true);
  const ids = room.players.map((p) => p.id);
  assert.ok(!ids.includes(leaver));
  for (const id of room.reveal.drawers) assert.ok(ids.includes(id), `the reveal still names ${id}, who has left`);
  assert.deepEqual(game.viewFor(room, 1).reveal.drawers, game.drawersOf(room), 'what everybody is sent names the two who are drawing now');
});

test('settings that are refused leave the lobby exactly as it was, the number of players included', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Zeb1', now: 0 });
  const size = room.size;
  const result = game.setSettings(room, 1, { size: 4, rounds: 99 });
  assert.equal(result.ok, false, 'ninety-nine rounds is out of bounds');
  assert.equal(room.size, size, 'and the room is for as many as it was');
});
