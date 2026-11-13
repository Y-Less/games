// What viewFor sends (see game.js) to everybody at the table, and to somebody who is not at it, at every step of whole
// seeded games.  The two words are the whole of Draw!: a drawer may read their own and nobody may read the other, a
// guesser is shown how long each word is and never a letter of it, the words a drawer is choosing between are theirs
// alone, and a guess that was close is marked for its writer only.  A leak here is silent - the game plays correctly
// and somebody simply knows too much - so it is checked for every reader, in every phase, all the way through.
//
// game.test.js looks at one view in each phase; robustness.test.js checks a guesser's boards over the sockets.  This
// is every reader of every step, including the computer players (whose decisions are made from their own view) and
// a stranger.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { assertNoLeaks } from '../../shared/leaks.js';
import { seeded } from '../../shared/random.js';

const STRANGER = 999;
const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/**
 * A copy of a view without the things that are words but not secrets: what people are called (a computer player is
 * called Finn, and "finn" is in the word list), what they have typed into the guess panel, which is theirs to say, and
 * the name of the phase (the word list has "drawing" in it, and a drawer given that word is not leaking it to anybody
 * by the game being in the drawing phase).
 */
function withoutNamesAndTalk(view) {
  const notAWord = ['name', 'feed', 'phase', 'code'];
  const strip = (node) => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).filter(([key]) => !notAWord.includes(key)).map(([key, value]) => [key, strip(value)]));
  };
  return strip(view);
}

/** One reader's view of the room, checked against the room it was made from. */
function checkView(room, id, now) {
  const view = game.viewFor(room, id, { now });
  const who = id === STRANGER ? 'a stranger' : `player ${id}`;
  const drawers = game.drawersOf(room);
  const inTurn = ['choosing', 'drawing'].includes(room.phase);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(view)), `${who}: a view is plain JSON`);
  assert.equal(view.you, id);
  assert.equal(view.phase, room.phase);
  // (While the two words are up between turns nobody is drawing any more and nobody has started; what a view says of
  // that moment is left alone here.)
  if (inTurn) assert.equal(view.youDraw, drawers.includes(id), `${who}: told whether they are drawing`);
  if (['lobby', 'finished'].includes(room.phase)) assert.equal(view.youDraw, false, `${who}: nobody draws outside a turn`);

  // The words: nothing a reader may not have is anywhere in what they are sent.
  if (inTurn) {
    const forbidden = [];
    for (const drawer of drawers) {
      if (drawer === id) continue;
      if (room.words[drawer]) forbidden.push({ text: room.words[drawer], why: `was sent "${room.words[drawer]}", the word ${drawer} is drawing` });
      for (const offered of room.choices[drawer] ?? []) forbidden.push({ text: offered, why: `was sent "${offered}", a word ${drawer} was offered` });
    }
    // A drawer who has yet to choose has not been given a word, and is not told which the clock would pick for them.
    if (forbidden.length) assertNoLeaks(withoutNamesAndTalk(view), { forbidden, who });
    assert.equal(view.reveal, null, `${who}: nothing is revealed while a turn is on`);
  }

  // The boards: one for each drawer, the word only on your own, and a shape that gives away the length and no letter.
  if (room.phase !== 'lobby') assert.equal(view.boards.length, 2, 'two drawings');
  view.boards.forEach((board, at) => {
    const word = room.words[board.drawer] ?? null;
    assert.equal(board.drawer, drawers[at], 'a board is known by its place');
    assert.equal(board.yours, board.drawer === id);
    assert.equal(board.chosen, Boolean(word), 'everybody can see who has chosen');
    if (inTurn) assert.equal(board.word, board.yours ? word : null, `${who}: reads their own word and nobody else's`);
    if (room.phase === 'between') assert.equal(board.word, word, 'once the turn is over both words are shown to everybody');
    assert.equal(board.shape.length, word ? [...word].length : 0, 'the shape is as long as the word');
    [...(word ?? '')].forEach((letter, n) => {
      if (/\p{L}|\p{N}/u.test(letter)) assert.equal(board.shape[n], null, `${who}: a letter of a word is never shown`);
      else assert.equal(board.shape[n], letter, 'a space or a hyphen is not a letter, and is shown');
    });
  });

  // The words to choose between: only for a drawer who has not chosen yet, and only their own.
  const choosing = room.phase === 'choosing' && drawers.includes(id) && !room.words[id];
  assert.deepEqual(view.choices, choosing ? room.choices[id] : [], `${who}: offered their own words while choosing, and nothing otherwise`);

  // The guess panel: everybody sees what was typed, and a near miss is marked only for whoever wrote it.
  assert.equal(view.feed.length, room.feed.length);
  view.feed.forEach((line, n) => {
    const real = room.feed[n];
    assert.equal(line.text, real.text);
    if (real.kind === 'close') assert.equal(line.kind, real.id === id ? 'close' : 'guess', `${who}: a close guess is told to its writer alone`);
    else assert.equal(line.kind, real.kind);
  });

  // The table and the scores.
  assert.deepEqual(view.players.map((p) => p.id), room.players.map((p) => p.id), 'everybody at the table is listed');
  for (const row of view.players) {
    const player = room.players.find((p) => p.id === row.id);
    assert.equal(row.score, player.score);
    assert.equal(row.bot, game.isBot(player));
    if (inTurn) assert.equal(row.drawing, drawers.includes(row.id), 'the table is shown who is drawing');
    if (['lobby', 'finished'].includes(room.phase)) assert.equal(row.drawing, false);
    if (room.phase !== 'finished') assert.deepEqual([row.placement, row.winner], [null, false], 'nobody has won until the game is over');
  }
  assert.deepEqual(view.scoreboard.players.map((p) => p.id), room.players.map((p) => p.id), 'everybody is on the scoreboard');
  for (const row of view.scoreboard.players) {
    assert.equal(view.scoreboard.rounds.reduce((total, round) => total + (round.deltas[row.id] ?? 0), 0), row.score, 'the turns on the scoreboard add up to the score beside them');
  }
  assert.equal(view.remaining, room.deadline === null ? null : Math.max(0, room.deadline - now), 'how long is left, never less than nothing');
  return view;
}

