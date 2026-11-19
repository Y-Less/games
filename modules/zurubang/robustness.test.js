// Garbage in: every socket event Zurubang handles gets malformed payloads (with and without an ack, from members,
// from somebody who is not in the game, and from a second socket of the same account) in the lobby and in every phase
// of a game.  The server must stay up, answer with a structured failure or a harmless success, keep the game state
// valid, never name a card to somebody not entitled to it, and finish an ordinary game afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, fuzzEvent, handledSocketEvents, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';
import { SEATS, TARGETS } from './game.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.ZURUBANG_BOT_DELAY = '0-2';
process.env.ZURUBANG_REVEAL_WAIT = '5';
process.env.ZURUBANG_NEXT_WAIT = '200';

/** A Zurubang card id anywhere in a payload. */
const CARD = /\b(?:white|green|red|black|blue)-\d{2}\b/g;
const cardsIn = (value) => JSON.stringify(value).match(CARD) ?? [];

const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['target'],
  leave: [],
  kick: ['slot'],
  voteKick: ['slot'],
  voteAnswer: ['agree'],
  voteDrop: [],
  settings: ['target'],
  addBot: [],
  fillBots: [],
  removeBot: ['slot'],
  start: [],
  swapOne: ['card', 'stack'],
  swapAll: ['stacks'],
  challenge: [],
  answer: ['accept'],
  starter: ['seat'],
  place: ['card'],
  reveal: [],
  sudden: ['position'],
  ready: [],
  again: [],
  tournamentReady: ['ready'],
};

const PHASES = ['lobby', 'turn', 'challenged', 'starter', 'placing', 'revealing', 'sudden', 'duelOver', 'finished'];

test('this test knows every socket event the server handles', () => {
  assert.deepEqual(handledSocketEvents(here), Object.keys(EVENTS).sort());
});

/**
 * Where in a view a card id is to be found, so that a leak says which field told on itself rather than only that
 * something did.
 *
 * @param {unknown} node  @param {string} card  @param {string} [path]
 * @returns {string} the dotted path of the first place it appears, or '?' if it is nowhere
 */
function whereIn(node, card, path = '') {
  if (typeof node === 'string') return node.includes(card) ? path : '';
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const found = whereIn(value, card, `${path}.${key}`);
      if (found) return found;
    }
  }
  return path === '' ? '?' : '';
}

/** Everything that must be true of a view, whatever has just been thrown at the server. */
function validateView(view, who) {
  if (view === null || view === undefined) return;
  const label = `${who} (${view.phase})`;
  assert.ok(PHASES.includes(view.phase), `${label}: a known phase`);
  assert.ok(TARGETS.includes(view.target), `${label}: a target the game offers`);
  assert.ok(view.seats.length <= SEATS, `${label}: no more seats than the game has`);
  assert.ok(view.you === -1 || (view.you < view.seats.length && !view.seats[view.you].bot), `${label}: seated where it says`);
  assert.ok(view.hand.length <= 5 && view.theirHand.length <= 5, `${label}: a hand of five at most`);
  for (const card of view.theirHand) assert.deepEqual(Object.keys(card), ['back'], `${label}: the other hand is backs alone`);
  assert.ok(view.stacks.every((count) => Number.isInteger(count) && count >= 0), `${label}: the stacks are counts`);
  assert.ok(Number.isInteger(view.graveyard) && view.graveyard >= 0, `${label}: the graveyard is a count`);
  for (const [seat, chair] of view.seats.entries()) {
    if (!chair) continue;
    assert.ok(chair.score >= 0, `${label}: a sensible score`);
    const history = view.scoreboard.rounds.reduce((sum, round) => sum + (round.deltas[seat] ?? 0), 0);
    assert.equal(history, chair.score, `${label}: seat ${seat}'s score and its scoreboard disagree`);
  }
  // Nothing a view says may name a card this reader has not been shown: their own, and whatever has fought.
  const allowed = new Set([
    ...view.hand,
    ...(view.duel?.placed?.[view.you]?.map((card) => card?.id) ?? []),
    ...(view.duel?.fights ?? []).flatMap((fight) => [...fight.cards, ...fight.drawn]),
    ...JSON.stringify(view.log ?? []).match(CARD) ?? [],
  ]);
  for (const card of cardsIn({ ...view, log: null })) assert.ok(allowed.has(card), `${label}: was sent ${card} at ${whereIn(view, card)}, which is not theirs to see`);
}

