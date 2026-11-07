// Built-in computer players: places in the room that the server plays for itself.  Rules first (no sockets), then real
// sockets: mixed rooms, whole games, a restart in the middle, people leaving, statistics, and garbage events.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';
import { AIS } from './ai/index.js';
import { createRules, JUDGING_MODES, MAX_PLAYERS, MIN_PLAYERS } from './game.js';
import { cards, makeRoom, seededRng } from './harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DIXNT_BOT_DELAY = '0-3';

/** A lobby with one person (the host, account 1) and `bots` computer players, ready to start. */
const lobbyWith = (bots, { judging = 'everyone', seed = 5, roundsEach = 1, handSize = 4 } = {}) =>
  makeRoom(['Host'], { cardCount: 400, hints: cards(30).map((n) => `hint ${n}`), bots, judging, roundsEach, handSize, seed });

/** Does whatever a person at the table would do next, using their own view; returns false if there is nothing to do. */
function personActs({ game, room, rng }, id) {
  const view = game.viewFor(room, id);
  if (room.phase === 'results') {
    if (room.hostId !== id) return false;
    game.nextRound(room, id, rng);
  } else if (room.phase === 'word' && view.me.isChooser) game.submitWord(room, id, 'a word', rng);
  else if (room.phase === 'picking' && !view.me.isChooser && view.me.myPick === null) game.playCard(room, id, view.me.hand[0], rng);
  else if (room.phase === 'voting' && view.voteTargets.length && view.me.myVote === null) game.vote(room, id, view.voteTargets[0]);
  else return false;
  return true;
}

/** Computer players act until the game is over; the people given act when it is their turn (the first is the host). */
function playOut(made, people, { guard = 5000 } = {}) {
  const { game, room, rng } = made;
  for (let i = 0; i < guard; i++) {
    if (room.phase === 'finished') return;
    if (game.runBotAction(room, rng)) continue;
    if (!people.some((id) => personActs(made, id))) assert.fail(`stuck in ${room.phase}`);
  }
  assert.fail('the game did not finish');
}

test('the host adds, fills and removes computer players in the lobby, up to the maximum', () => {
  const { game, room, rng } = makeRoom(['Host', 'Guest'], { cardCount: 400 });
  assert.equal(game.addBot(room, 2).error, 'hostOnlyAddBots', 'only the host adds');
  assert.equal(game.fillWithBots(room, 2).error, 'hostOnlyAddBots');
  const { id } = game.addBot(room, 1);
  assert.equal(game.playerOf(room, id).kind, 'bot');
  assert.deepEqual(game.viewFor(room, 1).scoreboard.players.map((p) => p.bot), [false, false, true], 'the scoreboard marks computer players');
  assert.equal(game.viewFor(room, 1).scoreboard.players.some((p) => p.current), false, 'nobody is the chooser in the lobby');
  assert.equal(String(id).startsWith('bot:'), true);
  assert.equal(game.playerOf(room, id).hand.length, 0);
  assert.equal(game.removeBot(room, 2, id, rng).error, 'hostOnlyRemoveBots');
  assert.equal(game.removeBot(room, 1, 2, rng).error, 'notAComputer', 'people are not computer players');
  assert.equal(game.removeBot(room, 1, 'nobody', rng).error, 'notAComputer');
  assert.equal(game.removeBot(room, 1, id, rng).ok, true);
  assert.equal(room.players.length, 2);

  assert.equal(game.fillWithBots(room, 1).ok, true);
  assert.equal(room.players.length, MIN_PLAYERS, 'fills up to the minimum by default');
  game.fillWithBots(room, 1, 6);
  assert.equal(room.players.length, 6);
  game.fillWithBots(room, 1, 'many');
  assert.equal(room.players.length, 6, 'a nonsense target changes nothing');
  game.fillWithBots(room, 1, 500);
  assert.equal(room.players.length, MAX_PLAYERS, 'never more than the maximum');
  assert.equal(game.addBot(room, 1).error, 'gameFull');
  assert.equal(game.addHuman(room, 9, 'Late').error, 'gameFull', 'people cannot take a thirteenth place either');
  const names = room.players.map((p) => p.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'every name is different');
  assert.equal(room.players.filter((p) => p.kind === 'bot').length, MAX_PLAYERS - 2);

  assert.equal(game.start(room, 1, rng).ok, true);
  assert.equal(game.addBot(room, 1).error, 'botsLobbyOnly', 'not once the game has started');
  assert.equal(game.fillWithBots(room, 1).error, 'botsLobbyOnly');
  assert.equal(game.removeBot(room, 1, room.players[2].id, rng).error, 'botsRemoveLobbyOnly');
});

