// Property-style tests for the Dixnt rules: seeded random legal play (with people joining, leaving and rounds being
// skipped) in every judging mode, checking the invariants of the game after every single action.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError, JUDGING_MODES, MIN_PLAYERS } from './game.js';
import { seeded } from '../../shared/testkit.js';

const CARDS = 90;
const ids = (n) => Array.from({ length: n }, (_, i) => 1000 + i);

function newGame(rng, cardCount = CARDS) {
  return new Game({ getCardIds: () => ids(cardCount), hints: ['a', 'b', 'c', 'd', 'e'], rng });
}

/** Everything that must hold whatever has happened so far. */
function check(game, memory, where) {
  const s = game.s;
  const note = `${where} (phase ${s.phase}, round ${s.round})`;
  const hands = s.players.flatMap((p) => p.hand);
  const all = [...s.draw, ...s.discard, ...hands];
  assert.equal(new Set(all).size, all.length, `${note}: a card exists twice`);
  if (s.phase === 'lobby') assert.equal(all.length, 0, `${note}: the lobby holds no cards`);
  else {
    assert.equal(all.length, memory.cards, `${note}: cards are conserved`);
    for (const id of all) assert.ok(id >= 1000 && id < 1000 + memory.cards, `${note}: a made-up card ${id}`);
    for (const p of s.players) assert.ok(p.hand.length <= s.handSize, `${note}: ${p.name} holds too many cards`);
  }
  for (const p of s.players) {
    const total = s.history.reduce((sum, r) => sum + (r.deltas[p.id] ?? 0), 0);
    assert.equal(total, p.score, `${note}: ${p.name}'s score equals the history`);
    assert.ok(Number.isInteger(p.score) && p.score >= 0, `${note}: a sane score`);
  }
  for (const r of s.history) for (const id of Object.keys(r.deltas)) assert.ok(game.player(id), `${note}: history mentions someone who left`);
  assert.equal(s.history.length, s.completed, `${note}: one history row per completed round`);
  if (s.phase !== 'lobby') assert.ok(s.players.length >= MIN_PLAYERS, `${note}: a game needs ${MIN_PLAYERS} players`);
  if (['word', 'picking', 'voting', 'results'].includes(s.phase)) {
    assert.ok(game.player(s.chooserId), `${note}: the chooser is a current player`);
    for (const id of Object.keys(s.picks)) assert.ok(game.player(id) && id !== s.chooserId, `${note}: a pick by a non-player`);
    for (const [voter, target] of Object.entries(s.votes)) assert.ok(game.player(voter) && game.player(target), `${note}: a vote involving a non-player`);
  }
  if (['picking', 'voting', 'results'].includes(s.phase)) {
    if (s.judging === 'favourite') assert.equal(s.imposterId, null);
    else assert.ok(game.player(s.imposterId) && s.imposterId !== s.chooserId, `${note}: the imposter is a current card player`);
  }
  if (s.phase === 'voting') assert.equal(s.tableOrder.length, game.cardPlayers().length, `${note}: every card is on the table`);
  if (s.phase === 'results') {
    const sum = Object.values(s.results.deltas).reduce((a, b) => a + b, 0);
    assert.ok(sum >= 0, `${note}: results add points`);
  }
  if (s.phase === 'finished') assert.ok(s.players.every((p) => p.waiting || p.turns >= s.roundsEach), `${note}: finished only when everybody (but late joiners) has had their turns`);
  assert.ok(s.completed >= memory.completed || memory.reset, `${note}: completed rounds never go backwards`);
  memory.completed = s.completed;
  memory.reset = false;
  if (s.players.length) assert.ok(game.player(s.hostId), `${note}: the host is a current player`);
  // The views: nobody sees what they must not.
  for (const p of s.players) {
    const view = game.viewFor(p.id, new Set());
    if (['picking', 'voting'].includes(s.phase)) {
      assert.equal(view.me.isImposter, false, `${note}: the imposter is not revealed yet`);
      assert.equal(view.results, null);
      assert.ok(!JSON.stringify(view).includes('"imposterId"'), `${note}: no imposterId in a view`);
    }
    if (s.phase === 'picking' && p.id === s.imposterId) {
      assert.equal(view.word, null, `${note}: the imposter must not see the word`);
      assert.equal(view.wordHidden, true);
    }
    assert.deepEqual(view.me.hand.filter((c) => !p.hand.includes(c)), [], `${note}: only my own cards in my hand`);
    if (s.phase === 'picking') assert.deepEqual(view.table, [], `${note}: nothing is shown on the table yet`);
  }
}

