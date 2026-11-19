// Property-style tests for the Dixnt rules: seeded random legal play (with people joining, leaving, and rounds being
// skipped) in every judging mode, with and without a word-chooser, checking the invariants of the game after every
// single action.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPOSTER_JUDGING, JUDGING_MODES, MIN_PLAYERS, VOTE_JUDGING } from './game.js';
import { rulesWith } from './harness.js';
import { seeded } from '../../shared/testkit.js';

const CARDS = 90;
const ids = (n) => Array.from({ length: n }, (_, i) => 1000 + i);

const newRules = (cardCount = CARDS) => rulesWith({ getCardIds: () => ids(cardCount), hints: ['a', 'b', 'c', 'd', 'e'] });
/** A lobby of `count` people, accounts 1 upwards. */
function newRoom(game, count) {
  const room = game.createRoom({ code: 'fuzz-room-here', hostId: 1, hostName: 'P1', now: 0 });
  for (let i = 2; i <= count; i++) assert.equal(game.addHuman(room, i, `P${i}`).ok, true);
  return room;
}

/** The player a table's key names.  A table keyed by player id has text keys; a person's id is a number. */
const byKey = (room, key) => room.players.find((p) => String(p.id) === String(key));

/** Every way a game can be set up: each judging style, and those that also go without a word-chooser. */
const VARIANTS = [
  ...JUDGING_MODES.map((judging) => ({ judging, noChooser: false })),
  ...VOTE_JUDGING.map((judging) => ({ judging, noChooser: true })),
];
/** How a variant is named in a test's title. */
const describeVariant = ({ judging, noChooser }) => `"${judging}" judging${noChooser ? ' with nobody choosing the word' : ''}`;

/** Everything that must hold whatever has happened so far. */
function check(game, room, memory, where) {
  const note = `${where} (phase ${room.phase}, round ${room.turn})`;
  const hands = room.players.flatMap((p) => p.hand);
  const all = [...room.draw, ...room.discard, ...hands];
  assert.equal(new Set(all).size, all.length, `${note}: a card exists twice`);
  if (room.phase === 'lobby') assert.equal(all.length, 0, `${note}: the lobby holds no cards`);
  else {
    assert.equal(all.length, memory.cards, `${note}: cards are conserved`);
    for (const id of all) assert.ok(id >= 1000 && id < 1000 + memory.cards, `${note}: a made-up card ${id}`);
    for (const p of room.players) assert.ok(p.hand.length <= room.handSize, `${note}: ${p.name} holds too many cards`);
  }
  for (const p of room.players) {
    const total = room.history.reduce((sum, r) => sum + (r.deltas[p.slot] ?? 0), 0);
    assert.equal(total, p.score, `${note}: ${p.name}'s score equals the history`);
    assert.ok(Number.isInteger(p.score) && p.score >= 0, `${note}: a sane score`);
  }
  // The history names slots, and a slot stays with its place through every takeover, so every one of them is still held.
  for (const r of room.history) for (const slot of Object.keys(r.deltas)) assert.ok(room.players.some((p) => p.slot === slot), `${note}: history mentions a slot nobody holds`);
  assert.equal(room.history.length, room.completedTurns, `${note}: one history row per completed round`);
  if (room.phase !== 'lobby') assert.ok(room.players.length >= MIN_PLAYERS, `${note}: a game needs ${MIN_PLAYERS} players`);
  // Whose turn it is: the one choosing the word, or, with no chooser, simply whose go it is for the length of the game.
  const plays = new Set(game.cardPlayers(room).map((p) => p.id));
  if (['word', 'picking', 'voting', 'results'].includes(room.phase)) {
    assert.ok(game.playerOf(room, room.chooserId), `${note}: the turn belongs to a current player`);
    for (const id of Object.keys(room.picks)) assert.ok(byKey(room, id) && plays.has(byKey(room, id).id), `${note}: a pick by somebody not playing a card`);
    for (const [voter, target] of Object.entries(room.votes)) assert.ok(byKey(room, voter) && byKey(room, target), `${note}: a vote involving a non-player`);
    assert.equal(room.noChooser && room.phase === 'word', false, `${note}: a game with no chooser never waits for a word`);
  }
  if (['picking', 'voting', 'results'].includes(room.phase)) {
    // Only the imposter styles keep somebody from the word; the best-card ones have nobody to find.
    if (!IMPOSTER_JUDGING.includes(room.judging)) assert.equal(room.imposterId, null, `${note}: nobody should be in the dark`);
    else assert.ok(game.playerOf(room, room.imposterId) && plays.has(room.imposterId), `${note}: the imposter is a current card player`);
  }
  if (room.phase === 'voting') assert.equal(room.tableOrder.length, game.cardPlayers(room).length, `${note}: every card is on the table`);
  if (room.phase === 'results') {
    const sum = Object.values(room.results.deltas).reduce((a, b) => a + b, 0);
    assert.ok(sum >= 0, `${note}: results add points`);
  }
  if (room.phase === 'finished') assert.ok(room.players.every((p) => p.turns >= room.rounds), `${note}: finished only when everybody has had their turns`);
  assert.ok(room.completedTurns >= memory.completed || memory.reset, `${note}: completed rounds never go backwards`);
  memory.completed = room.completedTurns;
  memory.reset = false;
  if (room.players.length) assert.ok(game.playerOf(room, room.hostId), `${note}: the host is a current player`);
  // The views: nobody sees what they must not.
  for (const p of room.players) {
    const view = game.viewFor(room, p.id, { online: () => false });
    if (['picking', 'voting'].includes(room.phase)) {
      assert.equal(view.isImposter, false, `${note}: the imposter is not revealed yet`);
      assert.equal(view.results, null);
      assert.ok(!JSON.stringify(view).includes('"imposterId"'), `${note}: no imposterId in a view`);
    }
    if (room.phase === 'picking' && p.id === room.imposterId) {
      assert.equal(view.word, null, `${note}: the imposter must not see the word`);
      assert.equal(view.wordHidden, true);
    }
    assert.deepEqual(view.hand.filter((c) => !p.hand.includes(c)), [], `${note}: only my own cards in my hand`);
    if (room.phase === 'picking') assert.deepEqual(view.table, [], `${note}: nothing is shown on the table yet`);
  }
}

