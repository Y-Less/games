// Built-in computer players: seats in the room that the server plays for itself. Rules first (no sockets), then real
// sockets: mixed rooms, whole games, a restart in the middle, people leaving, statistics and garbage events.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';
import { AIS } from './ai/index.js';
import { Game, GameError, JUDGING_MODES, MAX_PLAYERS, MIN_PLAYERS } from './game.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DIXNT_BOT_DELAY = '0-3';

const cards = (n) => Array.from({ length: n }, (_, i) => i + 1);
function seededRng(seed = 1) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** A lobby with one person (the host) and `bots` computer players, ready to start. */
function lobbyWith(bots, { judging = 'everyone', seed = 5, roundsEach = 1, handSize = 4 } = {}) {
  const game = new Game({ getCardIds: () => cards(400), hints: cards(30).map((n) => `hint ${n}`), rng: seededRng(seed) });
  const host = game.addPlayer('Host', 'user:1');
  for (let i = 0; i < bots; i++) game.addBot(host.id);
  game.setJudging(host.id, judging);
  game.setRounds(host.id, roundsEach);
  game.setHandSize(host.id, handSize);
  return { game, host };
}

/** Does whatever a person at the table would do next, using their own view; returns false if there is nothing to do. */
function personActs(game, person) {
  const s = game.s;
  const view = game.viewFor(person.id);
  if (s.phase === 'results') {
    if (!game.isHost(person.id)) return false;
    game.nextRound(person.id);
  } else if (s.phase === 'word' && view.me.isChooser) game.submitWord(person.id, 'a word');
  else if (s.phase === 'picking' && !view.me.isChooser && !view.me.waiting && view.me.myPick === null) game.playCard(person.id, view.me.hand[0]);
  else if (s.phase === 'voting' && view.voteTargets.length && view.me.myVote === null) game.vote(person.id, view.voteTargets[0]);
  else return false;
  return true;
}

/** Computer players act until the game is over; the people given act when it is their turn (the first is the host). */
function playOut(game, people, { guard = 5000 } = {}) {
  for (let i = 0; i < guard; i++) {
    if (game.s.phase === 'finished') return;
    if (game.runBotAction()) continue;
    if (!people.some((p) => personActs(game, p))) assert.fail(`stuck in ${game.s.phase}`);
  }
  assert.fail('the game did not finish');
}

test('the host adds, fills and removes computer players in the lobby, up to the maximum', () => {
  const game = new Game({ getCardIds: () => cards(400), hints: [] });
  const host = game.addPlayer('Host', 'user:1');
  const guest = game.addPlayer('Guest', 'user:2');
  assert.throws(() => game.addBot(guest.id), GameError, 'only the host adds');
  assert.throws(() => game.fillWithBots(guest.id), GameError);
  const { id } = game.addBot(host.id);
  assert.equal(game.player(id).bot, true);
  assert.deepEqual(game.viewFor(host.id).scoreboard.players.map((p) => p.bot), [false, false, true], 'the scoreboard marks computer players');
  assert.equal(game.viewFor(host.id).scoreboard.players.some((p) => p.current), false, 'nobody is the chooser in the lobby');
  assert.equal(game.player(id).token.startsWith('bot:'), true);
  assert.equal(game.player(id).hand.length, 0);
  assert.throws(() => game.removeBot(guest.id, id), GameError);
  assert.throws(() => game.removeBot(host.id, guest.id), GameError, 'people are not computer players');
  assert.throws(() => game.removeBot(host.id, 'nobody'), GameError);
  game.removeBot(host.id, id);
  assert.equal(game.s.players.length, 2);

  game.fillWithBots(host.id);
  assert.equal(game.s.players.length, MIN_PLAYERS, 'fills up to the minimum by default');
  game.fillWithBots(host.id, 6);
  assert.equal(game.s.players.length, 6);
  game.fillWithBots(host.id, 'many');
  assert.equal(game.s.players.length, 6, 'a nonsense target changes nothing');
  game.fillWithBots(host.id, 500);
  assert.equal(game.s.players.length, MAX_PLAYERS, 'never more than the maximum');
  assert.throws(() => game.addBot(host.id), GameError);
  assert.throws(() => game.addPlayer('Late', 'user:9'), GameError, 'people cannot take a thirteenth seat either');
  const names = game.s.players.map((p) => p.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'every name is different');
  assert.equal(game.s.players.filter((p) => p.bot).length, MAX_PLAYERS - 2);

  game.start(host.id);
  assert.throws(() => game.addBot(host.id), GameError, 'not once the game has started');
  assert.throws(() => game.fillWithBots(host.id), GameError);
  assert.throws(() => game.removeBot(host.id, game.s.players[2].id), GameError);
});

