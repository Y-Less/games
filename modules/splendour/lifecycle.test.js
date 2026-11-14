// Splendour over real sockets, for the moments in a room's life that e2e.test.js does not visit.  That file restarts
// the site in the middle of a game and after one, has people leave, and reconnects them; this one is about two things
// happening at once (two people starting, one account moving from two sockets) and about a turn that is only half
// done: a player who has taken an eleventh token owes the table some back, and that debt has to survive the site
// restarting, and the player's connection dropping, without the turn passing, being taken twice, or being quietly
// finished for them.  It also follows a table through the host walking out, and on into a second game.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, until } from '../../shared/testkit.js';
import { fast, playToEnd, validateView } from './playkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const launch = (t, options = {}) => launchModule(t, { id: 'splendour', moduleDir: here, ...options });
const oks = (replies) => replies.filter((r) => r.ok === true).length;
const sum = (list) => list.reduce((a, b) => a + b, 0);
const played = async (person) => (await person.stats()).perGame.find((g) => g.name === 'Splendour')?.played ?? 0;
const TOKEN_LIMIT = 10; // rules.md: "at most 10 tokens (Gold included) at the end of your turn"

/** Ann (the host) and Bob at a table with `seats` places, the rest computer players, started. */
async function started(t, { seats = 2, site = null } = {}) {
  fast();
  site ??= await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const created = await ann.call('create', { seats, target: 10 });
  assert.equal(created.ok, true, created.error);
  assert.equal((await bob.call('join', { code: created.code })).ok, true);
  if (seats > 2) assert.equal((await ann.call('fillBots', { count: seats })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => [ann, bob].every((p) => p.state?.phase === 'playing'), 'the game to begin');
  return { site, ann, bob, code: created.code };
}

/**
 * Plays a table of two until `hoarder` has taken more tokens than anybody may hold and owes some back: they take three
 * gems every turn, and the other player keeps out of the supply's way by reserving cards.
 */
async function untilTokensAreOwed(hoarder, other) {
  await until(
    async () => {
      if ([hoarder, other].every((p) => p.state.pending?.type === 'return')) return true;
      const s = hoarder.state;
      if (s.pending || s.log.length !== other.state.log.length) return false; // somebody has yet to hear of the last move
      if (s.turn === s.you) {
        const richest = [0, 1, 2, 3, 4].filter((c) => s.supply[c] > 0).sort((a, b) => s.supply[b] - s.supply[a]).slice(0, 3);
        await hoarder.call('take', { colours: richest });
      } else if (other.state.turn === other.state.you) {
        const mine = other.state.seats[other.state.you];
        if (mine.reserved.length < 3) await other.call('reserve', { level: 1 });
        else await other.call('take', { colours: [0, 1, 2, 3, 4].filter((c) => other.state.supply[c] > 0).slice(0, 3) });
      }
      return false;
    },
    'somebody to hold more than ten tokens',
    { timeout: 60000 },
  );
  const s = hoarder.state;
  assert.equal(s.pending.seat, s.you);
  assert.equal(s.pending.count, sum(s.seats[s.you].tokens) - TOKEN_LIMIT, 'exactly the tokens over ten are owed');
  assert.equal(s.turn, s.you, 'the turn has not passed');
}

/** Gives back `count` tokens the person holds, as a list of six counts. */
function someTokens(person) {
  const s = person.state;
  const have = [...s.seats[s.you].tokens];
  const give = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < s.pending.count; k++) {
    const colour = have.findIndex((n) => n > 0);
    have[colour]--;
    give[colour]++;
  }
  return give;
}

/** The same account, signed in on a restarted site with the cookie it had, and back in its game. */
async function comeBack(site, person, code) {
  const back = site.person(person.name);
  back.cookie = person.cookie;
  back.id = person.id;
  await back.connect();
  assert.deepEqual(await back.call('resume', { code }), { ok: true, code });
  await until(() => back.state?.code === code, `${person.name} to be sent the game`);
  return back;
}