test('a computer player never shares a name with a person', () => {
  const { game, room } = makeRoom(['Ada'], { cardCount: 400 });
  game.addBot(room, 1);
  assert.notEqual(room.players[1].name.toLowerCase(), 'ada');
  assert.equal(game.addHuman(room, 2, room.players[1].name).ok, true);
  assert.notEqual(room.players[2].name.toLowerCase(), room.players[1].name.toLowerCase(), 'the newcomer is renamed instead');
});

test('starting deals every computer player an AI from the game rng, and the view shows it for them only', () => {
  const ais = (seed) => {
    const made = lobbyWith(6, { seed });
    assert.ok(made.game.viewFor(made.room, 1).players.every((p) => p.ai === null), 'no AI before the game starts');
    assert.equal(made.game.start(made.room, 1, made.rng).ok, true);
    return made.room.players.map((p) => p.ai ?? null);
  };
  assert.deepEqual(ais(3), ais(3), 'the same seed deals the same AIs');
  const seen = new Set();
  for (let seed = 1; seed < 30; seed++) for (const ai of ais(seed)) seen.add(ai);
  assert.ok(seen.size > 2, 'different seeds deal different AIs');
  assert.ok([...seen].every((id) => id === null || AIS.some((ai) => ai.id === id)));

  const { game, room, rng } = lobbyWith(3);
  game.start(room, 1, rng);
  const view = game.viewFor(room, 1);
  assert.equal(view.players[0].ai, null, 'a person has no AI');
  assert.equal(view.players[0].bot, false);
  for (const p of view.players.slice(1)) {
    assert.equal(p.bot, true);
    assert.deepEqual(Object.keys(p.ai).sort(), ['id', 'name']);
    assert.equal(p.connected, true, 'a computer player is never shown as offline');
  }
  assert.ok(view.scoreboard.players.filter((p) => p.id !== 1).every((p) => !p.away), 'computer players are never away');
  assert.equal(JSON.stringify(view).includes('"token"'), false, 'no seat tokens anywhere');

  // Back in the lobby the places stay, and the AIs are dealt again at the next start.
  game.playAgain(room, 1);
  assert.ok(room.players.slice(1).every((p) => p.kind === 'bot' && p.ai === undefined));
  game.start(room, 1, rng);
  assert.ok(room.players.slice(1).every((p) => p.ai));
});

for (const judging of JUDGING_MODES) {
  for (const bots of [MIN_PLAYERS - 1, MAX_PLAYERS - 1]) {
    test(`the host and ${bots} computer players play a whole "${judging}" game, computers choosing, playing and voting`, () => {
      const made = lobbyWith(bots, { judging, roundsEach: 2, seed: bots });
      const { game, room, rng } = made;
      game.start(room, 1, rng);
      const chosenBy = new Set();
      for (let guard = 0; guard < 5000 && room.phase !== 'finished'; guard++) {
        if (room.phase === 'word') chosenBy.add(room.chooserId);
        if (game.runBotAction(room, rng)) continue;
        if (!personActs(made, 1)) assert.fail(`stuck in ${room.phase}`);
      }
      assert.equal(room.phase, 'finished');
      assert.equal(room.completed, (bots + 1) * 2);
      assert.ok(room.players.every((p) => p.turns === 2));
      assert.equal(chosenBy.size, bots + 1, 'computer players and the person each chose the word');
      assert.equal(room.history.length, room.completed, 'the shared scoreboard has every round');
      for (const p of room.players) {
        assert.equal(p.score, room.history.reduce((sum, r) => sum + (r.deltas[p.id] ?? 0), 0), 'columns add up');
      }
      const view = game.viewFor(room, 1);
      assert.equal(view.phase, 'finished');
      assert.ok(view.winners.length >= 1);
    });
  }
}