test('a bot never shares a name with a person', () => {
  const game = new Game({ getCardIds: () => cards(400), hints: [] });
  const host = game.addPlayer('Ada', 'user:1');
  game.addBot(host.id);
  assert.notEqual(game.s.players[1].name.toLowerCase(), 'ada');
  assert.throws(() => game.addPlayer(game.s.players[1].name, 'user:2'), GameError);
});

test('starting deals every bot an AI from the game rng, and the view shows it for bot seats only', () => {
  const ais = (seed) => {
    const { game, host } = lobbyWith(6, { seed });
    assert.ok(game.viewFor(host.id).players.every((p) => p.ai === null), 'no AI before the game starts');
    game.start(host.id);
    return game.s.players.map((p) => p.ai ?? null);
  };
  assert.deepEqual(ais(3), ais(3), 'the same seed deals the same AIs');
  const seen = new Set();
  for (let seed = 1; seed < 30; seed++) for (const ai of ais(seed)) seen.add(ai);
  assert.ok(seen.size > 2, 'different seeds deal different AIs');
  assert.ok([...seen].every((id) => id === null || AIS.some((ai) => ai.id === id)));

  const { game, host } = lobbyWith(3);
  game.start(host.id);
  const view = game.viewFor(host.id);
  assert.equal(view.players[0].ai, null, 'a person has no AI');
  assert.equal(view.players[0].bot, false);
  for (const p of view.players.slice(1)) {
    assert.equal(p.bot, true);
    assert.deepEqual(Object.keys(p.ai).sort(), ['id', 'name']);
    assert.equal(p.connected, true, 'a computer player is never shown as offline');
  }
  assert.ok(view.scoreboard.players.filter((p) => p.id !== host.id).every((p) => !p.away), 'bots are never away');
  assert.equal(JSON.stringify(view).includes('"token"'), false, 'tokens never reach the client');

  // Back in the lobby the seats stay, and the AIs are dealt again at the next start.
  game.returnToLobby(host.id);
  assert.ok(game.s.players.slice(1).every((p) => p.bot && p.ai === undefined));
  game.start(host.id);
  assert.ok(game.s.players.slice(1).every((p) => p.ai));
});

for (const judging of JUDGING_MODES) {
  for (const bots of [MIN_PLAYERS - 1, MAX_PLAYERS - 1]) {
    test(`the host and ${bots} computer players play a whole "${judging}" game, bots choosing, playing and voting`, () => {
      const { game, host } = lobbyWith(bots, { judging, roundsEach: 2, seed: bots });
      game.start(host.id);
      const chosenBy = new Set();
      const original = game.submitWord.bind(game);
      game.submitWord = (id, word) => {
        chosenBy.add(id);
        return original(id, word);
      };
      playOut(game, [host]);
      assert.equal(game.s.phase, 'finished');
      assert.equal(game.s.completed, (bots + 1) * 2);
      assert.ok(game.s.players.every((p) => p.turns === 2));
      assert.equal(chosenBy.size, bots + 1, 'bots and the person each chose the word');
      assert.equal(game.s.history.length, game.s.completed, 'the shared scoreboard has every round');
      for (const p of game.s.players) {
        assert.equal(p.score, game.s.history.reduce((sum, r) => sum + (r.deltas[p.id] ?? 0), 0), 'columns add up');
      }
      const view = game.viewFor(host.id);
      assert.equal(view.phase, 'finished');
      assert.ok(view.winners.length >= 1);
    });
  }
}

