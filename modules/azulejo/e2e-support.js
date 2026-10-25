// Helpers for the Azulejo tests that run against the real site (not part of the game).
import assert from 'node:assert/strict';
import { bonuses, lineProblem } from './rules.js';
import { sleep } from '../../shared/testkit.js';

export const fast = (range = '0-3') => {
  process.env.AZULEJO_BOT_DELAY = range;
};

/** The simplest legal move for the person, from their view: the first group, on the first legal line (or the floor). */
export function simpleMove(state) {
  const me = state.seats[state.you];
  const free = state.settings.freeWall;
  const sources = [...state.factories.keys(), 'centre'];
  for (const source of sources) {
    const tiles = source === 'centre' ? state.centre : state.factories[source];
    for (const colour of new Set(tiles)) {
      for (let line = 0; line < 5; line++) if (lineProblem(me.lines, me.wall, line, colour, free) === null) return { source, colour, line };
    }
  }
  const source = sources.find((s) => (s === 'centre' ? state.centre : state.factories[s]).length);
  const tiles = source === 'centre' ? state.centre : state.factories[source];
  return { source, colour: tiles[0], line: 'floor' };
}

/** Does whatever this person has to do right now, the simplest legal way. Returns true if it acted. */
export async function step(person) {
  const s = person.state;
  if (!s) return false;
  if (s.phase === 'tiling' && s.choice) {
    const reply = await person.call('column', { col: s.choice.columns[s.choice.columns.length - 1] });
    assert.equal(reply.ok, true, reply.error);
    return true;
  }
  if (s.phase !== 'playing' || s.turn !== s.you) return false;
  const reply = await person.call('move', simpleMove(s));
  assert.equal(reply.ok, true, reply.error);
  return true;
}

/** Plays every person's turns until all of them see the finished game. */
export async function playToEnd(people, { timeout = 90000 } = {}) {
  const started = Date.now();
  while (!people.every((p) => p.state?.phase === 'finished')) {
    if (Date.now() - started > timeout) assert.fail(`the game did not finish: ${JSON.stringify(people.map((p) => [p.name, p.state?.phase, p.state?.round, p.state?.turn]))}`);
    let acted = false;
    for (const p of people) acted = (await step(p).catch(() => false)) || acted;
    if (!acted) await sleep(4);
  }
}

/** The scoring shown in a finished view, recomputed from the public walls: it must agree. */
export function checkFinal(state) {
  assert.equal(state.phase, 'finished');
  const final = state.final.players;
  assert.equal(final.length, state.seats.length);
  for (const row of final) {
    const b = bonuses(state.seats[row.seat].wall);
    assert.equal(row.rows, b.rows, `${row.name}: rows`);
    assert.equal(row.columns, b.columns, `${row.name}: columns`);
    assert.equal(row.sets, b.sets, `${row.name}: colour sets`);
    assert.equal(row.bonus, b.points, `${row.name}: bonus`);
    assert.equal(row.total, row.before + row.bonus, `${row.name}: total`);
  }
  assert.ok(final.some((r) => r.rows >= 1) || state.centre.length === 0, 'a complete row ended the game');
  const best = Math.max(...final.map((r) => r.total * 100 + r.rows));
  assert.deepEqual(state.winners, final.filter((r) => r.total * 100 + r.rows === best).map((r) => r.seat));
  const rounds = state.scoreboard.rounds;
  assert.equal(rounds.at(-1).label, 'Bonuses');
  rounds.slice(0, -1).forEach((r, i) => assert.equal(r.label, `Round ${i + 1}`));
  for (const p of state.scoreboard.players) {
    assert.equal(p.score, final[p.id].total, 'the sticky bar shows the final score');
    assert.equal(state.seats[p.id].score, p.score);
    assert.equal(rounds.reduce((sum, r) => sum + r.deltas[p.id], 0), p.score, 'the table totals equal the scores');
  }
}

export const extrasOf = (stats, name = 'Azulejo') => {
  const game = stats.perGame.find((g) => g.name === name);
  return Object.fromEntries(game.extras.map((e) => [e.key, e.value]));
};