/** One random thing a person (or the host) could do right now. Returns false when nothing was possible. */
function randomAction(game, rng, names) {
  const s = game.s;
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const roll = rng();
  const host = s.hostId;
  const join = () => {
    names.n++;
    game.addPlayer(`P${names.n}`, `t${names.n}`);
  };
  if (s.phase === 'lobby') {
    if (s.players.length < MIN_PLAYERS + Math.floor(rng() * 3)) join();
    else game.start(host);
    return true;
  }
  if (roll < 0.03 && s.players.length < 7) {
    join();
    return true;
  }
  if (roll < 0.06) {
    const victim = pick(s.players);
    if (rng() < 0.5) game.removePlayer(victim.id, victim.id);
    else game.removePlayer(host, victim.id);
    return true;
  }
  if (roll < 0.08 && ['word', 'picking', 'voting'].includes(s.phase)) {
    game.abortRound(host);
    return true;
  }
  if (roll < 0.09) {
    game.returnToLobby(host);
    return true;
  }
  switch (s.phase) {
    case 'word':
      game.submitWord(s.chooserId, `word ${Math.floor(rng() * 1000)}`);
      return true;
    case 'picking': {
      const waiting = game.cardPlayers().filter((p) => !(p.id in s.picks));
      if (!waiting.length) return false;
      const p = pick(waiting);
      game.playCard(p.id, pick(p.hand));
      return true;
    }
    case 'voting': {
      const v = pick(game.voters());
      game.vote(v.id, pick(game.cardPlayers().filter((p) => p.id !== v.id)).id);
      return true;
    }
    case 'results':
      game.nextRound(pick(s.players).id);
      return true;
    case 'finished':
      if (rng() < 0.5) {
        game.returnToLobby(host);
        return true;
      }
      return false;
  }
  return false;
}

for (const judging of JUDGING_MODES) {
  test(`random legal play in "${judging}" judging keeps every invariant, with people joining, leaving and rounds skipped`, () => {
    let finishedGames = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const rng = seeded(seed * 7919 + JUDGING_MODES.indexOf(judging));
      const game = newGame(rng);
      const memory = { cards: CARDS, completed: 0, reset: true };
      const names = { n: 0 };
      for (let i = 0; i < 4; i++) game.addPlayer(`P${i}`, `x${i}`);
      game.setJudging(game.s.hostId, judging);
      game.setRounds(game.s.hostId, 1 + Math.floor(rng() * 3));
      game.setHandSize(game.s.hostId, 3 + Math.floor(rng() * 8));
      game.start(game.s.hostId);
      check(game, memory, `seed ${seed} start`);
      let sawFinished = false;
      for (let step = 0; step < 600; step++) {
        const before = game.s.phase;
        const completed = game.s.completed;
        try {
          randomAction(game, rng, names);
        } catch (error) {
          assert.ok(error instanceof GameError, `seed ${seed} step ${step}: unexpected ${error.stack}`);
        }
        if (game.s.phase === 'lobby' || game.s.completed < completed) memory.reset = true;
        check(game, memory, `seed ${seed} step ${step} after ${before}`);
        if (game.s.phase === 'finished') {
          sawFinished = true;
          if (rng() < 0.3) break;
        }
      }
      if (sawFinished) finishedGames++;
    }
    assert.ok(finishedGames >= 10, `many games reach their end (${finishedGames} of 25)`);
  });
}

test('without leaves or skips every game terminates after exactly players x rounds rounds, whatever the votes', () => {
  for (const judging of JUDGING_MODES) {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = seeded(seed);
      const game = newGame(rng);
      const count = 3 + Math.floor(rng() * 5);
      for (let i = 0; i < count; i++) game.addPlayer(`P${i}`, `t${i}`);
      const host = game.s.hostId;
      const each = 1 + Math.floor(rng() * 3);
      game.setJudging(host, judging);
      game.setRounds(host, each);
      game.setHandSize(host, 3 + Math.floor(rng() * 4));
      game.start(host);
      const memory = { cards: CARDS, completed: 0, reset: true };
      const chosen = new Set();
      let guard = 0;
      while (game.s.phase !== 'finished') {
        assert.ok(guard++ < 2000, 'terminates');
        const s = game.s;
        if (s.phase === 'word') {
          chosen.add(s.chooserId);
          game.submitWord(s.chooserId, 'w');
        } else if (s.phase === 'picking') {
          for (const p of game.cardPlayers()) game.playCard(p.id, p.hand[Math.floor(rng() * p.hand.length)]);
        } else if (s.phase === 'voting') {
          for (const v of game.voters()) {
            const targets = game.cardPlayers().filter((p) => p.id !== v.id);
            game.vote(v.id, targets[Math.floor(rng() * targets.length)].id);
          }
        } else game.nextRound(host);
        check(game, memory, `${judging} seed ${seed}`);
      }
      assert.equal(game.s.completed, count * each);
      assert.ok(game.s.players.every((p) => p.turns === each), 'everyone chose the word equally often');
      assert.equal(chosen.size, count);
    }
  }
});
