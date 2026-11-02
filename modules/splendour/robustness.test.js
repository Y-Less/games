// Garbage in: every socket event Splendour handles gets malformed payloads (with and without an ack, from members,
// non-members and a second socket) in the lobby and during and after a game. The server must stay up, answer with a
// structured failure or a harmless success, keep the game state valid, never leak a face-down card and finish a
// normal game afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, fuzzEvent, handledSocketEvents, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';
import { ID } from './kit.js';
import { fast, playOn, playToEnd, validateView } from './playkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every socket event, with the payload fields it reads. */
const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['target', 'seats'],
  leave: [],
  kick: ['seat'],
  settings: ['target', 'seats'],
  addBot: ['seat'],
  removeBot: ['seat'],
  fillBots: [],
  start: [],
  take: ['colours'],
  takeTwo: ['colour'],
  reserve: ['card', 'level'],
  buy: ['card', 'pay'],
  giveBack: ['tokens'],
  noble: ['noble'],
  pass: [],
  again: [],
};

test('this test knows every socket event the server handles', () => {
  assert.deepEqual(handledSocketEvents(here), Object.keys(EVENTS).sort());
});

test('garbage in every phase: the server stays up, replies sensibly, keeps the game valid, leaks nothing, and a normal game still completes', async (t) => {
  fast();
  const before = prototypeNames();
  const site = await launchModule(t, { id: 'splendour', moduleDir: here });
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
    const created = await ann.call('create', { target: 10, seats: 2 });
    assert.equal(created.ok, true, created.error);
    const code = created.code;
    assert.equal((await bob.call('join', { code })).ok, true);
    assert.equal((await annTwo.call('resume', { code })).ok, true);
    await until(() => ann.state?.seats[1] && annTwo.state?.you === 0, 'the lobby');
    if (phase === 'lobby') return code;
    assert.equal((await ann.call('start', {})).ok, true);
    await until(() => ann.state?.phase === 'playing' && bob.state?.phase === 'playing', 'playing');
    if (phase === 'playing') {
      await playOn([ann, bob], () => ann.state.round >= 2 || ann.state.log.length >= 3);
      return code;
    }
    await playOn([ann, bob], () => ann.state.phase === 'finished' && bob.state.phase === 'finished');
    finishedGames++;
    return code;
  }

  const healthy = (phase, code) =>
    ann.state?.phase === phase && bob.state?.phase === phase && ann.state.code === code && bob.state.code === code && annTwo.state?.phase === phase && ann.state.seats[1]?.name === 'bob' && !eve.state;

  for (const phase of ['lobby', 'playing', 'finished']) {
    let code = await reset(phase);
    for (const [event, fields] of Object.entries(EVENTS)) {
      const cast = phase === 'finished' ? [ann] : [ann, bob, eve, annTwo];
      for (const person of cast) {
        replies += await fuzzEvent(person, event, fields, {
          replyCheck: (reply, what) => assert.deepEqual(JSON.stringify(reply).match(ID) ?? [], [], `${what}: a reply must not name any card`),
        });
        await sleep(8);
        assert.equal(await site.alive(), true, `${phase}/${event}/${person.name}: the server must still answer`);
        validateAll();
        if (!healthy(phase, code)) {
          code = await reset(phase);
          validateAll();
        }
      }
    }
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
  const { code } = await cat.call('create', { target: 10, seats: 3 });
  assert.equal((await dan.call('join', { code })).ok, true);
  assert.equal((await cat.call('fillBots', {})).ok, true);
  assert.equal((await cat.call('start', {})).ok, true);
  await playToEnd([cat, dan]);
  validateView(cat.state, 'cat');
  await sleep(150);
  assert.equal((await cat.stats()).perGame[0].played, 1);
  assert.equal((await dan.stats()).perGame[0].played, 1);
});