/**
 * The duels each person has already changed a card in.  A player who swapped a card every turn would never duel, and
 * two of them would play for ever without a point between them: swapping once a duel and challenging after that
 * exercises both without ever standing still.  (Counting off the move log looks like it would do, and does not: the
 * log is capped at forty lines, so it stops growing and whatever the count decides it decides for ever.)
 */
const swapped = new Set();

/** One move for whoever this person is, in whatever the game is waiting for.  False when it is not their move. */
async function stepOnce(p) {
  const s = p.state;
  if (!s || s.you === -1) return false;
  switch (s.phase) {
    case 'turn': {
      if (s.turn !== s.you) return false;
      const once = `${s.code}:${p.name}:${s.duelNo}`;
      if (swapped.has(once)) return (await p.call('challenge', {})).ok;
      swapped.add(once);
      return (await p.call('swapOne', { card: s.hand[0], stack: 0 })).ok;
    }
    case 'challenged':
      return s.duel.challenger === s.you ? false : (await p.call('answer', { accept: true })).ok;
    case 'starter':
      return s.duel.challenger === s.you ? false : (await p.call('starter', { seat: s.you })).ok;
    case 'placing':
      return s.placer?.seat === s.you ? (await p.call('place', { card: s.hand[0] })).ok : false;
    case 'revealing':
      // Either player may hurry the next pair along, and the server turns it over by itself in any case, so a reveal
      // that arrives a moment too late is not a step that failed.
      await p.call('reveal', {});
      return true;
    case 'sudden': {
      if (s.duel.sudden.picked !== null) return false;
      const out = new Set(s.duel.sudden.out);
      return (await p.call('sudden', { position: [0, 1, 2, 3, 4].find((position) => !out.has(position)) })).ok;
    }
    case 'duelOver':
      return s.seats[s.you].ready ? false : (await p.call('ready', {})).ok;
    default:
      return false;
  }
}

/** Plays until `done`, asking each person in turn and checking `done` again before each of them. */
async function playOn(people, done, limit = 60000) {
  const started = Date.now();
  while (!done()) {
    const where = () => people.map((p) => `${p.name}: ${p.state ? `${p.state.phase} in ${p.state.code}, turn ${p.state.turn}, you ${p.state.you}, ${p.state.seats.map((s) => s?.score).join('-')}` : 'nowhere'}`).join('; ');
    assert.ok(Date.now() - started < limit, `the game got stuck (${where()})`);
    let moved = false;
    for (const p of people) {
      if (done()) break;
      moved = (await stepOnce(p)) || moved;
    }
    if (!moved) await sleep(3);
  }
}

