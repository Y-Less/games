// Concurrency and lifecycle for Gaudi against the real site: things that happen in the same instant, one account on
// two devices, the site restarting while windows are being chosen and in the middle of a turn, the host walking out,
// and somebody who left coming back for their seat.
//
// e2e.test.js already plays whole games, reconnects, and restarts between turns; what is here is what that leaves
// out, and each test protects a promise rules.md makes that only a running site can break: a game starts once, a
// seat is taken once, a turn places one die however many devices ask, a window chosen is chosen for good and stays
// secret until everyone has chosen, and "until you press End turn you may change your mind with Undo turn" - which
// has to stay true of a turn the site was restarted in the middle of.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, until } from '../../shared/testkit.js';
import { checkFinal, fast, playToEnd, step } from './e2e-support.js';
import { legalCells, patternOf } from './rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const launch = (t, options = {}) => launchModule(t, { id: 'gaudi', moduleDir: here, ...options });
const named = (site, names) => Promise.all(names.map((n) => site.person(n).open()));
const oks = (replies) => replies.filter((r) => r.ok === true).length;
const diceIn = (state, seat) => state.seats[seat].window.grid.filter(Boolean).length;
const played = async (person) => (await person.stats()).perGame.find((g) => g.name === 'Gaudi')?.played ?? 0;

/** A table of these people and nobody else, started, with everybody looking at their four windows. */
async function choosingWindows(site, names) {
  const people = await named(site, names);
  const [host, ...rest] = people;
  const created = await host.call('create', { seats: names.length });
  assert.equal(created.ok, true, created.error);
  for (const p of rest) assert.equal((await p.call('join', { code: created.code })).ok, true, `${p.name} joined`);
  await until(() => people.every((p) => p.state?.seats.every(Boolean)), 'everybody seated');
  assert.equal((await host.call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'windows'), 'the windows to be dealt');
  return { people, code: created.code };
}

/** The same table with every window chosen, waiting for the first turn of round one. */
async function playing(site, names) {
  const table = await choosingWindows(site, names);
  for (const p of table.people) assert.equal(await step(p), true);
  await until(() => table.people.every((p) => p.state?.phase === 'playing' && p.state.turn), 'play to begin');
  return table;
}

/** Every die of the pool that this person could legally place now, each with a space for it. */
function placements(person) {
  const s = person.state;
  const mine = s.seats[s.you].window;
  return s.pool.flatMap((die) => {
    const [cell] = legalCells(mine.grid, patternOf(mine.pid), die);
    return cell === undefined ? [] : [{ die: die.id, cell }];
  });
}

/** The same account on a site that has been started again: its cookie still signs it in. */
async function comeBack(site, person) {
  const again = site.person(person.name);
  again.cookie = person.cookie;
  again.id = person.id;
  await again.connect();
  return again;
}

test('everybody pressing start in the same instant starts exactly one game, with one deal of windows', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob] = await named(site, ['ann', 'bob']);
  const { code } = await ann.call('create', { seats: 2 });
  assert.equal((await bob.call('join', { code })).ok, true);
  const phone = await ann.twin();
  assert.equal((await phone.call('resume')).ok, true);
  await until(() => [ann, bob, phone].every((p) => p.state?.seats.every(Boolean)), 'everybody seated');

  const replies = await Promise.all([ann.call('start'), phone.call('start'), bob.call('start')]);
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  await until(() => [ann, bob, phone].every((p) => p.state?.phase === 'windows'), 'the windows');
  assert.equal(ann.state.options.length, 4, 'four windows to choose from');
  assert.deepEqual(phone.state.options, ann.state.options, 'both of her devices were dealt the same four');
  const dealt = JSON.stringify(ann.state.options);
  assert.equal((await ann.call('start')).ok, false, 'and it cannot be started again');
  assert.equal(JSON.stringify(ann.state.options), dealt, 'the windows were dealt once');
});

