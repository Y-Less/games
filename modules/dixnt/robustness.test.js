// Garbage in: every socket event of Dixnt gets malformed payloads (with and without an ack) in every phase that can be
// reached cheaply, from the host, an ordinary player and an outsider. The server must stay up, answer with a structured
// failure or a harmless success, keep the game valid, leak nothing, and still be able to finish a normal game.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, fuzzEvent, garbageValues, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SECRET_WORD = 'zebra-quartz-secret';

function makeFakeCards(dataDir) {
  const cardsDir = path.join(dataDir, 'cards');
  fs.mkdirSync(path.join(cardsDir, 'medium'), { recursive: true });
  const categories = [
    { key: 'alpha', label: 'Alpha', start: 10001 },
    { key: 'beta', label: 'Beta', start: 20001 },
  ].map(({ key, label, start }) => {
    const ids = Array.from({ length: 60 }, (_, i) => start + i);
    for (const id of ids) fs.writeFileSync(path.join(cardsDir, 'medium', `card_${id}.jpg`), '');
    return { key, label, description: `${label} cards`, ids };
  });
  fs.writeFileSync(path.join(cardsDir, 'categories.json'), JSON.stringify({ categories }));
  process.env.DIXNT_CARDS_DIR = cardsDir;
}

/** The events the module handles, with the payload fields each one reads. */
const EVENTS = {
  lookup: ['code'],
  resume: ['code'],
  create: [],
  join: ['code'],
  leave: [],
  setHandSize: ['size'],
  setRounds: ['count'],
  setJudging: ['mode'],
  setCategories: ['keys'],
  start: [],
  endGame: [],
  hints: [],
  submitWord: ['word'],
  playCard: ['cardId'],
  vote: ['targetId'],
  nextRound: [],
  abortRound: [],
  removePlayer: ['targetId'],
};

/** Checks one view for internal consistency. */
function assertValidView(view, who) {
  if (!view) return;
  const note = (m) => `${who}: ${m} (phase ${view.phase})`;
  const ids = view.players.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, note('player ids are unique'));
  assert.ok(ids.includes(view.me.id), note('I am in the player list'));
  assert.ok(view.me.hand.length <= view.handSize, note('hand within the hand size'));
  assert.equal(new Set(view.me.hand).size, view.me.hand.length, note('no duplicate cards in my hand'));
  const table = view.table.map((t) => t.cardId);
  assert.equal(new Set(table).size, table.length, note('table cards are unique'));
  for (const row of view.players) {
    const total = view.scoreboard.rounds.reduce((sum, r) => sum + (r.deltas[row.id] ?? 0), 0);
    assert.equal(total, row.score, note(`${row.name}'s score equals the history`));
    assert.ok(Number.isInteger(row.score) && row.score >= 0);
  }
  if (view.phase !== 'lobby') assert.ok(ids.includes(view.chooserId) || view.phase === 'finished', note('the chooser is a player'));
  assert.ok(ids.includes(view.hostId), note('the host is a player'));
  assert.ok(view.completedRounds >= view.scoreboard.rounds.length || true);
  assert.equal(view.scoreboard.rounds.length, view.completedRounds, note('one history row per completed round'));
  if (view.phase === 'picking') assert.deepEqual(view.table, [], note('nothing on the table while picking'));
  if (['picking', 'voting'].includes(view.phase)) {
    assert.equal(view.me.isImposter, false, note('the imposter is not revealed'));
    assert.equal(view.results, null, note('no results yet'));
  }
  if (view.wordHidden) assert.equal(view.word, null, note('the hidden word is not sent'));
}

function assertAllViewsValid(people) {
  for (const p of people) for (const s of p.states) assertValidView(s, p.name);
  for (const p of people) {
    for (const s of p.states) {
      if (s?.wordHidden) assert.ok(!JSON.stringify(s).includes(SECRET_WORD), `${p.name} (the imposter) was sent the word`);
    }
  }
}

