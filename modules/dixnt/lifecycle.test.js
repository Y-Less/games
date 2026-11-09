// Concurrency and lifecycle of Dixnt over real sockets: simultaneous actions, one account on two sockets, disconnects
// and reconnects in every phase, the host leaving, a game disappearing under connected sockets, several games per account.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DIXNT_BOT_DELAY = '0-3';

function makeFakeCards(dataDir) {
  const cardsDir = path.join(dataDir, 'cards');
  fs.mkdirSync(path.join(cardsDir, 'medium'), { recursive: true });
  const ids = Array.from({ length: 150 }, (_, i) => 10001 + i);
  for (const id of ids) fs.writeFileSync(path.join(cardsDir, 'medium', `card_${id}.jpg`), '');
  fs.writeFileSync(path.join(cardsDir, 'categories.json'), JSON.stringify({ categories: [{ key: 'all', label: 'All', description: '', ids }] }));
  process.env.DIXNT_CARDS_DIR = cardsDir;
}

const launch = (t) => launchModule(t, { id: 'dixnt', moduleDir: here, setup: makeFakeCards });

/** A lobby of the named people (the first is the host). */
async function lobby(site, names, { rounds = 1 } = {}) {
  const people = await Promise.all(names.map((n) => site.person(n).open()));
  const [host, ...rest] = people;
  const created = await host.call('create');
  assert.equal(created.ok, true, created.error);
  for (const p of rest) assert.equal((await p.call('join', { code: created.code })).ok, true);
  await until(() => people.every((p) => p.state?.players.length === names.length), 'everybody in the lobby');
  assert.equal((await host.call('settings', { roundsEach: rounds })).ok, true);
  return { people, host, code: created.code };
}

const everyone = (people, phase) => until(() => people.every((p) => p.state?.phase === phase), `everyone to see ${phase}`);
const chooserOf = (people) => people.find((p) => p.state.me.isChooser);

/** Makes only the single step that leads into `phase` from the one before it. */
async function enterPhase(people, host, phase) {
  const order = ['lobby', 'word', 'picking', 'voting', 'results'];
  const stage = order.indexOf(phase);
  if (stage === 1) assert.equal((await host.call('start')).ok, true);
  if (stage === 2) assert.equal((await chooserOf(people).call('submitWord', { word: 'a word' })).ok, true);
  if (stage === 3) for (const p of people.filter((x) => !x.state.me.isChooser)) assert.equal((await p.call('playCard', { cardId: p.state.me.hand[0] })).ok, true);
  if (stage === 4) for (const p of people) if (p.state.voteTargets.length) assert.equal((await p.call('vote', { targetId: p.state.voteTargets[0] })).ok, true);
  await everyone(people, phase);
}

async function toPhase(people, host, phase) {
  const order = ['lobby', 'word', 'picking', 'voting', 'results'];
  const goal = order.indexOf(phase);
  if (goal >= 1) {
    assert.equal((await host.call('start')).ok, true);
    await everyone(people, 'word');
  }
  if (goal >= 2) {
    assert.equal((await chooserOf(people).call('submitWord', { word: 'a word' })).ok, true);
    await everyone(people, 'picking');
  }
  if (goal >= 3) {
    for (const p of people.filter((x) => !x.state.me.isChooser)) assert.equal((await p.call('playCard', { cardId: p.state.me.hand[0] })).ok, true);
    await everyone(people, 'voting');
  }
  if (goal >= 4) {
    for (const p of people) if (p.state.voteTargets.length) assert.equal((await p.call('vote', { targetId: p.state.voteTargets[0] })).ok, true);
    await everyone(people, 'results');
  }
}