/** Everybody's view, and a stranger's; looking must not change the room. */
function look(room, now, views) {
  const before = JSON.stringify(room);
  for (const id of [...room.players.map((p) => p.id), STRANGER]) views.push(JSON.stringify(checkView(room, id, now)));
  assert.equal(JSON.stringify(room), before, 'looking at a room does not change it');
}

/**
 * Plays a seeded game through the rules, looking at every view after every step.
 * @param {number} seed
 * @param {{ people: number, bots: number, rounds?: number }} table
 * @returns {{ room: object, views: string[], phases: Set<string>, named: number, unnamed: number, close: number }}
 */
function tour(seed, { people, bots, rounds = 1 }) {
  const rng = seeded(seed);
  let now = 1000;
  const views = [];
  const seen = { phases: new Set(), named: 0, unnamed: 0, close: 0 };
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Zeb1', settings: { rounds }, now });
  for (let id = 2; id <= people; id++) assert.equal(game.addHuman(room, id, `Zeb${id}`).ok, true);
  for (let n = 0; n < bots; n++) assert.equal(game.addBot(room, 1).ok, true);
  const step = (act) => {
    now += 1000;
    act();
    seen.phases.add(room.phase);
    look(room, now, views);
  };
  look(room, now, views);
  step(() => assert.equal(game.start(room, 1, rng, now).ok, true));
  for (let guard = 0; room.phase !== 'finished'; guard++) {
    assert.ok(guard < 5000, `seed ${seed}: the game must end`);
    const drawers = game.drawersOf(room);
    if (room.phase === 'choosing') {
      // Each drawer picks, or dithers and lets the clock pick; a view is taken with one chosen and one not.
      for (const drawer of drawers) {
        if (rng() < 0.3) continue;
        step(() => assert.equal(game.chooseWord(room, drawer, Math.floor(rng() * room.choices[drawer].length), now).ok, true));
      }
      if (room.phase === 'choosing') step(() => assert.equal(game.timeUp(room, rng, now).ok, true));
    } else if (room.phase === 'drawing') {
      const guessers = room.players.filter((p) => !drawers.includes(p.id));
      const word = room.words[pick(rng, drawers)];
      const near = pick(rng, guessers);
      step(() => {
        const outcome = game.guess(room, near.id, `${word}s`, now);
        assert.equal(outcome.ok, true, outcome.error);
        if (outcome.quality === 'close') seen.close++;
      });
      if (room.phase !== 'drawing') {
        seen.named++; // the word with an "s" on it was taken as the word itself
        continue;
      }
      step(() => assert.equal(game.guess(room, pick(rng, guessers).id, 'qqqq zzzz', now).quality, 'wrong'));
      if (rng() < 0.6) {
        step(() => assert.equal(game.guess(room, pick(rng, guessers).id, word, now).quality, 'exact'));
        seen.named++;
      } else {
        step(() => assert.equal(game.timeUp(room, rng, now).ok, true));
        seen.unnamed++;
      }
    } else {
      step(() => assert.equal(game.timeUp(room, rng, now).ok, true));
    }
  }
  return { room, views, ...seen };
}