test('bots decide from what a person in their seat sees: no clue for the imposter, only their own hand', () => {
  const seen = { cards: [], votes: [] };
  const spy = { ...AIS[0], id: 'spy', playCard: (ctx) => (seen.cards.push(ctx), ctx.hand[0]), vote: (ctx) => (seen.votes.push(ctx), ctx.targets[0]) };
  AIS.push(spy);
  try {
    for (const judging of JUDGING_MODES) {
      const { game, host } = lobbyWith(5, { judging, roundsEach: 1, seed: 11 });
      game.start(host.id);
      for (const p of game.s.players) if (p.bot) p.ai = 'spy';
      let cardsChecked = 0;
      let votesChecked = 0;
      for (let guard = 0; guard < 2000 && game.s.phase !== 'finished'; guard++) {
        const action = game.pendingBotAction();
        if (!action) {
          assert.ok(personActs(game, host), `stuck in ${game.s.phase}`);
          continue;
        }
        const me = game.player(action.id);
        const imposter = game.s.imposterId === me.id;
        const hand = [...me.hand];
        const cardsBefore = seen.cards.length;
        const votesBefore = seen.votes.length;
        game.runBotAction(action);
        if (action.type === 'card') {
          const ctx = seen.cards[cardsBefore];
          assert.deepEqual(ctx.hand, hand, 'its own hand');
          assert.equal(ctx.word, imposter ? null : game.s.word, 'the clue unless it is the imposter');
          cardsChecked++;
        } else if (action.type === 'vote') {
          const ctx = seen.votes[votesBefore];
          assert.equal(ctx.word, game.s.word, 'the clue is revealed by now');
          assert.ok(!ctx.targets.includes(action.id), 'never itself');
          assert.deepEqual(Object.keys(ctx.table[0]).sort(), ['cardId', 'playerId']);
          assert.equal(ctx.imposter, imposter);
          assert.equal(ctx.chooser, game.s.chooserId === action.id);
          votesChecked++;
        }
      }
      assert.equal(game.s.phase, 'finished');
      assert.ok(cardsChecked > 0 && votesChecked > 0, judging);
    }
  } finally {
    AIS.pop();
  }
});

test('a broken or illegal AI answer is replaced by a random legal move', () => {
  const broken = {
    ...AIS[0],
    id: 'broken',
    chooseWord: () => 'not a hint',
    playCard: () => 999999,
    vote: () => {
      throw new Error('boom');
    },
  };
  AIS.push(broken);
  try {
    const { game, host } = lobbyWith(4, { roundsEach: 1 });
    game.start(host.id);
    for (const p of game.s.players) if (p.bot) p.ai = 'broken';
    playOut(game, [host]);
    assert.equal(game.s.phase, 'finished');
  } finally {
    AIS.pop();
  }
});

test('a computer chooser still gives a word when the hint list is empty', () => {
  const game = new Game({ getCardIds: () => cards(400), hints: [], rng: seededRng(2) });
  const host = game.addPlayer('Host', 'user:1');
  game.addBot(host.id);
  game.addBot(host.id);
  game.start(host.id);
  game.s.chooserId = game.s.players[1].id;
  assert.equal(game.runBotAction(), true);
  assert.equal(game.s.phase, 'picking');
  assert.ok(game.s.word);
});

test('bots never block the results screen: only the host moves on', () => {
  const { game, host } = lobbyWith(3, { roundsEach: 2 });
  game.start(host.id);
  while (game.s.phase !== 'results') if (!game.runBotAction()) assert.ok(personActs(game, host));
  assert.equal(game.pendingBotAction(), null, 'bots wait at the results');
  assert.equal(game.runBotAction(), false);
  game.nextRound(host.id);
  assert.equal(game.s.phase, 'word');
});