test('four people racing for the last seat: exactly one gets it, and everybody agrees who', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, ...racers] = await named(site, ['ann', 'bob', 'cat', 'dan', 'eve']);
  const { code } = await ann.call('create', { seats: 3 });
  assert.equal((await ann.call('addBot')).ok, true);
  await until(() => ann.state.seats.filter(Boolean).length === 2, 'two of the three seats taken');

  const replies = await Promise.all(racers.map((p) => p.call('join', { code })));
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  const winner = racers[replies.findIndex((r) => r.ok)];
  await until(() => ann.state.seats.every(Boolean) && winner.state?.seats.every(Boolean), 'the table to fill');
  const people = ann.state.seats.filter((s) => !s.bot).map((s) => s.name);
  assert.deepEqual(people.sort(), ['ann', winner.name].sort(), 'the host and the one who got in');
  assert.deepEqual(winner.state.seats.map((s) => s.name), ann.state.seats.map((s) => s.name), 'both see the same table');
  for (const p of racers) if (p !== winner) assert.equal(p.state ?? null, null, `${p.name} is not in the game`);
});

test('a window chosen from two devices at once is chosen once, and stays secret until everyone has chosen', async (t) => {
  fast();
  const site = await launch(t);
  const { people } = await choosingWindows(site, ['ann', 'bob']);
  const [ann, bob] = people;
  const phone = await ann.twin();
  assert.equal((await phone.call('resume')).ok, true);
  await until(() => phone.state?.phase === 'windows', 'the phone to see the windows');
  const [first, second] = ann.state.options.map((option) => option.pid);

  const replies = await Promise.all([ann.call('window', { pid: first }), phone.call('window', { pid: second })]);
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  const chosen = replies[0].ok ? first : second;
  await until(() => ann.state.chosen === chosen && phone.state.chosen === chosen, 'both devices to show the choice');
  assert.equal((await ann.call('window', { pid: chosen === first ? second : first })).ok, false, 'there is no choosing again');

  // Bob can see that she has chosen, and nothing about what.
  await until(() => bob.state.seats[ann.state.you].picked === true, 'bob to see that ann has chosen');
  assert.equal(bob.state.seats[ann.state.you].window, null);
  assert.ok(!JSON.stringify(bob.state).includes(`"${chosen}"`), 'her choice has not reached him');
  assert.ok(!bob.state.options.some((o) => o.pid === chosen), 'no window is dealt to two players');
  assert.equal((await bob.call('window', { pid: chosen })).ok, false, 'he chooses from his own four only');

  assert.equal(await step(bob), true);
  await until(() => [ann, bob].every((p) => p.state.phase === 'playing'), 'play to begin');
  assert.equal(bob.state.seats[ann.state.you].window.pid, chosen, 'once everyone has chosen, the windows are public');
});

test('a die placed from two devices at once is placed once: a turn places one die', async (t) => {
  fast();
  const site = await launch(t);
  const { people } = await playing(site, ['ann', 'bob']);
  const mover = people.find((p) => p.state.turn.seat === p.state.you);
  const other = people.find((p) => p !== mover);
  const phone = await mover.twin();
  assert.equal((await phone.call('resume')).ok, true);
  await until(() => phone.state?.phase === 'playing', 'the phone to see the game');
  const pool = mover.state.pool.length;

  // Two different dice, each perfectly legal on its own, asked for in the same instant from the two devices.
  const [one, two] = placements(mover);
  assert.ok(one && two, 'an empty window takes any die on its edge');
  const replies = await Promise.all([mover.call('place', one), phone.call('place', two), other.call('place', one)]);
  assert.equal(oks(replies.slice(0, 2)), 1, JSON.stringify(replies));
  assert.equal(replies[2].ok, false, 'and it was never the other player\'s turn');
  await until(() => [mover, phone, other].every((p) => diceIn(p.state, mover.state.you) === 1), 'the die to reach every view');
  assert.equal(mover.state.pool.length, pool - 1, 'one die left the pool');
  assert.equal(diceIn(mover.state, other.state.you), 0, 'and nothing was placed in the other window');
  assert.deepEqual(phone.state.seats[mover.state.you].window, mover.state.seats[mover.state.you].window, 'both devices agree');

  // Ending the turn from both at once ends it once: the turn passes to the next player, not past them.
  const ends = await Promise.all([mover.call('end'), phone.call('end')]);
  assert.equal(oks(ends), 1, JSON.stringify(ends));
  await until(() => other.state.turn.seat === other.state.you, 'the turn to pass to the other player');
  assert.equal(other.state.turn.placements, 0);
});