test('garbage in every phase: the server stays up, replies sensibly, keeps the game valid, and leaks nothing', async (t) => {
  const before = prototypeNames();
  const site = await launchModule(t, { id: 'zurubang', moduleDir: here });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const annTwo = await ann.twin();
  const all = [ann, bob, eve, annTwo];
  let replies = 0;
  let checkedStates = 0;

  const validateAll = () => {
    for (const p of all) {
      for (const s of p.states) validateView(s, p.name);
      checkedStates += p.states.length;
      p.states.length = 0;
    }
  };

  const bothIn = (phase) => ann.state?.phase === phase && bob.state?.phase === phase;

  async function reset(phase) {
    for (const p of [ann, annTwo, bob, eve]) {
      await p.call('resume', {});
      await p.call('leave', {});
    }
    await sleep(15);
    const created = await ann.call('create', { target: 20 });
    assert.equal(created.ok, true, created.error);
    const code = created.code;
    assert.equal((await bob.call('join', { code })).ok, true);
    assert.equal((await annTwo.call('resume', { code })).ok, true);
    await until(() => ann.state?.seats.filter(Boolean).length === 2 && annTwo.state?.you === 0, 'the lobby');
    if (phase === 'lobby') return code;
    assert.equal((await ann.call('start', {})).ok, true);
    await until(() => bothIn('turn'), 'the first turn');
    if (phase === 'turn') return code;
    // Not every phase happens in every game — a sudden death needs a duel to come out level — so the room plays
    // another game, and another, until the one wanted comes round.
    for (let attempt = 0; attempt < 20; attempt++) {
      await playOn([ann, bob], () => bothIn(phase) || bothIn('finished'));
      if (bothIn(phase)) return code;
      assert.equal((await ann.call('again', {})).ok, true);
      await until(() => bothIn('lobby'), 'the lobby again');
      assert.equal((await ann.call('start', {})).ok, true);
      await until(() => bothIn('turn'), 'the next game');
    }
    assert.fail(`twenty games went by without ever reaching ${phase}`);
    return code;
  }

  const healthy = (phase, code) => [ann, bob].every((p) => p.state?.phase === phase && p.state.code === code) && annTwo.state?.phase === phase && !eve.state;

  for (const phase of PHASES) {
    let code = await reset(phase);
    const cast = phase === 'finished' ? [ann, eve] : all;
    for (const [event, fields] of Object.entries(EVENTS)) {
      for (const person of cast) {
        replies += await fuzzEvent(person, event, fields, {
          replyCheck: (reply, what) => assert.deepEqual(cardsIn(reply), [], `${what}: a reply must not name any card`),
        });
        await sleep(5);
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
  assert.ok(replies > 3000, `a thorough battery was sent (${replies} acks checked)`);
  assert.ok(checkedStates > 100, `${checkedStates} states were validated`);
});

test('an ordinary game between two people still finishes, and is recorded once for each of them', async (t) => {
  const site = await launchModule(t, { id: 'zurubang', moduleDir: here });
  const [cat, dan] = await Promise.all(['cat', 'dan'].map((n) => site.person(n).open()));
  const { code } = await cat.call('create', { target: 20 });
  assert.equal((await dan.call('join', { code })).ok, true);
  assert.equal((await cat.call('start', {})).ok, true);
  await playOn([cat, dan], () => cat.state?.phase === 'finished' && dan.state?.phase === 'finished');
  validateView(cat.state, 'cat');
  validateView(dan.state, 'dan');
  await sleep(200);
  assert.equal((await cat.stats()).perGame[0].played, 1);
  assert.equal((await dan.stats()).perGame[0].played, 1);
});

test('specific out-of-turn and malformed actions are refused with a code, and change nothing', async (t) => {
  const site = await launchModule(t, { id: 'zurubang', moduleDir: here });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { target: 30 });
  assert.equal((await bob.call('join', { code })).ok, true);

  const refused = async (p, event, payload, expected) => {
    const reply = await p.call(event, payload);
    assert.equal(reply.ok, false, `${event} ${JSON.stringify(payload)?.slice(0, 50)} should have been refused`);
    if (typeof expected === 'string') assert.equal(reply.error, expected, `${event} ${JSON.stringify(payload)?.slice(0, 50)}`);
    else assert.match(reply.error, expected);
    assert.deepEqual(cardsIn(reply), []);
  };

  for (const target of [0, 25, null, [30], 30.5]) await refused(ann, 'settings', { target }, 'badTarget');
  // A number written out is read rather than refused, as every other game on the site reads one.
  assert.equal((await ann.call('settings', { target: '50' })).ok, true);
  assert.equal((await ann.call('settings', { target: 30 })).ok, true, 'and back to the target this test wants');
  await refused(bob, 'settings', { target: 50 }, 'hostOnly');
  await refused(ann, 'addBot', {}, 'everySeatTaken');
  await refused(ann, 'removeBot', { slot: 's1' }, 'noBotInSeat');
  await refused(eve, 'start', {}, /notInAnyGame|hostOnly/);
  await refused(ann, 'swapOne', { card: 'white-01' }, 'notYourTurn');
  await refused(ann, 'challenge', {}, 'notYourTurn');
  await refused(ann, 'answer', { accept: true }, 'notTimeToAnswer');
  await refused(ann, 'place', { card: 'white-01' }, 'notTimeToPlace');
  await refused(ann, 'sudden', { position: 0 }, 'notTimeToPick');
  await refused(ann, 'again', {}, 'notOver');

  assert.equal((await ann.call('start', {})).ok, true);
  await until(() => ann.state?.phase === 'turn' && bob.state?.phase === 'turn', 'the first turn');
  const waiting = ann.state.turn === ann.state.you ? bob : ann;
  await refused(waiting, 'swapOne', { card: waiting.state.hand[0] }, 'notYourTurn');
  const playing = waiting === ann ? bob : ann;
  await refused(playing, 'swapOne', { card: 'not-a-card' }, 'notInHand');
  await refused(eve, 'reveal', {}, /notInAnyGame|notTimeToReveal/);
});