test('the host pressing start on two sockets at once, and a guest pressing it too, sets the table out exactly once', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { seats: 2, target: 10 });
  assert.equal((await bob.call('join', { code })).ok, true);
  const twin = await ann.twin();
  assert.equal((await twin.call('resume', { code })).ok, true);
  const replies = await Promise.all([ann.call('start'), twin.call('start'), bob.call('start')]);
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  assert.equal(replies[2].ok, false, 'only the host starts');
  await until(() => [ann, twin, bob].every((p) => p.state?.phase === 'playing'), 'everybody to see the game');
  for (const p of [ann, twin, bob]) validateView(p.state, p.name);
  assert.deepEqual(ann.state.supply, [4, 4, 4, 4, 4, 5], 'two players: four tokens of each colour and five Gold, all still in the supply');
  assert.equal(ann.state.nobles.length, 3, 'one more noble than there are players');
  assert.deepEqual([ann.state.round, ann.state.turn], [1, 0], 'the first turn of the first round');
  assert.deepEqual(twin.state.board, ann.state.board, 'both of the host\'s sockets see the same cards');
  assert.deepEqual(bob.state.board, ann.state.board);
});

test('one account taking gems from two sockets at once: the gems are taken once and the turn passes once', async (t) => {
  const { ann, bob } = await started(t);
  const mover = ann.state.turn === ann.state.you ? ann : bob;
  const other = mover === ann ? bob : ann;
  const twin = await mover.twin();
  assert.equal((await twin.call('resume', {})).ok, true);
  await until(() => twin.state?.phase === 'playing', 'the second socket to see the game');
  const replies = await Promise.all([mover.call('take', { colours: [0, 1, 2] }), twin.call('take', { colours: [0, 1, 2] })]);
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  await until(() => [mover, twin, other].every((p) => p.state.turn === other.state.you), 'the turn to pass');
  const seat = mover.state.you;
  for (const p of [mover, twin, other]) {
    assert.deepEqual(p.state.seats[seat].tokens, [1, 1, 1, 0, 0, 0], `${p.name} sees three gems taken, not six`);
    assert.deepEqual(p.state.supply, [3, 3, 3, 4, 4, 5]);
    validateView(p.state, p.name);
  }
  assert.equal((await mover.call('take', { colours: [2, 3, 4] })).ok, false, 'and it is not their turn any more');
});

test('a restart while a player owes tokens back: the debt, the turn, and everybody\'s tokens are as they were', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splendour-pending-'));
  fast();
  const first = await launch(t, { dataDir, keep: true });
  const { ann, bob, code } = await started(t, { site: first });
  await untilTokensAreOwed(ann, bob);
  const before = ann.state;
  await first.stop();

  const second = await launch(t, { dataDir });
  const [annBack, bobBack] = [await comeBack(second, ann, code), await comeBack(second, bob, code)];
  for (const p of [annBack, bobBack]) {
    validateView(p.state, p.name);
    assert.deepEqual(p.state.pending, before.pending, 'the tokens are still owed');
    assert.equal(p.state.turn, before.turn, 'and it is still that player\'s turn');
    assert.deepEqual(p.state.seats.map((s) => s.tokens), before.seats.map((s) => s.tokens), 'everybody holds what they held');
    assert.deepEqual(p.state.supply, before.supply);
    assert.deepEqual(p.state.board, before.board, 'the cards on the table are the same cards');
  }
  assert.deepEqual(annBack.state.seats[annBack.state.you].reserved, before.seats[before.you].reserved);
  // Nothing else can happen until the tokens are back: not another action by the debtor, and not the other player's turn.
  assert.equal((await annBack.call('take', { colours: [0, 1, 2] })).ok, false, 'the debtor cannot take more');
  assert.equal((await bobBack.call('reserve', { level: 2 })).ok, false, 'and it is not the other player\'s turn');
  assert.equal((await bobBack.call('giveBack', { tokens: [1, 0, 0, 0, 0, 0] })).ok, false, 'nor can they pay the debt for them');
  const give = someTokens(annBack);
  assert.equal((await annBack.call('giveBack', { tokens: give })).ok, true);
  await until(() => [annBack, bobBack].every((p) => p.state.pending === null && p.state.turn === bobBack.state.you), 'the turn to pass');
  assert.equal(sum(annBack.state.seats[annBack.state.you].tokens), TOKEN_LIMIT, 'ten tokens at the end of the turn');
  assert.deepEqual(annBack.state.supply, before.supply.map((held, colour) => held + give[colour]), 'the tokens went back to the supply');
  validateView(bobBack.state, 'bob');
});

