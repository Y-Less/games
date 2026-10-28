// Garbage in: every socket event Hearts handles gets malformed payloads (with and without an ack, from members,
// non-members and a second socket) in the lobby and in every phase of a game. The server must stay up, answer with a
// structured failure or a harmless success, keep the game state valid, never leak cards and finish a normal game.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, cardsIn, fuzzEvent, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';
import { TARGETS, MOON_MODES } from './game.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fast = () => {
  process.env.HEARTS_BOT_DELAY = '0-2';
  process.env.HEARTS_TRICK_PAUSE = '0';
};

/** Every socket event, with the payload fields it reads. */
const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['target', 'jackOfDiamonds', 'moon'],
  leave: [],
  kick: ['seat'],
  settings: ['target', 'jackOfDiamonds', 'moon'],
  addBot: ['seat'],
  removeBot: ['seat'],
  fillBots: [],
  start: [],
  pass: ['cards'],
  play: ['card'],
  claim: [],
  next: [],
  again: [],
};

test('this test knows every socket event the server handles', () => {
  const source = fs.readFileSync(path.join(here, 'server.js'), 'utf8');
  const handled = [...source.matchAll(/\bon\('(\w+)'/g)].map((m) => m[1]).filter((e) => !['connection', 'disconnect'].includes(e)).sort();
  assert.deepEqual(handled, Object.keys(EVENTS).sort());
});

/** Everything a client is shown must make sense, whatever has been thrown at the server. */
function validateView(s, who) {
  if (s === null || s === undefined) return;
  const label = `${who} (${s.phase})`;
  assert.ok(['lobby', 'passing', 'playing', 'handEnd', 'finished'].includes(s.phase), `${label}: a known phase`);
  assert.equal(s.seats.length, 4, label);
  assert.ok(TARGETS.includes(s.settings.target) && typeof s.settings.jackOfDiamonds === 'boolean' && MOON_MODES.includes(s.settings.moon), `${label}: valid settings ${JSON.stringify(s.settings)}`);
  assert.ok(s.you === -1 || (s.you >= 0 && s.you < 4 && s.seats[s.you]), `${label}: seated where it says`);
  assert.ok(s.hostSeat === -1 || s.seats[s.hostSeat]?.bot === false, `${label}: the host is a person`);
  assert.equal(s.scoreboard.players.length, s.seats.filter(Boolean).length, label);
  for (const [i, seat] of s.seats.entries()) {
    if (!seat) continue;
    assert.equal(seat.score, s.scoreboard.rounds.reduce((sum, r) => sum + (r.deltas[i] ?? 0), 0), `${label}: seat ${i} score equals its history`);
  }
  if (s.phase === 'lobby') return;
  assert.ok(s.phase === 'finished' || s.seats.every(Boolean), `${label}: a game in progress has four seats`);
  const held = s.seats.reduce((sum, seat) => sum + (seat ? seat.cards + seat.tricks * 4 : 0), 0) + s.trick.length;
  if (s.phase === 'playing') {
    assert.equal(held, 52, `${label}: 52 cards accounted for`);
    assert.ok(s.turn === null || (s.turn >= 0 && s.turn < 4), `${label}: a valid turn`);
  }
  if (s.phase === 'passing') assert.ok(s.seats.every((seat) => seat.cards === 13), `${label}: 13 each`);
  const allowed = new Set([...s.hand, ...s.received, ...(s.pass?.chosen ?? []), ...s.trick.map((p) => p.card), ...(s.lastTrick?.plays ?? []).map((p) => p.card), ...(s.deal?.removed ?? []), s.deal?.openingCard]); // the deal is public
  for (const card of cardsIn(s)) assert.ok(allowed.has(card), `${label}: was sent ${card}, which is not theirs to see`);
}

async function stepOnce(p) {
  const s = p.state;
  if (!s) return false;
  if (s.phase === 'passing' && !s.pass.chosen) return (await p.call('pass', { cards: s.hand.slice(0, 3) })).ok;
  if (s.phase === 'playing' && s.legal) return (await p.call('play', { card: Object.keys(s.legal).find((c) => s.legal[c] === null) })).ok;
  if (s.phase === 'handEnd') return (await p.call('next', {})).ok;
  return false;
}

async function playOn(people, until_) {
  const started = Date.now();
  while (!until_()) {
    assert.ok(Date.now() - started < 40000, 'the game got stuck');
    let moved = false;
    for (const p of people) moved = (await stepOnce(p)) || moved;
    if (!moved) await sleep(3);
  }
}

test('garbage in every phase: the server stays up, replies sensibly, keeps the game valid, leaks nothing, and a normal game still completes', async (t) => {
  fast();
  const before = prototypeNames();
  const site = await launchModule(t, { id: 'hearts', moduleDir: here });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const annTwo = await ann.twin();
  const everyone = [ann, bob, eve, annTwo];
  let finishedGames = 0;
  let checkedStates = 0;
  let replies = 0;

  const validateAll = () => {
    for (const p of everyone) {
      for (const s of p.states) validateView(s, p.name);
      checkedStates += p.states.length;
      p.states.length = 0;
    }
  };

  async function reset(phase) {
    // A socket that was never attached to its account's game cannot leave it, so attach first.
    for (const p of [ann, annTwo, bob, eve]) {
      await p.call('resume', {});
      await p.call('leave', {});
    }
    await sleep(15);
    const created = await ann.call('create', { target: 50 });
    assert.equal(created.ok, true, created.error);
    const code = created.code;
    assert.equal((await bob.call('join', { code })).ok, true);
    assert.equal((await annTwo.call('resume', { code })).ok, true);
    await until(() => ann.state?.seats[1] && annTwo.state?.you === 0, 'the lobby');
    if (phase === 'lobby') return code;
    assert.equal((await ann.call('fillBots', {})).ok, true);
    assert.equal((await ann.call('start', {})).ok, true);
    await until(() => ann.state?.phase === 'passing' && bob.state?.phase === 'passing', 'passing');
    if (phase === 'passing') return code;
    await playOn([ann, bob], () => ann.state.phase === 'playing' && [ann, bob].some((p) => p.state.legal));
    if (phase === 'playing') return code;
    if (phase === 'handEnd') {
      await playOn([ann, bob], () => ann.state.phase === 'handEnd' && bob.state.phase === 'handEnd');
      return code;
    }
    await playOn([ann, bob], () => ann.state.phase === 'finished' && bob.state.phase === 'finished');
    finishedGames++;
    return code;
  }

  const healthy = (phase, code) =>
    ann.state?.phase === phase && bob.state?.phase === phase && ann.state.code === code && bob.state.code === code && annTwo.state?.phase === phase && ann.state.seats[1]?.name === 'bob' && !eve.state;

  const secretCards = () => [];
  for (const phase of ['lobby', 'passing', 'playing', 'handEnd', 'finished']) {
    const t0 = Date.now();
    let code = await reset(phase);
    for (const [event, fields] of Object.entries(EVENTS)) {
      const cast = phase === 'finished' ? [ann] : phase === 'handEnd' ? [ann, bob, eve] : [ann, bob, eve, annTwo];
      for (const person of cast) {
        replies += await fuzzEvent(person, event, fields, {
          secrets: secretCards,
          replyCheck: (reply, what) => assert.deepEqual(cardsIn(reply), [], `${what}: a reply must not name any card`),
        });
        await sleep(8);
        assert.equal(await site.alive(), true, `${phase}/${event}/${person.name}: the server must still answer`);
        validateAll();
        if (!healthy(phase, code)) {
          if (phase === 'finished' && ann.state?.phase === 'finished') finishedGames += 0;
          code = await reset(phase);
          validateAll();
        }
      }
    }
    if (process.env.KIT_TIMING) console.log(phase, Date.now() - t0, 'ms');
  }
  assertNoPollution(before);
  assert.ok(replies > 5000, `a thorough battery was sent (${replies} acks checked)`);
  assert.ok(checkedStates > 100, `${checkedStates} states were validated`);

  // Nothing ended up recorded twice or recorded for an unfinished game.
  await sleep(150);
  for (const p of [ann, bob]) {
    const stats = await p.stats();
    assert.equal(stats.perGame[0]?.played ?? 0, finishedGames, `${p.name}: one record per finished game`);
  }
  assert.equal((await eve.stats()).perGame.length, 0);

  // A completely normal game, with new accounts, still works afterwards.
  const [cat, dan] = await Promise.all(['cat', 'dan'].map((n) => site.person(n).open()));
  const { code } = await cat.call('create', { target: 50 });
  assert.equal((await dan.call('join', { code })).ok, true);
  assert.equal((await cat.call('fillBots', {})).ok, true);
  assert.equal((await cat.call('start', {})).ok, true);
  await playOn([cat, dan], () => cat.state?.phase === 'finished' && dan.state?.phase === 'finished');
  validateView(cat.state, 'cat');
  await sleep(150);
  assert.equal((await cat.stats()).perGame[0].played, 1);
  assert.equal((await dan.stats()).perGame[0].played, 1);
});

test('specific malformed and out-of-turn actions are refused with a clear message and change nothing', async (t) => {
  fast();
  const site = await launchModule(t, { id: 'hearts', moduleDir: here });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { target: 50 });
  await bob.call('join', { code });
  await ann.call('fillBots', {});
  await ann.call('start', {});
  await until(() => ann.state?.phase === 'passing' && bob.state?.phase === 'passing', 'passing');
  const annHand = [...ann.state.hand];
  const bobHand = [...bob.state.hand];
  const refused = async (p, event, payload, pattern) => {
    const reply = await p.call(event, payload);
    assert.equal(reply.ok, false, `${event} ${JSON.stringify(payload)?.slice(0, 50)}`);
    if (pattern) assert.match(reply.error, pattern);
    assert.deepEqual(cardsIn(reply), []);
  };
  // Passing: wrong count, duplicates, cards held by someone else, not cards, playing during the pass.
  await refused(ann, 'pass', { cards: annHand.slice(0, 2) }, /exactly 3/);
  await refused(ann, 'pass', { cards: annHand.slice(0, 4) }, /exactly 3/);
  await refused(ann, 'pass', { cards: [annHand[0], annHand[0], annHand[1]] }, /different/);
  await refused(ann, 'pass', { cards: [annHand[0], annHand[1], bobHand.find((c) => !annHand.includes(c))] }, /your hand/);
  await refused(ann, 'pass', { cards: [1, 2, 3] }, /your hand/);
  await refused(ann, 'pass', { cards: [null, undefined, {}] }, /exactly 3|your hand/);
  await refused(ann, 'pass', { cards: { 0: annHand[0], 1: annHand[1], 2: annHand[2], length: 3 } }, /exactly 3/);
  await refused(eve, 'pass', { cards: annHand.slice(0, 3) }, /not in a game/);
  await refused(ann, 'play', { card: annHand[0] }, /not being played/);
  await refused(ann, 'next', {}, /not over/);
  await refused(ann, 'again', {}, /not over/);
  assert.deepEqual(ann.state.hand, annHand, 'the hand is untouched');
  assert.equal(ann.state.pass.chosen, null);
  assert.equal((await ann.call('pass', { cards: annHand.slice(0, 3) })).ok, true);
  await refused(ann, 'pass', { cards: annHand.slice(3, 6) }, /already passed/);
  assert.equal((await bob.call('pass', { cards: bobHand.slice(0, 3) })).ok, true);
  await until(() => ann.state.phase === 'playing' && [ann, bob].some((p) => p.state.legal), 'a person to lead');

  // Playing: out of turn, cards that are not held, not cards, and the other person's cards.
  const mover = ann.state.legal ? ann : bob;
  const trickBefore = mover.state.trick.length;
  const waiter = mover === ann ? bob : ann;
  await refused(waiter, 'play', { card: waiter.state.hand[0] }, /not your turn/);
  await refused(mover, 'play', { card: waiter.state.hand.find((c) => !mover.state.hand.includes(c)) }, /not in your hand|lead the 2/);
  for (const card of ['ZZ', '1S', '', 'as', 'AS ', ' 2C', 12, null, ['2C'], { card: '2C' }, '2C2C', 'x'.repeat(100000)]) await refused(mover, 'play', { card }, /./);
  await refused(eve, 'play', { card: '2C' }, /not in a game/);
  await refused(mover, 'pass', { cards: mover.state.hand.slice(0, 3) }, /not time to pass/);
  await refused(mover, 'start', {}, /before the game starts|Only the host/);
  await refused(mover, 'settings', { target: 150 }, /before the game starts|Only the host/);
  await refused(mover, 'fillBots', {}, /before the game starts|Only the host/);
  await refused(mover, 'removeBot', { seat: 2 }, /before the game starts|Only the host/);
  await refused(mover, 'addBot', { seat: 2 }, /before the game starts|Only the host/);
  await refused(bob, 'kick', { seat: 0 }, /host|before the game starts/);
  await refused(bob, 'again', {}, /host/);
  await refused(mover, 'join', { code: 'boss-aware-you' }, /already in the game/);
  await refused(mover, 'create', {}, /already in the game/);
  await sleep(20);
  assert.equal(ann.state.phase, 'playing');
  assert.equal(ann.state.trick.length, trickBefore, 'no card reached the table');
  assert.equal((await mover.call('play', { card: Object.keys(mover.state.legal).find((c) => mover.state.legal[c] === null) })).ok, true, 'the proper move still works');
});

test('a huge or odd room code or name is handled without trouble', async (t) => {
  fast();
  const site = await launchModule(t, { id: 'hearts', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const started = Date.now();
  for (const code of ['A'.repeat(100000), 'a-'.repeat(50000), '?'.repeat(100000), `${'x'.repeat(50000)}-${'y'.repeat(50000)}-z`, ' ', '\u0000', '../../etc/passwd', 'boss-aware-you?boss-aware-you']) {
    const reply = await bob.call('join', { code });
    assert.equal(reply.ok, false);
    assert.ok(reply.error.length < 200);
  }
  assert.ok(Date.now() - started < 5000, 'long codes are cheap to refuse');
  const { code } = await ann.call('create', {});
  // A pasted link or a differently written code still works.
  assert.equal((await bob.call('join', { code: `https://example.test/play/hearts?${code.toUpperCase()}` })).ok, true);
});