async function finish(people, host) {
  const started = Date.now();
  while (host.state?.phase !== 'finished') {
    assert.ok(Date.now() - started < 20000, `stalled in ${host.state?.phase}`);
    let acted = false;
    for (const p of people) {
      const s = p.state;
      if (!s) continue;
      let reply = null;
      if (s.phase === 'word' && s.me.isChooser) reply = await p.call('submitWord', { word: 'w' });
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

test('two people acting in the same tick: both cards count once, both votes count once, the round is scored once', async (t) => {
  const site = await launch(t);
  const { people, host } = await lobby(site, ['ann', 'bob', 'cat', 'dan']);
  await toPhase(people, host, 'picking');
  const players = people.filter((p) => !p.state.me.isChooser);
  const replies = await Promise.all(players.map((p) => p.call('playCard', { cardId: p.state.me.hand[0] })));
  assert.ok(replies.every((r) => r.ok), JSON.stringify(replies));
  await everyone(people, 'voting');
  assert.equal(people[0].state.table.length, 3, 'one card per player, no duplicates');
  assert.equal(new Set(people[0].state.table.map((x) => x.cardId)).size, 3);

  const voters = people.filter((p) => p.state.voteTargets.length);
  const votes = await Promise.all(voters.map((p) => p.call('vote', { targetId: p.state.voteTargets[0] })));
  assert.ok(votes.every((r) => r.ok), JSON.stringify(votes));
  await everyone(people, 'results');
  assert.equal(host.state.completedRounds, 1);
  assert.equal(host.state.scoreboard.rounds.length, 1, 'scored once');
  // Pressing "next round" from everybody at once moves on exactly one round (the game has one round each: 4 rounds).
  await Promise.all(people.map((p) => p.call('nextRound')));
  await until(() => host.state.phase === 'word', 'the next round');
  assert.equal(host.state.round, 2, 'only one round was started');
  await sleep(30);
  assert.equal(host.state.round, 2);
});

test('both pressing start in the same tick starts one game; a second socket of the host acts at the same time', async (t) => {
  const site = await launch(t);
  const { people, host } = await lobby(site, ['ann', 'bob', 'cat']);
  const second = await host.twin();
  assert.equal((await second.call('resume')).ok, true);
  const replies = await Promise.all([host.call('start'), second.call('start'), people[1].call('start')]);
  assert.equal(replies.filter((r) => r.ok).length, 1, 'exactly one start worked');
  assert.ok(replies.filter((r) => !r.ok).every((r) => typeof r.error === 'string'));
  await everyone([...people, second], 'word');
  for (const p of [...people, second]) assert.equal(p.state.round, 1);
  assert.deepEqual(host.state.me.hand, second.state.me.hand, 'both sockets of one account share one hand');

  // Both sockets choose the word at once (whichever account is the chooser): one succeeds.
  const chooser = chooserOf(people);
  const twin = chooser === host ? second : await chooser.twin();
  await twin.call('resume');
  const words = await Promise.all([chooser.call('submitWord', { word: 'first' }), twin.call('submitWord', { word: 'second' })]);
  assert.equal(words.filter((r) => r.ok).length, 1);
  await everyone(people, 'picking');
  // And the same card from both sockets of a card player.
  const player = people.find((p) => !p.state.me.isChooser);
  const playerTwin = player === host ? second : await player.twin();
  await playerTwin.call('resume');
  const [c1, c2] = player.state.me.hand;
  const picks = await Promise.all([player.call('playCard', { cardId: c1 }), playerTwin.call('playCard', { cardId: c2 })]);
  assert.ok(picks.every((r) => r.ok), 'a change of mind is harmless');
  await until(() => player.state.me.myPick !== null, 'a pick');
  assert.ok([c1, c2].includes(player.state.me.myPick));
  assert.equal(playerTwin.state.me.myPick, player.state.me.myPick, 'both sockets agree');
  assert.equal(player.state.players.filter((p) => p.hasPlayed).length, 1, 'one card, not two');
});

test('joining at the same instant: both get in with unique names, even with the same display name', async (t) => {
  const site = await launch(t);
  const host = await site.person('ann').open();
  const { code } = await host.call('create');
  const makers = await Promise.all(['sam1', 'sam2', 'sam3'].map(async (n) => {
    const p = site.person(n);
    const reg = await p.http('POST', '/api/auth/register', { username: n, password: `${n} password`, displayName: 'Sam' });
    assert.equal(reg.status, 200);
    return p.open();
  }));
  const replies = await Promise.all(makers.map((p) => p.call('join', { code })));
  assert.ok(replies.every((r) => r.ok), JSON.stringify(replies));
  await until(() => host.state.players.length === 4, 'four players');
  const names = host.state.players.map((p) => p.name);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, 4, `unique names: ${names}`);
  assert.equal(new Set(host.state.players.map((p) => p.id)).size, 4);
  // The same account joining twice at once is one player.
  const twin = await makers[0].twin();
  const again = await Promise.all([makers[0].call('join', { code }), twin.call('join', { code })]);
  assert.ok(again.every((r) => r.ok));
  await sleep(30);
  assert.equal(host.state.players.length, 4);
});

test('disconnecting and reconnecting in every phase keeps the same seat, hand and picks, and the game finishes', async (t) => {
  const site = await launch(t);
  const { people, host, code } = await lobby(site, ['ann', 'bob', 'cat']);
  const bob = people[1];
  const connectedOf = (viewer, who) => viewer.state.players.find((p) => p.id === who.state.me.id)?.connected;
  for (const phase of ['lobby', 'word', 'picking', 'voting', 'results']) {
    await enterPhase(people, host, phase);
    const before = bob.state;
    const bobId = before.me.id;
    bob.socket.close();
    await until(() => connectedOf(host, bob) === false || host.state.players.find((p) => p.id === bobId)?.connected === false, `bob to look away in ${phase}`);
    assert.equal(host.state.phase, phase, 'the game does not move when someone drops');
    await bob.connect();
    const reply = await bob.call('resume', { code });
    assert.equal(reply.ok, true, `${phase}: ${reply.error}`);
    await until(() => bob.state?.phase === phase, `bob to be back in ${phase}`);
    assert.equal(bob.state.me.id, bobId, 'the same player');
    assert.deepEqual(bob.state.me.hand, before.me.hand, 'the same hand');
    assert.equal(bob.state.me.myPick, before.me.myPick);
    assert.equal(bob.state.me.myVote, before.me.myVote);
    await until(() => host.state.players.find((p) => p.id === bobId)?.connected === true, 'bob online again');
    if (phase === 'results') break;
  }
  await finish(people, host);
  assert.equal(host.state.completedRounds, 3);
  await sleep(100);
  for (const p of people) assert.equal((await p.stats()).perGame[0].played, 1);
});

test('a disconnect is not a leave: the host dropping keeps the host role, and resume without a code finds the game', async (t) => {
  const site = await launch(t);
  const { people, host, code } = await lobby(site, ['ann', 'bob', 'cat']);
  host.socket.close();
  await until(() => people[1].state.players.find((p) => p.id === people[1].state.hostId)?.connected === false, 'the host to look away');
  assert.equal(people[1].state.players.length, 3, 'still seated');
  assert.equal((await people[1].call('start')).ok, false, 'the host role did not move');
  await host.connect();
  assert.equal((await host.call('resume')).ok, true, 'no code needed');
  await until(() => host.state?.phase === 'lobby', 'the lobby again');
  assert.equal(host.state.hostId, host.state.me.id);
  assert.equal((await host.call('start')).ok, true);
});

test('the host leaving hands the host role on, in the lobby and in the middle of a round', async (t) => {
  const site = await launch(t);
  const { people, host } = await lobby(site, ['ann', 'bob', 'cat', 'dan'], { rounds: 2 });
  const [, bob, cat] = people;
  assert.equal((await host.call('leave')).ok, true);
  await until(() => host.state === null, 'ann out');
  await until(() => bob.state.players.length === 3, 'three left');
  assert.equal(bob.state.hostId, bob.state.players[0].id, 'the next player in join order hosts');
  assert.equal((await cat.call('start')).ok, false, 'only the new host starts');
  const newHost = bob;
  const rest = people.filter((p) => p !== host);
  await toPhase(rest, newHost, 'picking');
  // The new host leaves in the middle of picking: a computer player takes the seat and the other person hosts.
  assert.equal((await newHost.call('leave')).ok, true);
  const remaining = rest.filter((p) => p !== newHost);
  await until(() => remaining.every((p) => p.state?.players.length === 3 && p.state.players.some((x) => x.bot)), 'a computer player in the seat');
  assert.equal(remaining.length, 2);
  assert.ok(remaining.every((p) => p.state.phase === 'picking'), 'the round carries on');
  assert.ok(remaining.some((p) => p.state.hostId === p.state.me.id), 'someone hosts');
  assert.ok(remaining.filter((p) => p.state.hostId === p.state.me.id).length === 1, 'exactly one host');
});

test('the game vanishing under connected sockets: the last player leaving ends it for every socket of theirs', async (t) => {
  const site = await launch(t);
  const { people, host, code } = await lobby(site, ['ann', 'bob', 'cat']);
  const [, bob, cat] = people;
  const bobPhone = await bob.twin();
  await bobPhone.call('resume', { code });
  await until(() => bobPhone.state?.phase === 'lobby', 'the phone to be in');
  for (const p of [host, cat]) assert.equal((await p.call('leave')).ok, true);
  await until(() => host.state === null && cat.state === null, 'ann and cat out');
  assert.equal((await bob.call('leave')).ok, true, 'the last one leaves');
  await until(() => bob.state === null && bobPhone.state === null, 'both of bob\'s sockets sent home');
  // Anything the phone tries now is refused politely; the code is dead.
  for (const [event, payload] of [['start'], ['submitWord', { word: 'x' }], ['playCard', { cardId: 10001 }], ['kick', { slot: 'x' }]]) {
    const reply = await bobPhone.call(event, payload);
    assert.equal(reply.ok, false, event);
  }
  assert.equal((await host.call('join', { code })).ok, false, 'no game has that code');
  assert.equal((await bob.call('resume')).code, null, 'and nothing to come back to');
  // The accounts are free to start again.
  const next = await host.call('create');
  assert.equal(next.ok, true);
  assert.notEqual(next.code, undefined);
});

test('the host removing a player sends every socket of theirs out and bars them; a computer player takes the place', async (t) => {
  const site = await launch(t);
  const { people, host, code } = await lobby(site, ['ann', 'bob', 'cat', 'dan']);
  const [, bob, cat, dan] = people;
  const bobPhone = await bob.twin();
  await bobPhone.call('resume', { code });
  await toPhase(people, host, 'picking');
  const bobId = bob.state.me.id;
  const bobSlot = host.state.players.find((p) => p.id === bobId).slot;
  assert.equal((await cat.call('kick', { slot: bobSlot })).ok, false, 'only the host removes others');
  assert.equal((await host.call('kick', { slot: bobSlot })).ok, true);
  await until(() => bob.state === null && bobPhone.state === null, 'bob out on both sockets');
  const rest = [host, cat, dan];
  await until(() => rest.every((p) => p.state?.players.filter((x) => x.bot).length === 1), 'a computer player holds the place');
  assert.ok(rest.every((p) => p.state.players.length === 4), 'four places still');
  assert.ok(rest.every((p) => p.state.players.every((x) => x.id !== bobId)), 'he is no longer one of them');
  assert.equal((await bob.call('playCard', { cardId: 10001 })).ok, false);
  assert.equal((await bob.call('join', { code })).ok, false, 'being put out bars him from the invitation');
  // The game carries on for the rest.
  await finish([host, cat, dan], host);
  assert.equal(host.state.phase, 'finished');
});

test('somebody who leaves of their own accord can take their own place back, cards and score and all', async (t) => {
  const site = await launch(t);
  const { people, host, code } = await lobby(site, ['ann', 'bob', 'cat', 'dan'], { rounds: 2 });
  const [, bob] = people;
  await toPhase(people, host, 'picking');
  const bobId = bob.state.me.id;
  const hand = [...bob.state.me.hand];
  assert.equal((await bob.call('leave')).ok, true);
  await until(() => bob.state === null, 'bob out');
  await until(() => host.state.players.filter((p) => p.bot).length === 1, 'a computer player keeping his place warm');
  assert.equal(host.state.players.length, 4);

  assert.equal((await bob.call('join', { code })).ok, true, 'the invitation lets him back in');
  await until(() => bob.state?.phase === 'picking', 'bob back at the table');
  assert.equal(bob.state.me.id, bobId, 'his own place, not a new one');
  assert.deepEqual(bob.state.me.hand, hand, 'with the cards he had');
  assert.equal(host.state.players.length, 4, 'and no place was made for him');
  await finish(people, host);
  assert.equal(host.state.phase, 'finished');
});

test('one game at a time: a second one is refused and sends you back to the one you are in', async (t) => {
  const site = await launch(t);
  const [ann, bob, cat, dan] = await Promise.all(['ann', 'bob', 'cat', 'dan'].map((n) => site.person(n).open()));
  const a = await ann.call('create');
  for (const p of [bob, cat]) assert.equal((await p.call('join', { code: a.code })).ok, true);
  await until(() => cat.state?.players.length === 3, 'game A');

  // Dan starts a second game of his own; ann cannot be in both.
  const b = await dan.call('create');
  assert.equal(b.ok, true);
  assert.notEqual(b.code, a.code);
  const second = await ann.call('create');
  assert.equal(second.ok, false, 'ann is already in a game');
  assert.equal(second.params.code, a.code, 'and is told which');
  await until(() => ann.state?.code === a.code, 'ann is put back in game A');
  const elsewhere = await ann.call('join', { code: b.code });
  assert.equal(elsewhere.ok, false, 'nor may she join another');
  assert.equal(elsewhere.params.code, a.code);

  // Her other sockets land in the same game, with or without the code.
  const phone = await ann.twin();
  assert.equal((await phone.call('resume')).code, a.code);
  const laptop = await ann.twin();
  assert.equal((await laptop.call('resume', { code: a.code })).code, a.code);
  await until(() => laptop.state?.players.length === 3, 'the laptop sees game A');
  // A setting reaches every socket of every person in the game.
  assert.equal((await ann.call('settings', { handSize: 5 })).ok, true);
  await until(() => bob.state.handSize === 5 && phone.state?.handSize === 5, 'game A to change');
  assert.equal(dan.state.handSize, 8, 'game B is untouched');
  // Once she leaves she is free to start another.
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null, 'ann out');
  const next = await ann.call('create');
  assert.equal(next.ok, true);
  assert.notEqual(next.code, a.code);
});