test('a person leaving mid-round is replaced by a computer player who keeps their hand, score and played card', () => {
  const { game, host } = lobbyWith(1, { roundsEach: 2 });
  const guest = game.addPlayer('Guest', 'user:2');
  const third = game.addPlayer('Third', 'user:3');
  game.start(host.id);
  game.submitWord(game.s.chooserId, 'clue');
  const guestPlays = game.cardPlayers().some((p) => p.id === guest.id);
  const hand = [...guest.hand];
  if (guestPlays) game.playCard(guest.id, hand[2]);
  game.leave(guest.id, guest.id);
  const seat = game.player(guest.id);
  assert.equal(seat.bot, true);
  assert.notEqual(seat.name, 'Guest');
  assert.ok(seat.ai && AIS.some((ai) => ai.id === seat.ai));
  assert.equal(game.findByToken('user:2'), null, 'the account no longer has a seat');
  assert.deepEqual(seat.hand, hand);
  if (guestPlays) assert.equal(game.s.picks[guest.id], hand[2], 'what they had played stays played');
  assert.equal(game.s.phase, 'picking', 'the round carries on');
  assert.equal(game.s.players.length, 4);
  assert.equal(game.humans().length, 2);

  // The host leaves too: the other person hosts; then the last person leaving ends the game.
  game.leave(host.id, host.id);
  assert.equal(game.s.hostId, third.id);
  assert.equal(game.player(host.id).bot, true);
  assert.equal(game.humans().length, 1);
  game.leave(third.id, third.id);
  assert.equal(game.humans().length, 0, 'no people left: the server drops the game');
});

test('a person who was the chooser, or who still owed a card or a vote, is replaced and the game still finishes', () => {
  for (const phase of ['word', 'picking', 'voting', 'results']) {
    const { game, host } = lobbyWith(1, { roundsEach: 1, seed: 21 });
    const guest = game.addPlayer('Guest', 'user:2');
    game.start(host.id);
    // Play on (for the host and the guest) until the phase wanted is reached, with the guest still owing their move.
    for (let guard = 0; guard < 200 && game.s.phase !== phase; guard++) {
      if (game.runBotAction()) continue;
      const mover = game.s.phase === 'word' ? game.player(game.s.chooserId) : host;
      assert.ok(personActs(game, mover) || personActs(game, guest), `stuck in ${game.s.phase}`);
      if (game.s.phase === phase) break;
    }
    assert.equal(game.s.phase, phase);
    game.leave(guest.id, guest.id);
    assert.equal(game.player(guest.id).bot, true);
    assert.equal(game.s.phase, phase);
    playOut(game, [host]);
    assert.equal(game.s.phase, 'finished', `a game that lost a person in "${phase}" still finishes`);
  }
});

test('leavers in the lobby or after the game, late joiners, and host removals of bots', () => {
  // Lobby: the seat is simply removed.
  const { game, host } = lobbyWith(1);
  const guest = game.addPlayer('Guest', 'user:2');
  game.leave(guest.id, guest.id);
  assert.equal(game.player(guest.id), null);
  game.addBot(host.id);
  game.start(host.id);
  const late = game.addPlayer('Late', 'user:3');
  assert.equal(late.waiting, true);
  game.leave(late.id, late.id);
  assert.equal(game.player(late.id), null, 'a late joiner has no seat worth keeping');
  assert.equal(game.s.players.length, 3);

  // Mid-game the host removes a bot outright; dropping below three returns to the lobby, as for any player.
  assert.throws(() => game.leave(game.s.players[1].id, game.s.players[2].id), GameError, 'bots cannot remove anyone');
  game.leave(host.id, game.s.players[2].id);
  assert.equal(game.s.players.length, 2);
  assert.equal(game.s.phase, 'lobby');

  // After the game ends a leaver is just removed.
  const again = lobbyWith(3);
  again.game.start(again.host.id);
  playOut(again.game, [again.host]);
  const other = again.game.addPlayer('After', 'user:7');
  again.game.leave(other.id, other.id);
  assert.equal(again.game.player(other.id), null);
  assert.equal(again.game.s.phase, 'finished');
});