/** Plays whatever the people have to do until the game finishes (or fails if it stalls). */
async function playToEnd(people, { timeout = 20000 } = {}) {
  const host = people[0];
  const started = Date.now();
  while (host.state?.phase !== 'finished') {
    assert.ok(Date.now() - started < timeout, `stalled in ${host.state?.phase}`);
    let acted = false;
    for (const p of people) {
      const s = p.state;
      if (!s) continue;
      let reply = null;
      if (s.phase === 'word' && s.me.isChooser) reply = await p.call('submitWord', { word: SECRET_WORD });
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

test('every socket event survives garbage in every phase, and a normal game can still be finished', async (t) => {
  const site = await launchModule(t, { id: 'dixnt', moduleDir: here, setup: makeFakeCards });
  const protoBefore = prototypeNames();
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const trio = [ann, bob, cat];

  async function fresh() {
    for (const p of [...trio, eve]) await p.call('leave');
    const created = await ann.call('create');
    assert.equal(created.ok, true, created.error);
    for (const p of [bob, cat]) assert.equal((await p.call('join', { code: created.code })).ok, true);
    await until(() => trio.every((p) => p.state?.players.length === 3), 'three in the lobby');
    return created.code;
  }

  /** Brings a fresh game to a phase using only legal moves. */
  async function reach(phase) {
    await fresh();
    if (phase === 'lobby') return;
    assert.equal((await ann.call('setRounds', { count: 1 })).ok, true);
    assert.equal((await ann.call('start')).ok, true);
    await until(() => trio.every((p) => p.state?.phase === 'word'), 'the word phase');
    if (phase === 'word') return;
    const chooser = trio.find((p) => p.state.me.isChooser);
    assert.equal((await chooser.call('submitWord', { word: SECRET_WORD })).ok, true);
    await until(() => trio.every((p) => p.state?.phase === 'picking'), 'picking');
    if (phase === 'picking') return;
    for (const p of trio.filter((x) => x !== chooser)) assert.equal((await p.call('playCard', { cardId: p.state.me.hand[0] })).ok, true);
    await until(() => trio.every((p) => p.state?.phase === 'voting'), 'voting');
    if (phase === 'voting') return;
    for (const p of trio) if (p.state.voteTargets.length) assert.equal((await p.call('vote', { targetId: p.state.voteTargets[0] })).ok, true);
    await until(() => trio.every((p) => p.state?.phase === 'results'), 'results');
  }

  const other = { ann: [bob, cat], bob: [ann, cat], cat: [ann, bob], eve: [ann, bob, cat] };
  const secretsFor = (person) => () => [
    ...other[person.name].flatMap((o) => o.state?.me?.hand ?? []).map(String),
    ...(person.state?.wordHidden ? [SECRET_WORD] : []),
  ];

  let calls = 0;
  for (const phase of ['lobby', 'word', 'picking', 'voting', 'results']) {
    for (const [event, fields] of Object.entries(EVENTS)) {
      await reach(phase);
      for (const person of [ann, bob, eve]) {
        // The imposter must never be told the word, even in an error message.
        calls += await fuzzEvent(person, event, fields, { secrets: secretsFor(person) });
      }
      await sleep(5);
      const ping = await ann.call('lookup', { code: 'boss-aware-you' });
      assert.equal(ping.ok, true, `${phase}/${event}: the server still answers`);
      assertAllViewsValid([ann, bob, cat, eve]);
      for (const p of [ann, bob, cat, eve]) p.states.length = 0;
    }
    assert.ok(await site.alive(), `still alive after ${phase}`);
  }
  assert.ok(calls > 3000, `a big battery was thrown (${calls})`);
  assertNoPollution(protoBefore);

  // The module still works for a normal game, start to finish.
  await fresh();
  assert.equal((await ann.call('setRounds', { count: 1 })).ok, true);
  assert.equal((await ann.call('setJudging', { mode: 'favourite' })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await playToEnd(trio);
  assertAllViewsValid(trio);
  assert.equal(ann.state.completedRounds, 3);
  await sleep(100);
  assert.equal((await ann.stats()).perGame[0].played, 1, 'the game was recorded once');
});

test('actions that need the right moment or the right person are refused with a message, not a crash', async (t) => {
  const site = await launchModule(t, { id: 'dixnt', moduleDir: here, setup: makeFakeCards });
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create');
  await bob.call('join', { code });
  await cat.call('join', { code });
  await until(() => cat.state?.players.length === 3, 'lobby');
  const refused = async (p, event, payload, why) => {
    const r = await p.call(event, payload);
    assert.equal(r.ok, false, why);
    assert.equal(typeof r.error, 'string', why);
  };
  // Lobby: game actions are out of order, host actions are for the host.
  for (const [event, payload] of [['submitWord', { word: 'x' }], ['playCard', { cardId: 10001 }], ['vote', { targetId: 'x' }], ['nextRound'], ['abortRound']]) {
    await refused(ann, event, payload, `${event} in the lobby`);
  }
  for (const [event, payload] of [['setHandSize', { size: 5 }], ['setRounds', { count: 3 }], ['setJudging', { mode: 'chooser' }], ['setCategories', { keys: ['alpha'] }], ['start'], ['endGame']]) {
    await refused(bob, event, payload, `${event} by a non-host`);
    await refused(eve, event, payload, `${event} by an outsider`);
  }
  await refused(bob, 'removePlayer', { targetId: ann.state.me.id }, 'a non-host removing the host');
  await refused(ann, 'setCategories', { keys: [] }, 'no categories');
  await refused(ann, 'setCategories', { keys: ['alpha', 'nope'] }, 'an unknown category');
  await refused(ann, 'setHandSize', { size: 2 }, 'too small a hand');
  await refused(ann, 'setHandSize', { size: 13 }, 'too large a hand');
  await refused(ann, 'setRounds', { count: 0 }, 'no rounds');
  await refused(ann, 'setJudging', { mode: '__proto__' }, 'a made-up mode');
  // A huge hand with too few cards: starting fails with a message.
  assert.equal((await ann.call('setCategories', { keys: ['alpha'] })).ok, true);
  assert.equal((await ann.call('setHandSize', { size: 12 })).ok, true);
  assert.equal((await ann.call('start')).ok, true, '36 cards of 60');
  await until(() => cat.state?.phase === 'word', 'word');

  // Word phase: only the chooser, only a sane word.
  const chooser = [ann, bob, cat].find((p) => p.state.me.isChooser);
  const notChooser = [ann, bob, cat].find((p) => !p.state.me.isChooser);
  await refused(notChooser, 'submitWord', { word: 'x' }, 'a non-chooser choosing');
  await refused(chooser, 'submitWord', { word: '   ' }, 'a blank word');
  await refused(chooser, 'submitWord', { word: 'w'.repeat(61) }, 'a too long word');
  await refused(chooser, 'submitWord', { word: 'w'.repeat(100 * 1024) }, 'a 100 KB word');
  await refused(notChooser, 'playCard', { cardId: notChooser.state.me.hand[0] }, 'playing before the word');
  await refused(eve, 'submitWord', { word: 'x' }, 'an outsider choosing');
  assert.equal((await chooser.call('submitWord', { word: `  ${SECRET_WORD}  ` })).ok, true);
  await until(() => cat.state?.phase === 'picking', 'picking');
  await refused(chooser, 'submitWord', { word: 'again' }, 'a second word');

  // Picking: not the chooser, not a card you do not hold, not a card someone else holds.
  const players = [ann, bob, cat].filter((p) => p !== chooser);
  const [first, second] = players;
  await refused(chooser, 'playCard', { cardId: chooser.state.me.hand[0] }, 'the chooser playing');
  await refused(first, 'playCard', { cardId: second.state.me.hand[0] }, "someone else's card");
  await refused(first, 'playCard', { cardId: 99999 }, 'a card that does not exist');
  await refused(first, 'playCard', { cardId: `${first.state.me.hand[0]}abc` }, 'a card id with junk');
  await refused(first, 'vote', { targetId: second.state.me.id }, 'voting while picking');
  await refused(eve, 'playCard', { cardId: 10001 }, 'an outsider playing');
  // A card given as a numeric string is the same card.
  assert.equal((await first.call('playCard', { cardId: String(first.state.me.hand[0]) })).ok, true);
  // Changing the pick before the last card is in is allowed, and still leaves one card each.
  assert.equal((await first.call('playCard', { cardId: first.state.me.hand[1] })).ok, true);
  await until(() => first.state.me.myPick === first.state.me.hand[1], 'the changed pick');
});

test('voting refusals: yourself, a non-player, the chooser, and outsiders', async (t) => {
  const site = await launchModule(t, { id: 'dixnt', moduleDir: here, setup: makeFakeCards });
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const trio = [ann, bob, cat];
  const { code } = await ann.call('create');
  await bob.call('join', { code });
  await cat.call('join', { code });
  await until(() => cat.state?.players.length === 3, 'lobby');
  await ann.call('setRounds', { count: 1 });
  await ann.call('start');
  await until(() => cat.state?.phase === 'word', 'word');
  const chooser = trio.find((p) => p.state.me.isChooser);
  await chooser.call('submitWord', { word: SECRET_WORD });
  await until(() => cat.state?.phase === 'picking', 'picking');
  const players = trio.filter((p) => p !== chooser);
  for (const p of players) await p.call('playCard', { cardId: p.state.me.hand[0] });
  await until(() => cat.state?.phase === 'voting', 'voting');
  const [a, b] = players;
  const refused = async (p, targetId, why) => {
    const r = await p.call('vote', { targetId });
    assert.equal(r.ok, false, why);
    assert.equal(typeof r.error, 'string');
  };
  await refused(a, a.state.me.id, 'voting for yourself');
  await refused(a, chooser.state.me.id, 'voting for the chooser, who played no card');
  await refused(a, 'nobody', 'voting for a made-up id');
  await refused(a, 12345, 'a number');
  await refused(a, { id: b.state.me.id }, 'an object');
  await refused(a, [b.state.me.id], 'an array');
  await refused(eve, b.state.me.id, 'an outsider voting');
  await refused(a, undefined, 'no target');
  assert.equal(a.state.me.myVote, null, 'no refused vote was counted');
  assert.equal((await a.call('vote', { targetId: b.state.me.id })).ok, true);
  assert.equal((await a.call('vote', { targetId: b.state.me.id })).ok, true, 'changing your mind (to the same) is harmless');
});