/** One random thing a person (or the host) could do right now.  Returns false when nothing was possible. */
function randomAction(game, room, rng, names) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const roll = rng();
  const host = room.hostId;
  const people = () => room.players.filter((p) => p.kind === 'human');
  const join = () => {
    names.n++;
    game.addHuman(room, 1000 + names.n, `Q${names.n}`); // refused when every place already holds a person
  };
  if (room.phase === 'lobby') {
    if (room.players.length < MIN_PLAYERS + Math.floor(rng() * 3)) join();
    else game.start(room, host, rng);
    return true;
  }
  if (roll < 0.03) {
    join();
    return true;
  }
  if (roll < 0.06 && people().length > 1) {
    const victim = pick(people());
    if (rng() < 0.5) game.removeHuman(room, victim.id, rng, 0);
    else game.kick(room, host, victim.slot, rng, 0);
    return true;
  }
  if (roll < 0.08 && ['word', 'picking', 'voting'].includes(room.phase)) {
    game.abortTurn(room, host, rng);
    return true;
  }
  if (roll < 0.09) {
    game.playAgain(room, host);
    return true;
  }
  switch (room.phase) {
    case 'word':
      game.submitWord(room, room.chooserId, `word ${Math.floor(rng() * 1000)}`, rng);
      return true;
    case 'picking': {
      const waiting = game.cardPlayers(room).filter((p) => !(p.id in room.picks));
      if (!waiting.length) return false;
      const p = pick(waiting);
      game.playCard(room, p.id, pick(p.hand), rng);
      return true;
    }
    case 'voting': {
      const v = pick(game.voters(room));
      game.vote(room, v.id, pick(game.cardPlayers(room).filter((p) => p.id !== v.id)).id);
      return true;
    }
    case 'results':
      game.nextTurn(room, pick(room.players).id, rng);
      return true;
    case 'finished':
      if (rng() < 0.5) {
        game.playAgain(room, host);
        return true;
      }
      return false;
  }
  return false;
}

for (const [variant, index] of VARIANTS.map((v, i) => [v, i])) {
  const { judging, noChooser } = variant;
  test(`random legal play in ${describeVariant(variant)} keeps every invariant, with people joining, leaving and rounds skipped`, () => {
    let finishedGames = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const rng = seeded(seed * 7919 + index);
      const game = newRules();
      const room = newRoom(game, 4);
      const memory = { cards: CARDS, completed: 0, reset: true };
      const names = { n: 0 };
      assert.equal(game.setSettings(room, room.hostId, { judging, noChooser, rounds: 1 + Math.floor(rng() * 3), handSize: 3 + Math.floor(rng() * 8) }).ok, true);
      assert.equal(game.start(room, room.hostId, rng).ok, true);
      check(game, room, memory, `seed ${seed} start`);
      let sawFinished = false;
      for (let step = 0; step < 600; step++) {
        const before = room.phase;
        const completed = room.completedTurns;
        randomAction(game, room, rng, names);
        if (room.phase === 'lobby' || room.completedTurns < completed) memory.reset = true;
        check(game, room, memory, `seed ${seed} step ${step} after ${before}`);
        if (room.phase === 'finished') {
          sawFinished = true;
          if (rng() < 0.3) break;
        }
      }
      if (sawFinished) finishedGames++;
    }
    assert.ok(finishedGames >= 8, `many games reach their end (${finishedGames} of 25)`);
  });
}

test('without leaves or skips every game terminates after exactly players x rounds rounds, whatever the votes', () => {
  for (const { judging, noChooser } of VARIANTS) {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = seeded(seed);
      const game = newRules();
      const count = 3 + Math.floor(rng() * 5);
      const room = newRoom(game, count);
      const host = room.hostId;
      const each = 1 + Math.floor(rng() * 3);
      assert.equal(game.setSettings(room, host, { judging, noChooser, rounds: each, handSize: 3 + Math.floor(rng() * 4) }).ok, true);
      assert.equal(game.start(room, host, rng).ok, true);
      const memory = { cards: CARDS, completed: 0, reset: true };
      const chosen = new Set();
      let guard = 0;
      while (room.phase !== 'finished') {
        assert.ok(guard++ < 2000, 'terminates');
        chosen.add(room.chooserId); // whose turn it is, whether or not they are the one choosing the word
        if (room.phase === 'word') {
          game.submitWord(room, room.chooserId, 'w', rng);
        } else if (room.phase === 'picking') {
          for (const p of game.cardPlayers(room)) game.playCard(room, p.id, p.hand[Math.floor(rng() * p.hand.length)], rng);
        } else if (room.phase === 'voting') {
          for (const v of game.voters(room)) {
            const targets = game.cardPlayers(room).filter((p) => p.id !== v.id);
            game.vote(room, v.id, targets[Math.floor(rng() * targets.length)].id);
          }
        } else game.nextTurn(room, host, rng);
        check(game, room, memory, `${judging} seed ${seed}`);
      }
      assert.equal(room.completedTurns, count * each);
      assert.ok(room.players.every((p) => p.turns === each), 'everyone chose the word equally often');
      assert.equal(chosen.size, count);
    }
  }
});
