// Helpers for the Gaudi tests that run against the real site (not part of the game).
import assert from 'node:assert/strict';
import { legalCells, patternOf } from './rules.js';
import { sleep } from '../../shared/testkit.js';

export const fast = (range = '0-3') => {
  process.env.GAUDI_BOT_DELAY = range;
};

/** Does whatever this person has to do right now, the simplest legal way. Returns true if it acted. */
export async function step(person) {
  const s = person.state;
  if (!s) return false;
  if (s.phase === 'windows') {
    if (s.chosen || !s.options?.length) return false;
    const best = s.options.reduce((a, b) => (b.difficulty > a.difficulty ? b : a));
    const reply = await person.call('window', { pid: best.pid });
    assert.equal(reply.ok, true, reply.error);
    return true;
  }
  if (s.phase !== 'playing' || !s.turn || s.turn.seat !== s.you) return false;
  const me = s.seats[s.you];
  const pattern = patternOf(me.window.pid);
  if (s.turn.placements < s.turn.allowed) {
    for (const die of s.pool) {
      const cell = legalCells(me.window.grid, pattern, die)[0];
      if (cell !== undefined) {
        const reply = await person.call('place', { die: die.id, cell });
        assert.equal(reply.ok, true, reply.error);
        return true;
      }
    }
  }
  const reply = await person.call('end');
  assert.equal(reply.ok, true, reply.error);
  return true;
}

/** Plays every person's turns until all of them see the finished game. */
export async function playToEnd(people, { timeout = 90000 } = {}) {
  const started = Date.now();
  while (!people.every((p) => p.state?.phase === 'finished')) {
    if (Date.now() - started > timeout) assert.fail(`the game did not finish: ${JSON.stringify(people.map((p) => [p.name, p.state?.phase, p.state?.round, p.state?.turn]))}`);
    let acted = false;
    for (const p of people) acted = (await step(p)) || acted;
    if (!acted) await sleep(4);
  }
}

/** The scoring shown in a finished view, recomputed from the public windows: it must agree. */
export function checkFinal(state) {
  assert.equal(state.phase, 'finished');
  const final = state.final.players;
  assert.equal(final.length, state.seats.length);
  for (const row of final) {
    const dice = state.seats[row.seat].window.grid.filter(Boolean);
    const expected = dice.reduce((sum, d) => sum + (d.c === row.privateColour ? (state.settings.badPrivate ? 3 : d.v) : 0), 0);
    assert.equal(row.privatePoints, expected, `${row.name}: private objective`);
    assert.equal(row.empty, 20 - dice.length);
    assert.equal(row.total, row.publicTotal + row.privatePoints + row.tokens - row.empty);
  }
  assert.equal(new Set(final.map((r) => r.privateColour)).size, final.length);
  const top = Math.max(...final.map((r) => r.total));
  assert.ok(state.winners.every((seat) => final[seat].total === top));
  const rounds = state.scoreboard.rounds;
  assert.equal(rounds.length, 11);
  assert.equal(rounds.at(-1).label, 'Private objectives');
  for (const p of state.scoreboard.players) {
    assert.equal(p.score, final[p.id].total);
    assert.equal(rounds.reduce((sum, r) => sum + r.deltas[p.id], 0), p.score);
  }
}

export const extrasOf = (stats, name = 'Gaudi') => {
  const game = stats.perGame.find((g) => g.name === name);
  return Object.fromEntries(game.extras.map((e) => [e.key, e.value]));
};
