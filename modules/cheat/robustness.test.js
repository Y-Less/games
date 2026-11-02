// Garbage in: every socket event Cheat handles gets malformed payloads (with and without an ack, from members, a
// non-member and a second socket) in the lobby, during play, during the final check, and after the game.  The server must
// stay up, answer with a structured failure or a harmless success, keep the game valid, never leak a hand, and finish a
// normal game afterwards.  (Hearts' robustness test is the model; the shape is the same for every card game.)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, cardsIn, fuzzEvent, handledSocketEvents, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fast = () => {
  process.env.CHEAT_BOT_DELAY = '0-2';
};

/** Every socket event, with the payload fields it reads. */
const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['seats'],
  leave: [],
  kick: ['seat'],
  settings: ['seats'],
  addBot: ['seat'],
  removeBot: ['seat'],
  fillBots: [],
  start: [],
  play: ['cards'],
  call: [],
  accept: [],
  again: [],
};

test('this test knows every socket event the server handles', () => {
  assert.deepEqual(handledSocketEvents(here), Object.keys(EVENTS).sort());
});

/** Everything a client is shown must make sense, whatever has been thrown at the server. */
function validateView(s, who) {
  if (s === null || s === undefined) return;
  const label = `${who} (${s.phase})`;
  assert.ok(['lobby', 'playing', 'check', 'finished'].includes(s.phase), `${label}: a known phase`);
  assert.ok(s.seatCount >= 3 && s.seatCount <= 7 && s.seats.length === s.seatCount, `${label}: a valid table`);
  assert.ok(s.you === -1 || (s.you >= 0 && s.you < s.seatCount && s.seats[s.you]), `${label}: seated where it says`);
  assert.ok(s.hostSeat === -1 || s.seats[s.hostSeat]?.bot === false, `${label}: the host is a person`);
  assert.equal(s.scoreboard.players.length, s.seats.filter(Boolean).length, label);
  if (s.phase === 'lobby') return;
  assert.ok(s.phase === 'finished' || s.seats.every(Boolean), `${label}: a game in progress has every seat taken`);
  if (['playing', 'check'].includes(s.phase)) {
    const held = s.seats.reduce((sum, seat) => sum + (seat ? seat.cards : 0), 0) + s.pile;
    assert.equal(held, 52 * s.decks, `${label}: every card accounted for`);
  }
  // Only the viewer's own hand, and the cards a call turned up, may ever be named.
  const allowed = new Set([...s.hand, ...(s.lastCall?.cards ?? [])]);
  for (const card of cardsIn(s)) assert.ok(allowed.has(card), `${label}: was sent ${card}, which is not theirs to see`);
}

/** A person's honest-or-not move: the first card of their hand, or an answer to the final check. */
async function stepOnce(p) {
  const s = p.state;
  if (!s) return false;
  if (s.phase === 'playing' && s.canPlay) return (await p.call('play', { cards: [s.hand[0]] })).ok;
  if (s.phase === 'check' && s.mustRespond) return (await p.call('accept', {})).ok;
  return false;
}

async function playOn(people, done) {
  const started = Date.now();
  while (!done()) {
    assert.ok(Date.now() - started < 40000, 'the game got stuck');
    let moved = false;
    for (const p of people) moved = (await stepOnce(p)) || moved;
    if (!moved) await sleep(3);
  }
}

test('garbage in every phase: the server stays up, replies sensibly, keeps the game valid, leaks nothing, and a normal game still completes', async (t) => {
  fast();
  const before = prototypeNames();
  const site = await launchModule(t, { id: 'cheat', moduleDir: here });
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
    for (const p of [ann, annTwo, bob, eve]) {
      await p.call('resume', {});
      await p.call('leave', {});
    }
    await sleep(15);
    const created = await ann.call('create', { seats: 3 });
    assert.equal(created.ok, true, created.error);
    const code = created.code;
    assert.equal((await bob.call('join', { code })).ok, true);
    assert.equal((await annTwo.call('resume', { code })).ok, true);
    await until(() => ann.state?.seats[1] && annTwo.state?.you === 0, 'the lobby');
    if (phase === 'lobby') return code;
    assert.equal((await ann.call('fillBots', {})).ok, true);
    assert.equal((await ann.call('start', {})).ok, true);
    await until(() => ann.state?.phase === 'playing' && bob.state?.phase === 'playing', 'playing');
    if (phase === 'playing') return code;
    await playOn([ann, bob], () => ['check', 'finished'].includes(ann.state.phase) && ann.state.phase === bob.state.phase);
    if (phase === 'check' && ann.state.phase === 'check') return code;
    await playOn([ann, bob], () => ann.state.phase === 'finished' && bob.state.phase === 'finished');
    finishedGames++;
    return code;
  }

  const healthy = (phase, code) => ann.state?.phase === phase && bob.state?.phase === phase && ann.state.code === code && bob.state.code === code && annTwo.state?.phase === phase && ann.state.seats[1]?.name === 'bob' && !eve.state;

  for (const phase of ['lobby', 'playing', 'check', 'finished']) {
    let code = await reset(phase);
    if (phase === 'check' && ann.state.phase !== 'check') continue; // the final check is brief and may be over before we look
    for (const [event, fields] of Object.entries(EVENTS)) {
      const cast = phase === 'finished' ? [ann] : [ann, bob, eve, annTwo];
      for (const person of cast) {
        replies += await fuzzEvent(person, event, fields, {
          secrets: () => [],
          replyCheck: (reply, what) => assert.deepEqual(cardsIn(reply), [], `${what}: a reply must not name any card`),
        });
        await sleep(8);
        assert.equal(await site.alive(), true, `${phase}/${event}/${person.name}: the server must still answer`);
        validateAll();
        if (!healthy(phase, code)) {
          code = await reset(phase);
          validateAll();
          if (phase === 'check' && ann.state.phase !== 'check') break;
        }
      }
    }
  }
  assertNoPollution(before);
  assert.ok(replies > 3000, `a thorough battery was sent (${replies} acks checked)`);
  assert.ok(checkedStates > 100, `${checkedStates} states were validated`);

  // A completely normal game, with new accounts, still works afterwards.
  const [cat, dan] = await Promise.all(['cat', 'dan'].map((n) => site.person(n).open()));
  const { code } = await cat.call('create', { seats: 3 });
  assert.equal((await dan.call('join', { code })).ok, true);
  assert.equal((await cat.call('fillBots', {})).ok, true);
  assert.equal((await cat.call('start', {})).ok, true);
  await playOn([cat, dan], () => cat.state?.phase === 'finished' && dan.state?.phase === 'finished');
  validateView(cat.state, 'cat');
  await sleep(150);
  assert.equal((await cat.stats()).perGame[0].played, 1);
  assert.equal((await dan.stats()).perGame[0].played, 1);
});
