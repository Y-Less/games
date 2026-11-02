// Garbage in: every socket event Cribbage handles gets malformed payloads (with and without an ack, from members,
// non-members and a second socket) in the lobby and in every phase of a game.  The server must stay up, answer with a
// structured failure or a harmless success, keep the game state valid, never leak hidden cards, and finish a normal game.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, cardsIn, fuzzEvent, handledSocketEvents, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.CRIBBAGE_BOT_DELAY = '0-2';

const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['target', 'seats'],
  leave: [],
  kick: ['seat'],
  settings: ['target', 'seats'],
  addBot: [],
  fillBots: [],
  removeBot: ['seat'],
  start: [],
  discard: ['cards'],
  play: ['card'],
  ready: [],
  again: [],
};

test('this test knows every socket event the server handles', () => {
  assert.deepEqual(handledSocketEvents(here), Object.keys(EVENTS).sort());
});

function validateView(s, who) {
  if (s === null || s === undefined) return;
  const label = `${who} (${s.phase})`;
  assert.ok(['lobby', 'discard', 'play', 'show', 'finished'].includes(s.phase), `${label}: a known phase`);
  assert.ok([61, 121].includes(s.target), `${label}: a valid target`);
  assert.ok(s.seatCount >= 2 && s.seatCount <= 4 && s.seats.length <= s.seatCount, `${label}: seats within limits`);
  assert.ok(s.you === -1 || (s.you < s.seats.length && !s.seats[s.you].bot), `${label}: seated where it says`);
  for (const [i, seat] of s.seats.entries()) {
    if (!seat) continue; // an empty seat in the lobby
    assert.ok(seat.score >= 0 && seat.score <= s.target, `${label}: a sensible score`);
    const history = s.scoreboard.rounds.reduce((sum, r) => sum + (r.deltas[i] ?? 0), 0);
    assert.ok(history <= seat.score, `${label}: the history never exceeds the score`);
    if (s.phase === 'lobby' || s.phase === 'finished' || s.phase === 'show') assert.equal(history, seat.score, `${label}: seat ${i} score equals its history`);
  }
  if (s.phase === 'discard' || s.phase === 'play') {
    assert.equal(s.seats.length, s.seatCount, `${label}: a game in progress is full`);
    const allowed = new Set([...s.hand, s.starter, ...(s.play?.sequence ?? []).map((p) => p.card), ...(s.play?.previous ?? []), ...(s.play?.playable ?? [])].filter(Boolean));
    for (const card of cardsIn({ ...s, show: null })) assert.ok(allowed.has(card), `${label}: was sent ${card}, which is not theirs to see`);
    assert.ok(s.play === null || s.play.count >= 0 && s.play.count <= 31, `${label}: a count within 31`);
  }
}

async function stepOnce(p) {
  const s = p.state;
  if (!s) return false;
  if (s.phase === 'discard' && s.need) return (await p.call('discard', { cards: s.hand.slice(0, s.need) })).ok;
  if (s.phase === 'play' && s.play.turn === s.you && s.play.playable.length) return (await p.call('play', { card: s.play.playable[0] })).ok;
  if (s.phase === 'show' && !s.seats[s.you].ready) return (await p.call('ready', {})).ok;
  return false;
}

async function playOn(people, done, limit = 40000) {
  const started = Date.now();
  while (!done()) {
    assert.ok(Date.now() - started < limit, 'the game got stuck');
    let moved = false;
    for (const p of people) moved = (await stepOnce(p)) || moved;
    if (!moved) await sleep(3);
  }
}