test('specific malformed and out-of-turn actions are refused with a clear message and change nothing', async (t) => {
  fast('0-2');
  const site = await launchModule(t, { id: 'splendour', moduleDir: here });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { target: 15, seats: 2 });
  await bob.call('join', { code });
  await until(() => ann.state?.seats[1], 'bob');
  const refused = async (p, event, payload, code) => {
    const reply = await p.call(event, payload);
    assert.equal(reply.ok, false, `${event} ${JSON.stringify(payload)?.slice(0, 50)}`);
    if (typeof code === 'string') assert.equal(reply.error, code, `${event}: the refusal code`);
    else if (code) assert.match(reply.error, code);
    assert.deepEqual(JSON.stringify(reply).match(ID) ?? [], []);
  };
  // Before the game: nothing of the game itself works.
  await refused(ann, 'take', { colours: [0, 1, 2] }, 'notPlaying');
  await refused(ann, 'buy', { card: 'c01' }, 'notPlaying');
  await refused(bob, 'start', {}, 'hostOnly');
  await refused(eve, 'take', { colours: [0, 1, 2] }, 'notInAnyGame');
  assert.equal((await ann.call('start', {})).ok, true);
  await until(() => ann.state.phase === 'playing' && bob.state.phase === 'playing', 'the game');
  const mover = ann.state.turn === ann.state.you ? ann : bob;
  const waiter = mover === ann ? bob : ann;
  const logBefore = mover.state.log.length;
  const supply = [...mover.state.supply];
  await refused(waiter, 'take', { colours: [0, 1, 2] }, 'notYourTurn');
  await refused(waiter, 'takeTwo', { colour: 0 }, 'notYourTurn');
  await refused(waiter, 'reserve', { level: 1 }, 'notYourTurn');
  await refused(waiter, 'pass', {}, 'notYourTurn');
  await refused(mover, 'take', { colours: [0, 0, 1] }, 'gemsMustDiffer');
  await refused(mover, 'take', { colours: [0, 1] }, 'takeThreeDifferent');
  await refused(mover, 'take', { colours: [0, 1, 2, 3] }, 'takeUpToThree');
  await refused(mover, 'take', { colours: [0, 1, 7] }, 'notAGemColour');
  await refused(mover, 'take', { colours: 'abc' }, /./);
  await refused(mover, 'take', { colours: { 0: 0, 1: 1, 2: 2, length: 3 } }, /./);
  await refused(mover, 'takeTwo', { colour: 5 }, 'notAGemColour');
  await refused(mover, 'takeTwo', { colour: '0' }, 'notAGemColour');
  await refused(mover, 'buy', { card: mover.state.board[3][0] }, 'cannotAfford');
  for (const card of ['c00', 'c91', 'C01', 'c1', '', ' c01', 5, null, ['c01'], { card: 'c01' }, 'x'.repeat(100000), 'constructor', '__proto__']) await refused(mover, 'buy', { card }, /./);
  for (const card of ['c91', 5, null, '__proto__']) await refused(mover, 'reserve', { card }, /./);
  await refused(mover, 'reserve', { level: 4 }, 'chooseCardOrLevel');
  await refused(mover, 'reserve', { card: mover.state.seats[waiter.state.you].reserved[0]?.card ?? 'c91', level: 1 }, /./);
  await refused(mover, 'giveBack', { tokens: [1, 0, 0, 0, 0, 0] }, 'nothingToReturn');
  await refused(mover, 'noble', { noble: 'n1' }, 'noNobleToChoose');
  await refused(mover, 'pass', {}, 'passOnlyIfStuck');
  await refused(mover, 'start', {}, /settingsBeforeStart|hostOnly/);
  await refused(mover, 'settings', { target: 10 }, /settingsBeforeStart|hostOnly/);
  await refused(mover, 'fillBots', {}, /settingsBeforeStart|hostOnly/);
  await refused(mover, 'removeBot', { seat: 1 }, /settingsBeforeStart|hostOnly|noBotInSeat/);
  await refused(mover, 'addBot', { seat: 1 }, /settingsBeforeStart|hostOnly/);
  await refused(bob, 'kick', { seat: 0 }, /hostOnly|settingsBeforeStart/);
  await refused(bob, 'again', {}, /hostOnly|notOver/);
  await refused(ann, 'again', {}, 'notOver');
  await refused(mover, 'join', { code: 'boss-aware-you' }, 'alreadyInGameJoin');
  await refused(mover, 'create', {}, 'alreadyInGameStart');
  await sleep(20);
  assert.equal(ann.state.log.length, logBefore, 'nothing changed');
  assert.deepEqual(ann.state.supply, supply);
  assert.equal((await mover.call('take', { colours: [0, 1, 2] })).ok, true, 'the proper move still works');
});

test('a huge or odd room code is handled without trouble', async (t) => {
  fast();
  const site = await launchModule(t, { id: 'splendour', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const started = Date.now();
  for (const code of ['A'.repeat(100000), 'a-'.repeat(50000), '?'.repeat(100000), `${'x'.repeat(50000)}-${'y'.repeat(50000)}-z`, ' ', '\u0000', '../../etc/passwd', 'boss-aware-you?boss-aware-you']) {
    const reply = await bob.call('join', { code });
    assert.equal(reply.ok, false);
    assert.ok(reply.error.length < 200);
  }
  assert.ok(Date.now() - started < 5000, 'long codes are cheap to refuse');
  const { code } = await ann.call('create', {});
  assert.equal((await bob.call('join', { code: `  ${code.toUpperCase()}  ` })).ok, true, 'a typed code is tidied');
  assert.equal((await bob.call('join', { code: `https://example.test/play/splendour?${code}` })).ok, true, 'a pasted link works');
});