const TABLES = [
  ['three people', 11, { people: 3, bots: 0 }],
  ['two people and two computer players', 12, { people: 2, bots: 2 }],
  ['one person and four computer players, twice through', 13, { people: 1, bots: 4, rounds: 2 }],
  ['a full table of eight', 14, { people: 5, bots: 3 }],
];

for (const [label, seed, table] of TABLES) {
  test(`${label}: nobody is ever sent a word that is not theirs to read, at any step of a whole game`, () => {
    const first = tour(seed, table);
    assert.deepEqual([...first.phases].sort(), ['between', 'choosing', 'drawing', 'finished'], 'the game went through every phase');
    assert.ok(first.views.length > 50, 'there was a game to look at');
    assert.deepEqual(tour(seed, table).views, first.views, 'a seed replays the same game and the same views');
  });
}

test('when the game is over the standings are on every view: the most points wins, and a tied top score is shared', () => {
  const seen = { named: 0, unnamed: 0, close: 0 };
  for (const [, seed, table] of TABLES) {
    const { room, named, unnamed, close } = tour(seed, table);
    seen.named += named;
    seen.unnamed += unnamed;
    seen.close += close;
    const best = Math.max(...room.players.map((p) => p.score));
    for (const id of [...room.players.map((p) => p.id), STRANGER]) {
      const view = game.viewFor(room, id);
      for (const row of view.players) {
        assert.equal(row.winner, row.score === best, 'everybody on the top score wins');
        assert.equal(row.placement, 1 + room.players.filter((p) => p.score > row.score).length, 'a place is one more than the number who did better');
      }
      assert.equal(view.reveal, null);
      assert.equal(view.youDraw, false, 'nobody is drawing once the game is over');
      assert.deepEqual(view.choices, []);
    }
  }
  // The games above have to have gone where the checks are, or passing means nothing.
  assert.ok(seen.named > 0 && seen.unnamed > 0, 'turns ended both ways: a drawing named, and the clock running out');
  assert.ok(seen.close > 0, 'somebody made a close guess');
});

test('a view shows who is away: a person who is not connected, and never a computer player', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Zeb1', now: 0 });
  game.addHuman(room, 2, 'Zeb2');
  game.addBot(room, 1);
  const view = game.viewFor(room, 1, { online: (id) => id === 1 });
  assert.deepEqual(view.players.map((p) => [p.bot, p.online]), [[false, true], [false, false], [true, true]]);
});

test('the lobby tells everybody how long the game will be: every pair of players, as many times as the host asked', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Zeb1', now: 0 });
  for (let id = 2; id <= 4; id++) game.addHuman(room, id, `Zeb${id}`);
  assert.equal(game.viewFor(room, 2).turnsToPlay, 6, 'four players are six pairs (rules.md)');
  assert.equal(game.setSettings(room, 1, { rounds: 3 }).ok, true);
  assert.equal(game.viewFor(room, 2).turnsToPlay, 18);
  assert.deepEqual(game.viewFor(room, STRANGER).settings, { rounds: 3, drawTime: game.DRAW_TIME.default, wordChoices: game.WORD_CHOICES.default });
  assert.deepEqual(game.viewFor(room, 2).boards, [], 'nobody is drawing in the lobby');
});