test('garbage in every phase: the server stays up, replies sensibly, keeps the game valid, leaks nothing, and a normal game still completes', async (t) => {
  const before = prototypeNames();
  const site = await launchModule(t, { id: 'cribbage', moduleDir: here });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const annTwo = await ann.twin();
  let finishedGames = 0;
  let checkedStates = 0;
  let replies = 0;
  const all = [ann, bob, eve, annTwo];

  const validateAll = () => {
    for (const p of all) {
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
    const created = await ann.call('create', { target: 61, seats: 3 });
    assert.equal(created.ok, true, created.error);
    const code = created.code;
    assert.equal((await bob.call('join', { code })).ok, true);
    assert.equal((await annTwo.call('resume', { code })).ok, true);
    await until(() => ann.state?.seats.filter(Boolean).length === 2 && annTwo.state?.you === 0, 'the lobby');
    if (phase === 'lobby') return code;
    assert.equal((await ann.call('addBot', {})).ok, true);
    assert.equal((await ann.call('start', {})).ok, true);
    await until(() => ann.state?.phase === 'discard' && bob.state?.phase === 'discard', 'discard');
    if (phase === 'discard') return code;
    await playOn([ann, bob], () => ann.state.phase === 'play' && [ann, bob].some((p) => p.state.play.turn === p.state.you));
    if (phase === 'play') return code;
    if (phase === 'show') {
      await playOn([ann, bob], () => ann.state.phase === 'show' && bob.state.phase === 'show' && !ann.state.seats[0].ready);
      return code;
    }
    await playOn([ann, bob], () => ann.state.phase === 'finished' && bob.state.phase === 'finished');
    finishedGames++;
    return code;
  }

  const healthy = (phase, code) =>
    ann.state?.phase === phase && bob.state?.phase === phase && ann.state.code === code && bob.state.code === code && annTwo.state?.phase === phase && ann.state.seats[1]?.name === 'bob' && !eve.state;

  for (const phase of ['lobby', 'discard', 'play', 'show', 'finished']) {
    let code = await reset(phase);
    const cast = phase === 'finished' ? [ann] : phase === 'show' ? [ann, bob, eve] : [ann, bob, eve, annTwo];
    for (const [event, fields] of Object.entries(EVENTS)) {
      for (const person of cast) {
        replies += await fuzzEvent(person, event, fields, {
          replyCheck: (reply, what) => assert.deepEqual(cardsIn(reply), [], `${what}: a reply must not name any card`),
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
  assert.ok(replies > 4000, `a thorough battery was sent (${replies} acks checked)`);
  assert.ok(checkedStates > 100, `${checkedStates} states were validated`);

  await sleep(150);
  for (const p of [ann, bob]) {
    const stats = await p.stats();
    assert.equal(stats.perGame[0]?.played ?? 0, finishedGames, `${p.name}: one record per finished game`);
  }
  assert.equal((await eve.stats()).perGame.length, 0);

  const [cat, dan] = await Promise.all(['cat', 'dan'].map((n) => site.person(n).open()));
  const { code } = await cat.call('create', { target: 61, seats: 3 });
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
  const site = await launchModule(t, { id: 'cribbage', moduleDir: here });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { target: 61, seats: 2 });
  await bob.call('join', { code });
  // `code` is the refusal code the server must answer with (a string), or a pattern when more than one is allowed.
  const refused = async (p, event, payload, code) => {
    const reply = await p.call(event, payload);
    assert.equal(reply.ok, false, `${event} ${JSON.stringify(payload)?.slice(0, 50)}`);
    if (typeof code === 'string') assert.equal(reply.error, code, `${event} ${JSON.stringify(payload)?.slice(0, 50)}`);
    else if (code) assert.match(reply.error, code);
    assert.deepEqual(cardsIn(reply), []);
  };
  // Lobby: settings and seats.
  for (const target of [0, 60, 122, '61', null, [61], 61.5]) await refused(ann, 'settings', { target }, 'targetScore');
  for (const seats of [1, 6, 2.5, '3', -2, null, [3]]) await refused(ann, 'settings', { seats }, 'playersRange');
  await refused(bob, 'settings', { target: 121 }, 'hostOnly');
  await refused(ann, 'addBot', {}, 'everySeatTaken');
  await refused(ann, 'removeBot', { seat: 0 }, 'noBotInSeat');
  await refused(eve, 'start', {}, /notInAnyGame|hostOnly/);
  await refused(ann, 'discard', { cards: ['AS', 'KS'] }, 'notTimeToDiscard');
  await refused(ann, 'play', { card: 'AS' }, 'notTimeToPlay');
  await refused(ann, 'ready', {}, 'nothingToBeReadyFor');
  await refused(ann, 'again', {}, 'notOver');
  assert.equal((await ann.call('settings', { seats: 2, target: 61 })).ok, true);
  assert.equal((await ann.call('start', {})).ok, true);
  await until(() => ann.state.phase === 'discard' && bob.state.phase === 'discard', 'discard');
  const annHand = [...ann.state.hand];
  const bobHand = [...bob.state.hand];
  await refused(ann, 'discard', { cards: annHand.slice(0, 1) }, 'chooseForBox');
  await refused(ann, 'discard', { cards: annHand.slice(0, 3) }, 'chooseForBox');
  await refused(ann, 'discard', { cards: [annHand[0], annHand[0]] }, 'cardsNotInHand');
  await refused(ann, 'discard', { cards: [annHand[0], bobHand.find((c) => !annHand.includes(c))] }, 'cardsNotInHand');
  await refused(ann, 'discard', { cards: [1, 2] }, 'cardsNotInHand');
  await refused(ann, 'discard', { cards: ['ZZ', 'AS'] }, 'cardsNotInHand');
  await refused(ann, 'discard', { cards: [null, null] }, 'cardsNotInHand');
  await refused(ann, 'discard', { cards: 'AS,KS' }, 'chooseForBox');
  await refused(eve, 'discard', { cards: annHand.slice(0, 2) }, 'notInAnyGame');
  await refused(ann, 'play', { card: annHand[0] }, 'notTimeToPlay');
  await refused(ann, 'start', {}, 'settingsBeforeStart');
  await refused(ann, 'settings', { target: 121 }, 'settingsBeforeStart');
  await refused(ann, 'addBot', {}, 'settingsBeforeStart');
  await refused(ann, 'kick', { seat: 0 }, 'nobodyElseInSeat');
  await refused(ann, 'kick', { seat: 'x' }, 'nobodyElseInSeat');
  await refused(bob, 'kick', { seat: 0 }, 'hostOnly');
  await refused(ann, 'join', { code: 'boss-aware-you' }, 'alreadyInGameJoin');
  await refused(ann, 'create', {}, 'alreadyInGameStart');
  assert.deepEqual(ann.state.hand, annHand, 'the hand is untouched');
  assert.equal((await ann.call('discard', { cards: annHand.slice(0, 2) })).ok, true);
  await refused(ann, 'discard', { cards: annHand.slice(2, 4) }, 'alreadyDiscarded');
  assert.equal((await bob.call('discard', { cards: bobHand.slice(0, 2) })).ok, true);
  await playOn([ann, bob], () => ann.state.phase === 'play' && [ann, bob].some((p) => p.state.play.turn === p.state.you));
  const mover = ann.state.play.turn === ann.state.you ? ann : bob;
  const waiter = mover === ann ? bob : ann;
  const lead = mover.state.play.playable[0];
  await refused(waiter, 'play', { card: waiter.state.hand[0] }, 'notYourTurn');
  await refused(mover, 'play', { card: waiter.state.hand.find((c) => !mover.state.hand.includes(c)) }, 'notInHand');
  for (const card of ['ZZ', '1S', '', 'as', 'AS ', 12, null, [lead], { card: lead }, `${lead}${lead}`, 'x'.repeat(100000)]) await refused(mover, 'play', { card }, /./);
  await refused(eve, 'play', { card: lead }, 'notInAnyGame');
  await refused(mover, 'discard', { cards: mover.state.hand.slice(0, 2) }, 'notTimeToDiscard');
  await refused(mover, 'ready', {}, 'nothingToBeReadyFor');
  assert.equal(mover.state.play.sequence.length, 0, 'no card reached the table');
  assert.equal((await mover.call('play', { card: lead })).ok, true, 'the proper move still works');
});

test('a huge or odd room code is refused cheaply, and a pasted link still works', async (t) => {
  const site = await launchModule(t, { id: 'cribbage', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const started = Date.now();
  for (const code of ['A'.repeat(100000), 'a-'.repeat(50000), '?'.repeat(100000), ' ', '\u0000', '../../etc/passwd', 'boss-aware-you?boss-aware-you']) {
    const reply = await bob.call('join', { code });
    assert.equal(reply.ok, false);
    assert.ok(reply.error.length < 200, 'a refusal is a short code, never the code that was sent');
  }
  assert.ok(Date.now() - started < 5000);
  const { code } = await ann.call('create', {});
  assert.equal((await bob.call('join', { code: `https://example.test/play/cribbage?${code.toUpperCase()}` })).ok, true);
});