test('a restart while windows are being chosen keeps the windows dealt, the choice made, and the secret', async (t) => {
  fast();
  const first = await launch(t, { keep: true });
  const { people, code } = await choosingWindows(first, ['ann', 'bob']);
  const [ann, bob] = people;
  const dealt = { ann: ann.state.options.map((o) => o.pid), bob: bob.state.options.map((o) => o.pid) };
  const chosen = dealt.ann[2];
  assert.equal((await ann.call('window', { pid: chosen })).ok, true);
  await until(() => bob.state.seats[ann.state.you].picked === true, 'the choice to be known to have been made');
  await first.stop();

  const second = await launch(t, { dataDir: first.dataDir });
  const [annBack, bobBack] = [await comeBack(second, ann), await comeBack(second, bob)];
  for (const p of [annBack, bobBack]) assert.deepEqual(await p.call('resume'), { ok: true, code });
  await until(() => [annBack, bobBack].every((p) => p.state?.phase === 'windows'), 'the window phase after the restart');
  assert.deepEqual(annBack.state.options.map((o) => o.pid), dealt.ann, 'ann has the four windows she was dealt');
  assert.deepEqual(bobBack.state.options.map((o) => o.pid), dealt.bob, 'and bob has his');
  assert.equal(annBack.state.chosen, chosen, 'her choice was kept');
  assert.equal(bobBack.state.chosen, null, 'and nobody chose for him');
  assert.equal((await annBack.call('window', { pid: dealt.ann[0] })).ok, false, 'a restart is not a second chance to choose');
  assert.equal(bobBack.state.seats[annBack.state.you].picked, true);
  assert.equal(bobBack.state.seats[annBack.state.you].window, null, 'her choice is still secret');

  assert.equal((await bobBack.call('window', { pid: dealt.bob[1] })).ok, true);
  await until(() => [annBack, bobBack].every((p) => p.state.phase === 'playing'), 'play to begin');
  assert.equal(bobBack.state.seats[annBack.state.you].window.pid, chosen);
  assert.equal(annBack.state.seats[bobBack.state.you].window.pid, dealt.bob[1]);
  // Favour tokens are the difficulty of the window each of them chose.
  assert.equal(annBack.state.seats[annBack.state.you].tokens, patternOf(chosen).difficulty);
});