test('computer players survive a save and reload', () => {
  const { game, host } = lobbyWith(3, { roundsEach: 2 });
  game.start(host.id);
  for (let i = 0; i < 6; i++) game.runBotAction();
  const saved = JSON.parse(JSON.stringify(game.toJSON()));
  const again = new Game({ getCardIds: () => cards(400), hints: cards(30).map(String), saved, rng: seededRng(9) });
  assert.deepEqual(again.s.players.map((p) => [p.bot ?? false, p.ai ?? null]), game.s.players.map((p) => [p.bot ?? false, p.ai ?? null]));
  playOut(again, [again.player(host.id)]);
  assert.equal(again.s.phase, 'finished');
  // An older save with no bots in it loads as before.
  const old = JSON.parse(JSON.stringify(game.toJSON()));
  for (const p of old.players) delete p.bot;
  delete old.nextBot;
  assert.equal(new Game({ getCardIds: () => cards(400), saved: old }).humans().length, 4);
});

// ---------- over real sockets ----------

function makeFakeCards(dataDir) {
  const cardsDir = path.join(dataDir, 'cards');
  fs.mkdirSync(path.join(cardsDir, 'medium'), { recursive: true });
  const ids = Array.from({ length: 400 }, (_, i) => 10001 + i);
  for (const id of ids) fs.writeFileSync(path.join(cardsDir, 'medium', `card_${id}.jpg`), '');
  fs.writeFileSync(path.join(cardsDir, 'categories.json'), JSON.stringify({ categories: [{ key: 'all', label: 'All', description: '', ids }] }));
  process.env.DIXNT_CARDS_DIR = cardsDir;
}
const launch = (t, extra = {}) => launchModule(t, { id: 'dixnt', moduleDir: here, setup: makeFakeCards, ...extra });

/** Plays for the people given until the game is over: the first is the host and moves rounds on; bots act for themselves. */
async function drive(people, { limit = 30000 } = {}) {
  const host = people[0];
  const started = Date.now();
  while (host.state?.phase !== 'finished') {
    assert.ok(Date.now() - started < limit, `stalled in ${host.state?.phase} round ${host.state?.round}`);
    let acted = false;
    for (const p of people) {
      const s = p.state;
      if (!s) continue;
      let reply = null;
      if (s.phase === 'word' && s.me.isChooser) reply = await p.call('submitWord', { word: 'a word' });
      else if (s.phase === 'picking' && !s.me.isChooser && !s.me.waiting && s.me.myPick === null) reply = await p.call('playCard', { cardId: s.me.hand[0] });
      else if (s.phase === 'voting' && s.voteTargets.length && s.me.myVote === null) reply = await p.call('vote', { targetId: s.voteTargets[0] });
      else if (s.phase === 'results' && p === host) reply = await p.call('nextRound');
      if (reply) {
        assert.equal(reply.ok, true, reply.error);
        acted = true;
      }
    }
    if (!acted) await sleep(5);
  }
}

const resultRows = (site) => site.site.db.prepare('SELECT COUNT(*) AS n FROM results').get().n;