test('a connection lost while a player owes tokens back: nobody takes the turn for them, and it is theirs when they return', async (t) => {
  const { ann, bob, code } = await started(t);
  await untilTokensAreOwed(ann, bob);
  const seat = ann.state.you;
  const before = ann.state;
  ann.socket.close();
  await until(() => bob.state.seats[seat].online === false, 'Ann to show as away');
  assert.equal(bob.state.seats[seat].bot, false, 'a lost connection is not leaving: no computer player takes the seat');
  assert.deepEqual(bob.state.pending, before.pending, 'the tokens are still owed');
  assert.equal((await bob.call('take', { colours: [0, 1, 2] })).ok, false, 'the game waits for her');
  await ann.connect();
  assert.deepEqual(await ann.call('resume', { code }), { ok: true, code });
  await until(() => ann.state?.pending?.type === 'return' && bob.state.seats[seat].online === true, 'Ann to be back');
  assert.deepEqual(ann.state.seats[seat].tokens, before.seats[seat].tokens);
  assert.equal((await ann.call('giveBack', { tokens: someTokens(ann) })).ok, true);
  await until(() => [ann, bob].every((p) => p.state.pending === null && p.state.turn === bob.state.you), 'the turn to pass');
  assert.equal(sum(bob.state.seats[seat].tokens), TOKEN_LIMIT);
});

test('the host walking out mid-game, and a second game at the same table: each game is recorded once, for the people who finished it', async (t) => {
  const { ann, bob } = await started(t, { seats: 3 });
  const name = (state, seat) => state.seats[seat].name;
  const annSeat = ann.state.you;
  assert.equal(name(bob.state, bob.state.hostSeat), 'ann');
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null, 'Ann to be out');
  await until(() => bob.state.seats[annSeat].bot === true, 'a computer player in her seat');
  assert.equal(bob.state.hostSeat, bob.state.you, 'the person left at the table is the host');
  await playToEnd([bob]);
  await until(async () => (await played(bob)) === 1, 'the first game to be recorded for Bob');
  assert.equal(await played(ann), 0, 'somebody who left is not in the result');

  // The same table again: back to the lobby with the same seats, and a second game that is a result of its own.
  assert.equal((await bob.call('again')).ok, true);
  await until(() => bob.state.phase === 'lobby', 'the lobby');
  assert.equal(bob.state.seats.filter(Boolean).length, 3, 'everybody is still seated');
  assert.equal(bob.state.settings.target, 10, 'and the settings are kept');
  assert.equal(await played(bob), 1, 'going back to the lobby records nothing');
  // What a fresh game looks like is asked of the first view of it, not of the latest: the two computer players are
  // at this table too, and by the time the latest view is looked at one of them may well have taken its turn (and
  // some tokens), which is the game being played and not anything carried over from the last one.
  const sentBefore = bob.states.length;
  assert.equal((await bob.call('start')).ok, true);
  const dealt = () => bob.states.slice(sentBefore).find((s) => s?.phase === 'playing');
  await until(() => Boolean(dealt()), 'the second game');
  const fresh = dealt();
  validateView(fresh, 'bob');
  assert.equal(fresh.round, 1, 'a fresh game');
  assert.ok(fresh.seats.every((s) => s.prestige === 0 && sum(s.tokens) === 0), 'nobody carries anything over');
  await playToEnd([bob]);
  await until(async () => (await played(bob)) === 2, 'the second game to be recorded as well');
});