test('a turn the site was restarted in the middle of can still be taken back with Undo, and the game played out', async (t) => {
  fast();
  const first = await launch(t, { keep: true });
  const { people, code } = await playing(first, ['ann', 'bob']);
  const mover = people.find((p) => p.state.turn.seat === p.state.you);
  const seat = mover.state.you;
  const pool = mover.state.pool.map((die) => die.id).sort();
  const [placement] = placements(mover);
  assert.equal((await mover.call('place', placement)).ok, true);
  await until(() => people.every((p) => diceIn(p.state, seat) === 1), 'the die to be placed');
  assert.equal(mover.state.turn.canUndo, true);
  await first.stop();

  const second = await launch(t, { dataDir: first.dataDir });
  const back = await Promise.all(people.map((p) => comeBack(second, p)));
  for (const p of back) assert.deepEqual(await p.call('resume'), { ok: true, code });
  await until(() => back.every((p) => p.state?.phase === 'playing'), 'the game after the restart');
  const moverBack = back[people.indexOf(mover)];
  const otherBack = back.find((p) => p !== moverBack);
  assert.equal(moverBack.state.turn.seat, seat, 'it is still the same player\'s turn');
  assert.equal(moverBack.state.turn.placements, 1, 'with their one die placed');
  assert.equal(moverBack.state.seats[seat].window.grid[placement.cell].id, placement.die, 'where they placed it');
  assert.equal((await moverBack.call('place', placements(moverBack)[0] ?? placement)).ok, false, 'and no second die to place');

  assert.equal((await otherBack.call('undo')).ok, false, 'only the player whose turn it is can take it back');
  assert.equal(moverBack.state.turn.canUndo, true);
  assert.equal((await moverBack.call('undo')).ok, true);
  await until(() => back.every((p) => diceIn(p.state, seat) === 0), 'the die to go back');
  assert.deepEqual(moverBack.state.pool.map((die) => die.id).sort(), pool, 'the pool is as the turn began');
  assert.equal(moverBack.state.turn.placements, 0);
  assert.equal((await moverBack.call('undo')).ok, false, 'there is nothing more to take back');

  await playToEnd(back);
  for (const p of back) checkFinal(p.state);
  await until(async () => (await played(back[0])) === 1 && (await played(back[1])) === 1, 'the game to be recorded for both of them');
});

test('when the host leaves the lobby the game passes to somebody still in it, who can then run it', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob] = await named(site, ['ann', 'bob']);
  const { code } = await ann.call('create', { seats: 3 });
  assert.equal((await bob.call('join', { code })).ok, true);
  await until(() => bob.state?.seats.filter(Boolean).length === 2, 'both in the lobby');
  assert.equal((await bob.call('addBot')).ok, false, 'bob is not the host yet');

  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null, 'ann to be out');
  await until(() => bob.state.hostSeat === bob.state.you, 'the game to pass to bob');
  assert.equal(bob.state.seats.filter(Boolean).length, 1, 'her seat is free again');
  assert.equal((await bob.call('addBot')).ok, true);
  assert.equal((await bob.call('start')).ok, true);
  await until(() => bob.state.phase === 'windows', 'the game he started');
});

test('somebody who leaves a game under way can come back with the code and takes their own seat back from the computer', async (t) => {
  fast('5-10');
  const site = await launch(t);
  const { people, code } = await playing(site, ['ann', 'bob', 'cat']);
  const [ann, bob, cat] = people;
  const seat = ann.state.you;
  const window = ann.state.seats[seat].window.pid;
  const colour = ann.state.privateObjective.colour;
  assert.equal(ann.state.hostSeat, seat);

  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null, 'ann to be out');
  await until(() => bob.state.seats[seat].bot === true, 'a computer player in her seat');
  assert.notEqual(bob.state.hostSeat, seat, 'a computer player does not host: the game has passed to a person');
  assert.equal(bob.state.seats[bob.state.hostSeat].bot, false);
  assert.equal(bob.state.seats[seat].window.pid, window, 'the window stays with the seat');

  assert.equal((await ann.call('join', { code })).ok, true);
  await until(() => ann.state?.phase === 'playing' && bob.state.seats[seat].bot === false, 'ann back at the table');
  assert.equal(ann.state.you, seat, 'in the seat she left');
  assert.equal(ann.state.seats[seat].name, 'ann');
  assert.equal(ann.state.seats[seat].window.pid, window, 'with her window');
  assert.equal(ann.state.privateObjective.colour, colour, 'and her private objective');
  assert.equal(bob.state.seats.filter((s) => s.bot).length, 0, 'and the computer player has gone');

  await playToEnd([ann, bob, cat]);
  for (const p of [ann, bob, cat]) checkFinal(p.state);
  await until(async () => (await Promise.all([ann, bob, cat].map(played))).every((n) => n === 1), 'the game to be recorded once for each of the three');
});