test('over sockets: the host fills with bots and starts, the server plays them to the end, and only people are in the statistics', async (t) => {
  const site = await launch(t);
  const ann = await site.person('ann').open();
  assert.equal((await ann.call('create')).ok, true);
  assert.equal((await ann.call('start')).ok, false, 'one player is not enough');
  assert.equal((await ann.call('fillBots')).ok, true);
  await until(() => ann.state.players.length === 3, 'two bots');
  assert.equal((await ann.call('setRounds', { count: 1 })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state.phase !== 'lobby', 'the game to start');
  assert.ok(ann.state.players.filter((p) => p.bot).every((p) => p.ai && p.connected));
  await drive([ann]);
  assert.equal(ann.state.completedRounds, 3);
  await sleep(100);
  assert.equal((await ann.stats()).perGame[0].played, 1);
  assert.equal(resultRows(site), 1, 'one account in the result: the bots are not recorded');
  assert.equal(JSON.stringify(ann.state).includes('bot:'), false, 'bot tokens are not sent out');
  // Back to the lobby keeps the bots; the AIs are dealt again at the next start.
  assert.equal((await ann.call('endGame')).ok, true);
  await until(() => ann.state.phase === 'lobby' && ann.state.players.length === 3, 'the lobby with its bots');
  assert.ok(ann.state.players.every((p) => p.ai === null));
});

test('over sockets: three people and bots at the maximum size finish a game', async (t) => {
  const site = await launch(t);
  const people = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const [ann, bob, cat] = people;
  const { code } = await ann.call('create');
  for (const p of [bob, cat]) assert.equal((await p.call('join', { code })).ok, true);
  assert.equal((await bob.call('addBot')).ok, false, 'only the host adds bots');
  assert.equal((await ann.call('fillBots', { count: MAX_PLAYERS })).ok, true);
  await until(() => cat.state.players.length === MAX_PLAYERS, 'a full table');
  assert.equal((await ann.call('addBot')).ok, false, 'the table is full');
  const dan = await site.person('dan').open();
  assert.equal((await dan.call('join', { code })).ok, false, 'no seat for another person either');
  const botId = ann.state.players.find((p) => p.bot).id;
  assert.equal((await bob.call('removeBot', { targetId: botId })).ok, false);
  assert.equal((await ann.call('removeBot', { targetId: botId })).ok, true);
  assert.equal((await ann.call('removeBot', { targetId: botId })).ok, false, 'already gone');
  assert.equal((await ann.call('setHandSize', { size: 3 })).ok, true);
  assert.equal((await ann.call('setRounds', { count: 1 })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await drive(people);
  assert.equal(ann.state.players.length, MAX_PLAYERS - 1);
  assert.equal(ann.state.completedRounds, MAX_PLAYERS - 1);
  await sleep(100);
  for (const p of people) assert.equal((await p.stats()).perGame[0].played, 1);
  assert.equal(resultRows(site), 1, 'one game');
  assert.equal(site.site.db.prepare('SELECT COUNT(*) AS n FROM result_players').get().n, 3, 'with three people in it');
});

test('over sockets: bots play the "chooser" and "favourite" styles too', async (t) => {
  const site = await launch(t);
  for (const mode of ['chooser', 'favourite']) {
    const ann = await site.person(`ann-${mode}`).open();
    await ann.call('create');
    await ann.call('fillBots', { count: 4 });
    await ann.call('setJudging', { mode });
    await ann.call('setRounds', { count: 1 });
    assert.equal((await ann.call('start')).ok, true);
    await drive([ann]);
    assert.equal(ann.state.judging, mode);
    assert.equal(ann.state.completedRounds, 4);
  }
});

test('over sockets: a person leaving or removed mid-game is replaced by a bot and the game goes on', async (t) => {
  const site = await launch(t);
  const people = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const [ann, bob, cat] = people;
  const { code } = await ann.call('create');
  for (const p of [bob, cat]) await p.call('join', { code });
  await ann.call('addBot');
  await ann.call('setRounds', { count: 1 });
  assert.equal((await ann.call('start')).ok, true);
  await until(() => bob.state?.phase === 'word', 'started');
  const bobSeat = bob.state.me.id;
  assert.equal((await bob.call('leave')).ok, true);
  await until(() => bob.state === null, 'bob out');
  await until(() => ann.state.players.find((p) => p.id === bobSeat)?.bot, 'a bot in the seat');
  assert.equal(ann.state.players.length, 4);
  assert.equal((await bob.call('resume', { code })).ok, false, 'he cannot get the seat back');
  assert.equal((await ann.call('removePlayer', { targetId: cat.state.me.id })).ok, true, 'the host removes cat');
  await until(() => cat.state === null, 'cat out');
  await until(() => ann.state.players.filter((p) => p.bot).length === 3, 'three bots');
  await drive([ann]);
  assert.equal(ann.state.players.length, 4);
  await sleep(100);
  assert.equal(site.site.db.prepare('SELECT COUNT(*) AS n FROM result_players').get().n, 1, 'only ann was left to record');
  // The last person leaving takes the room with them.
  assert.equal((await ann.call('leave')).ok, true);
  assert.deepEqual(await ann.call('lookup', { code }), { ok: true, code, exists: false });
});

test('over sockets: bots keep playing after the server restarts, and the saved seats keep their AIs', async (t) => {
  const first = await launch(t, { keep: true });
  const ann = await first.person('ann').open();
  const { code } = await ann.call('create');
  await ann.call('fillBots', { count: 5 });
  await ann.call('setRounds', { count: 1 });
  await ann.call('start');
  await until(() => ann.state.phase !== 'lobby', 'started');
  const aisBefore = ann.state.players.map((p) => p.ai?.id ?? null);
  await sleep(30);
  await first.stop();

  const again = await launch(t, { dataDir: first.dataDir });
  const back = again.person('ann');
  Object.assign(back, { cookie: ann.cookie, id: ann.id });
  await back.connect();
  assert.equal((await back.call('resume', { code })).ok, true);
  await until(() => back.state?.players.length === 5, 'the saved game');
  assert.deepEqual(back.state.players.map((p) => p.ai?.id ?? null), aisBefore);
  await drive([back]);
  assert.equal(back.state.completedRounds, 5);
});

test('over sockets: a lobby with only bots left is dropped', async (t) => {
  const site = await launch(t);
  const ann = await site.person('ann').open();
  const { code } = await ann.call('create');
  await ann.call('fillBots');
  assert.equal((await ann.call('leave')).ok, true);
  assert.deepEqual(await ann.call('lookup', { code }), { ok: true, code, exists: false });
});

test('over sockets: garbage to the bot events is refused and harms nothing', async (t) => {
  const site = await launch(t);
  const ann = await site.person('ann').open();
  const bob = await site.person('bob').open();
  const eve = await site.person('eve').open();
  const { code } = await ann.call('create');
  await bob.call('join', { code });
  for (const event of ['addBot', 'fillBots', 'removeBot']) assert.equal((await eve.call(event)).ok, false, `${event} from outside any game`);
  const junk = [undefined, null, 0, -1, 1.5, true, '', 'x', [], {}, ['a'], { a: 1 }, 'a'.repeat(100000), JSON.parse('{"__proto__":{"x":1}}')];
  for (const target of junk) {
    assert.equal((await ann.call('removeBot', { targetId: target })).ok, false);
    assert.equal((await ann.call('fillBots', { count: target })).ok, true, 'a nonsense count still means "enough to start"');
  }
  for (const payload of [undefined, null, 'x', 5, [], { targetId: { $gt: '' } }]) {
    ann.fire('addBot', payload);
    ann.fire('fillBots', payload);
    ann.fire('removeBot', payload);
  }
  assert.equal((await ann.call('removeBot', { targetId: bob.state.me.id })).ok, false, 'people are not bots');
  await until(() => ann.state.players.length >= 3, 'still a lobby');
  assert.ok(ann.state.players.length <= MAX_PLAYERS);
  assert.equal((await ann.call('setRounds', { count: 1 })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  assert.equal((await ann.call('addBot')).ok, false, 'no bots once started');
  assert.equal((await ann.call('fillBots')).ok, false);
  assert.equal((await ann.call('removeBot', { targetId: ann.state.players.find((p) => p.bot)?.id })).ok, false);
  assert.equal((await ann.call('declareAI', { id: 'sharp' })).ok, true, 'the external-bot event still works for accounts');
  await drive([ann, bob]);
  assert.equal(await site.alive(), true);
});

test('the scoreboard marks the chooser as the current player once the game is on', () => {
  const game = new Game({ getCardIds: () => cards(400), hints: [] });
  const host = game.addPlayer('Host', 'user:1');
  game.addPlayer('Guest', 'user:2');
  game.addBot(host.id);
  game.start(host.id);
  const current = game.viewFor(host.id).scoreboard.players.filter((p) => p.current);
  assert.equal(current.length, 1);
  assert.equal(current[0].id, game.viewFor(host.id).chooserId);
});