test('computer players decide from what a person in their place sees: no clue for the imposter, only their own hand', () => {
  const seen = { cards: [], votes: [] };
  const spy = { ...AIS[0], id: 'spy', playCard: (ctx) => (seen.cards.push(ctx), ctx.hand[0]), vote: (ctx) => (seen.votes.push(ctx), ctx.targets[0]) };
  AIS.push(spy);
  try {
    for (const judging of JUDGING_MODES) {
      const made = lobbyWith(5, { judging, roundsEach: 1, seed: 11 });
      const { game, room, rng } = made;
      game.start(room, 1, rng);
      for (const p of room.players) if (p.kind === 'bot') p.ai = 'spy';
      let cardsChecked = 0;
      let votesChecked = 0;
      for (let guard = 0; guard < 2000 && room.phase !== 'finished'; guard++) {
        const action = game.pendingBotAction(room);
        if (!action) {
          assert.ok(personActs(made, 1), `stuck in ${room.phase}`);
          continue;
        }
        const me = game.playerOf(room, action.id);
        const imposter = room.imposterId === me.id;
        const hand = [...me.hand];
        const cardsBefore = seen.cards.length;
        const votesBefore = seen.votes.length;
        game.runBotAction(room, rng, action);
        if (action.type === 'card') {
          const ctx = seen.cards[cardsBefore];
          assert.deepEqual(ctx.hand, hand, 'its own hand');
          assert.equal(ctx.word, imposter ? null : room.word, 'the clue unless it is the imposter');
          cardsChecked++;
        } else if (action.type === 'vote') {
          const ctx = seen.votes[votesBefore];
          assert.equal(ctx.word, room.word, 'the clue is revealed by now');
          assert.ok(!ctx.targets.includes(action.id), 'never itself');
          assert.deepEqual(Object.keys(ctx.table[0]).sort(), ['cardId', 'playerId']);
          assert.equal(ctx.imposter, imposter);
          assert.equal(ctx.chooser, room.chooserId === action.id);
          votesChecked++;
        }
      }
      assert.equal(room.phase, 'finished');
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
    const made = lobbyWith(4, { roundsEach: 1 });
    made.game.start(made.room, 1, made.rng);
    for (const p of made.room.players) if (p.kind === 'bot') p.ai = 'broken';
    playOut(made, [1]);
    assert.equal(made.room.phase, 'finished');
  } finally {
    AIS.pop();
  }
});

test('a computer chooser still gives a word when the hint list is empty', () => {
  const made = makeRoom(['Host'], { cardCount: 400, hints: [], bots: 2, seed: 2 });
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  room.chooserId = room.players[1].id;
  assert.equal(game.runBotAction(room, rng), true);
  assert.equal(room.phase, 'picking');
  assert.ok(room.word);
});

test('computer players never block the results screen: only the host moves on', () => {
  const made = lobbyWith(3, { roundsEach: 2 });
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  while (room.phase !== 'results') if (!game.runBotAction(room, rng)) assert.ok(personActs(made, 1));
  assert.equal(game.pendingBotAction(room), null, 'they wait at the results');
  assert.equal(game.runBotAction(room, rng), false);
  game.nextRound(room, 1, rng);
  assert.equal(room.phase, 'word');
});

test('a person leaving mid-round is replaced by a computer player who keeps their hand, score and played card', () => {
  const made = lobbyWith(1, { roundsEach: 2 });
  const { game, room, rng } = made;
  assert.equal(game.addHuman(room, 2, 'Guest').ok, true);
  assert.equal(game.addHuman(room, 3, 'Third').ok, true);
  game.start(room, 1, rng);
  game.submitWord(room, room.chooserId, 'clue', rng);
  const guest = game.playerOf(room, 2);
  const guestPlays = game.cardPlayers(room).some((p) => p.id === 2);
  const hand = [...guest.hand];
  if (guestPlays) game.playCard(room, 2, hand[2], rng);
  assert.equal(game.removeHuman(room, 2, rng, 0).ok, true);
  const stand = room.players.find((p) => p.stoodInFor === 2);
  assert.equal(stand.kind, 'bot');
  assert.notEqual(stand.name, 'Guest');
  assert.ok(stand.ai && AIS.some((ai) => ai.id === stand.ai));
  assert.equal(game.playerOf(room, 2), undefined, 'the account no longer has a place');
  assert.deepEqual(stand.hand, hand);
  if (guestPlays) assert.equal(room.picks[stand.id], hand[2], 'what they had played stays played');
  assert.equal(room.phase, 'picking', 'the round carries on');
  assert.equal(room.players.length, 4);
  assert.equal(game.humans(room).length, 2);

  // The host leaves too: the other person hosts; then the last person leaving empties the room.
  assert.equal(game.removeHuman(room, 1, rng, 0).ok, true);
  assert.equal(room.hostId, 3);
  assert.equal(game.playerOf(room, 1), undefined);
  assert.equal(game.humans(room).length, 1);
  assert.equal(game.removeHuman(room, 3, rng, 0).empty, true, 'no people left: the server drops the game');
});

test('a person who was the chooser, or who still owed a card or a vote, is replaced and the game still finishes', () => {
  for (const phase of ['word', 'picking', 'voting', 'results']) {
    const made = lobbyWith(1, { roundsEach: 1, seed: 21 });
    const { game, room, rng } = made;
    assert.equal(game.addHuman(room, 2, 'Guest').ok, true);
    game.start(room, 1, rng);
    // Play on (for the host and the guest) until the phase wanted is reached, with the guest still owing their move.
    for (let guard = 0; guard < 200 && room.phase !== phase; guard++) {
      if (game.runBotAction(room, rng)) continue;
      const mover = room.phase === 'word' ? room.chooserId : 1;
      assert.ok(personActs(made, mover) || personActs(made, 2), `stuck in ${room.phase}`);
      if (room.phase === phase) break;
    }
    assert.equal(room.phase, phase);
    assert.equal(game.removeHuman(room, 2, rng, 0).ok, true);
    assert.equal(room.players.find((p) => p.stoodInFor === 2).kind, 'bot');
    assert.equal(room.phase, phase);
    playOut(made, [1]);
    assert.equal(room.phase, 'finished', `a game that lost a person in "${phase}" still finishes`);
  }
});

test('leavers in the lobby or after the game, and the place somebody comes back to', () => {
  // Lobby: the place is simply given up.
  const made = lobbyWith(1);
  const { game, room, rng } = made;
  assert.equal(game.addHuman(room, 2, 'Guest').ok, true);
  assert.equal(game.removeHuman(room, 2, rng, 0).ok, true);
  assert.equal(game.playerOf(room, 2), undefined);
  game.addBot(room, 1);
  assert.equal(game.start(room, 1, rng).ok, true);

  // Mid-game somebody arriving takes a computer player's place, and leaving hands it back.
  assert.equal(game.addHuman(room, 3, 'Late').ok, true);
  assert.equal(room.players.length, 3, 'no place is made for them');
  assert.equal(game.removeHuman(room, 3, rng, 0).ok, true);
  assert.equal(room.players.length, 3);
  assert.equal(room.players.filter((p) => p.kind === 'bot').length, 2);

  // After the game ends a leaver stays on the final standings.
  const again = lobbyWith(3);
  again.game.start(again.room, 1, again.rng);
  playOut(again, [1]);
  assert.equal(again.room.phase, 'finished');
  const left = again.game.removeHuman(again.room, 1, again.rng, 0);
  assert.equal(left.changed, false);
  assert.equal(again.game.playerOf(again.room, 1).name, 'Host', 'they are still on the scoreboard');
});

test('computer players survive a save and reload', () => {
  const made = lobbyWith(3, { roundsEach: 2 });
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  for (let i = 0; i < 6; i++) game.runBotAction(room, rng);
  const later = createRules({ getCardIds: () => cards(400), hints: cards(30).map(String) });
  const again = later.migrate(JSON.parse(JSON.stringify(room)), undefined, seededRng(9));
  assert.deepEqual(again.players.map((p) => [p.kind, p.ai ?? null]), room.players.map((p) => [p.kind, p.ai ?? null]));
  playOut({ game: later, room: again, rng: seededRng(9) }, [1]);
  assert.equal(again.phase, 'finished');
  // An older save with no computer players marked loads as before.
  const old = JSON.parse(JSON.stringify(room));
  for (const p of old.players) {
    delete p.kind;
    delete p.bot;
  }
  delete old.nextBot;
  assert.equal(later.humans(later.migrate(old)).length, 4);
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

/** Plays for the people given until the game is over: the first is the host and moves rounds on; computers act for themselves. */
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
      else if (s.phase === 'picking' && !s.me.isChooser && s.me.myPick === null) reply = await p.call('playCard', { cardId: s.me.hand[0] });
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

test('over sockets: the host fills with computer players and starts, the server plays them to the end, and only people are in the statistics', async (t) => {
  const site = await launch(t);
  const ann = await site.person('ann').open();
  assert.equal((await ann.call('create')).ok, true);
  assert.equal((await ann.call('start')).ok, false, 'one player is not enough');
  assert.equal((await ann.call('fillBots')).ok, true);
  await until(() => ann.state.players.length === 3, 'two computer players');
  assert.equal((await ann.call('settings', { roundsEach: 1 })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state.phase !== 'lobby', 'the game to start');
  assert.ok(ann.state.players.filter((p) => p.bot).every((p) => p.ai && p.connected));
  await drive([ann]);
  assert.equal(ann.state.completedRounds, 3);
  await sleep(100);
  assert.equal((await ann.stats()).perGame[0].played, 1);
  assert.equal(resultRows(site), 1, 'one account in the result: the computer players are not recorded');
  assert.equal(JSON.stringify(ann.state).includes('"token"'), false, 'no seat tokens are sent out');
  // Back to the lobby keeps them; the AIs are dealt again at the next start.
  assert.equal((await ann.call('again')).ok, true);
  await until(() => ann.state.phase === 'lobby' && ann.state.players.length === 3, 'the lobby with its computer players');
  assert.ok(ann.state.players.every((p) => p.ai === null));
});

test('over sockets: three people and computer players at the maximum size finish a game', async (t) => {
  const site = await launch(t);
  const people = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const [ann, bob, cat] = people;
  const { code } = await ann.call('create');
  for (const p of [bob, cat]) assert.equal((await p.call('join', { code })).ok, true);
  assert.equal((await bob.call('addBot')).ok, false, 'only the host adds them');
  assert.equal((await ann.call('fillBots', { count: MAX_PLAYERS })).ok, true);
  await until(() => cat.state.players.length === MAX_PLAYERS, 'a full table');
  assert.equal((await ann.call('addBot')).ok, false, 'the table is full');
  const dan = await site.person('dan').open();
  assert.equal((await dan.call('join', { code })).ok, false, 'no place for another person either');
  const botId = ann.state.players.find((p) => p.bot).id;
  assert.equal((await bob.call('removeBot', { seat: botId })).ok, false);
  assert.equal((await ann.call('removeBot', { seat: botId })).ok, true);
  assert.equal((await ann.call('removeBot', { seat: botId })).ok, false, 'already gone');
  assert.equal((await ann.call('settings', { handSize: 3, roundsEach: 1 })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await drive(people);
  assert.equal(ann.state.players.length, MAX_PLAYERS - 1);
  assert.equal(ann.state.completedRounds, MAX_PLAYERS - 1);
  await sleep(100);
  for (const p of people) assert.equal((await p.stats()).perGame[0].played, 1);
  assert.equal(resultRows(site), 1, 'one game');
  assert.equal(site.site.db.prepare('SELECT COUNT(*) AS n FROM result_players').get().n, 3, 'with three people in it');
});

test('over sockets: computer players play the "chooser" and "favourite" styles too', async (t) => {
  const site = await launch(t);
  for (const mode of ['chooser', 'favourite']) {
    const ann = await site.person(`ann-${mode}`).open();
    await ann.call('create');
    await ann.call('fillBots', { count: 4 });
    await ann.call('settings', { judging: mode, roundsEach: 1 });
    assert.equal((await ann.call('start')).ok, true);
    await drive([ann]);
    assert.equal(ann.state.judging, mode);
    assert.equal(ann.state.completedRounds, 4);
  }
});

test('over sockets: a person leaving or removed mid-game is replaced, and the one who left can come back', async (t) => {
  const site = await launch(t);
  const people = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const [ann, bob, cat] = people;
  const { code } = await ann.call('create');
  for (const p of [bob, cat]) await p.call('join', { code });
  await ann.call('addBot');
  await ann.call('settings', { roundsEach: 1 });
  assert.equal((await ann.call('start')).ok, true);
  await until(() => bob.state?.phase === 'word', 'started');
  assert.equal((await bob.call('leave')).ok, true);
  await until(() => bob.state === null, 'bob out');
  await until(() => ann.state.players.filter((p) => p.bot).length === 2, 'a computer player in his place');
  assert.equal(ann.state.players.length, 4);

  // His place was being kept warm for him, so the invitation lets him back into it.
  assert.equal((await bob.call('join', { code })).ok, true, 'he can take his place back');
  await until(() => bob.state?.me.id === bob.id, 'bob back in');
  assert.equal(ann.state.players.length, 4);
  assert.equal((await bob.call('leave')).ok, true);
  await until(() => bob.state === null, 'bob out again');

  assert.equal((await ann.call('kick', { userId: cat.id })).ok, true, 'the host removes cat');
  await until(() => cat.state === null, 'cat out');
  await until(() => ann.state.players.filter((p) => p.bot).length === 3, 'three computer players');
  assert.equal((await cat.call('join', { code })).ok, false, 'being put out bars her from the invitation');
  await drive([ann]);
  assert.equal(ann.state.players.length, 4);
  await sleep(100);
  assert.equal(site.site.db.prepare('SELECT COUNT(*) AS n FROM result_players').get().n, 1, 'only ann was left to record');
  // A finished game keeps its final standings for anybody who opens the invitation again.
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null, 'ann back at the menu');
  assert.equal((await ann.call('join', { code })).ok, true);
  await until(() => ann.state?.phase === 'finished', 'the final standings');
});

test('over sockets: computer players keep playing after the server restarts, and the saved places keep their AIs', async (t) => {
  const first = await launch(t, { keep: true });
  const ann = await first.person('ann').open();
  const { code } = await ann.call('create');
  await ann.call('fillBots', { count: 5 });
  await ann.call('settings', { roundsEach: 1 });
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

test('over sockets: a lobby with only computer players left is dropped', async (t) => {
  const site = await launch(t);
  const ann = await site.person('ann').open();
  const { code } = await ann.call('create');
  await ann.call('fillBots');
  assert.equal((await ann.call('leave')).ok, true);
  assert.equal((await ann.call('join', { code })).ok, false, 'the room is gone');
});

test('over sockets: garbage to the computer-player events is refused and harms nothing', async (t) => {
  const site = await launch(t);
  const ann = await site.person('ann').open();
  const bob = await site.person('bob').open();
  const eve = await site.person('eve').open();
  const { code } = await ann.call('create');
  await bob.call('join', { code });
  for (const event of ['addBot', 'fillBots', 'removeBot']) assert.equal((await eve.call(event)).ok, false, `${event} from outside any game`);
  const junk = [undefined, null, 0, -1, 1.5, true, '', 'x', [], {}, ['a'], { a: 1 }, 'a'.repeat(100000), JSON.parse('{"__proto__":{"x":1}}')];
  for (const target of junk) {
    assert.equal((await ann.call('removeBot', { seat: target })).ok, false);
    assert.equal((await ann.call('fillBots', { count: target })).ok, true, 'a nonsense count still means "enough to start"');
  }
  for (const payload of [undefined, null, 'x', 5, [], { seat: { $gt: '' } }]) {
    ann.fire('addBot', payload);
    ann.fire('fillBots', payload);
    ann.fire('removeBot', payload);
  }
  assert.equal((await ann.call('removeBot', { seat: bob.id })).ok, false, 'people are not computer players');
  await until(() => ann.state.players.length >= 3, 'still a lobby');
  assert.ok(ann.state.players.length <= MAX_PLAYERS);
  assert.equal((await ann.call('settings', { roundsEach: 1 })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  assert.equal((await ann.call('addBot')).ok, false, 'none once started');
  assert.equal((await ann.call('fillBots')).ok, false);
  assert.equal((await ann.call('removeBot', { seat: ann.state.players.find((p) => p.bot)?.id })).ok, false);
  await drive([ann, bob]);
  assert.equal(await site.alive(), true);
});

test('the scoreboard marks the chooser as the current player once the game is on', () => {
  const { game, room, rng } = makeRoom(['Host', 'Guest'], { cardCount: 400, bots: 1 });
  assert.equal(game.start(room, 1, rng).ok, true);
  const current = game.viewFor(room, 1).scoreboard.players.filter((p) => p.current);
  assert.equal(current.length, 1);
  assert.equal(current[0].id, game.viewFor(room, 1).chooserId);
});
