// State-validity checks shared by the Tints and Hints robustness, lifecycle and invariant tests (not a test itself).
import assert from 'node:assert/strict';
import { isCell } from './grid.js';
import { COLOURS, HINT_LENGTH, MAX_PLAYERS, TURNS_EACH } from './game.js';

export const PHASES = ['lobby', 'guessing1', 'guessing2', 'reveal', 'finished', 'abandoned'];

/** Which phase may follow which, as one player sees it (a new turn goes from reveal, or from a skipped turn, to guessing1). */
export const NEXT_PHASES = {
  lobby: ['lobby', 'guessing1'],
  guessing1: ['guessing1', 'guessing2', 'finished', 'abandoned'],
  guessing2: ['guessing2', 'reveal', 'guessing1', 'finished', 'abandoned'],
  reveal: ['reveal', 'guessing1', 'finished', 'abandoned'],
  finished: ['finished'],
  abandoned: ['abandoned'],
};

/** The invariants of a whole room (server side, game.js level). */
export function checkRoom(room, what = 'room') {
  const ids = room.players.map((p) => p.id);
  assert.ok(PHASES.includes(room.phase), `${what}: unknown phase ${room.phase}`);
  assert.equal(new Set(ids).size, ids.length, `${what}: duplicate players`);
  assert.ok(ids.length <= MAX_PLAYERS, `${what}: too many players`);
  const colours = room.players.map((p) => p.colour);
  assert.equal(new Set(colours).size, colours.length, `${what}: colours are shared`);
  assert.ok(colours.every((c) => COLOURS.includes(c)), `${what}: a colour is not on the palette`);
  assert.ok(room.turnsEach >= TURNS_EACH.min && room.turnsEach <= TURNS_EACH.max && Number.isInteger(room.turnsEach));
  for (const p of room.players) {
    const total = room.history.reduce((sum, round) => sum + (round.deltas[p.id] ?? 0), 0);
    assert.equal(p.score, total, `${what}: score of ${p.id} (${p.score}) differs from its history (${total})`);
    assert.ok(p.score >= 0 && Number.isInteger(p.score));
    assert.ok(p.exactGuesses >= 0 && p.closeGuesses >= 0 && p.hintsGiven >= 0);
  }
  if (room.phase === 'lobby') {
    assert.equal(room.history.length, 0, `${what}: history in a lobby`);
    assert.ok(room.players.length >= 1);
    assert.equal(room.hinter, null);
    assert.ok(ids.includes(room.hostId));
    return;
  }
  assert.ok(room.turn <= room.turnsTotal, `${what}: turn ${room.turn} beyond ${room.turnsTotal}`);
  assert.ok(room.turnsTotal >= 1);
  if (room.players.length) {
    assert.ok(ids.includes(room.hostId), `${what}: the host is not a player`);
    assert.ok(room.nextIdx >= 0 && room.nextIdx < room.players.length, `${what}: nextIdx out of range`);
  }
  assert.ok(isCell(room.tint), `${what}: the tint ${room.tint} is not a cell`);
  assert.ok(room.hints.first.length <= HINT_LENGTH && room.hints.second.length <= HINT_LENGTH, `${what}: hint too long`);
  if (room.phase === 'guessing1' || room.phase === 'guessing2') {
    assert.ok(ids.includes(room.hinter), `${what}: the hinter is not a player`);
    assert.ok(room.players.length >= 2);
  }
  for (const [name, list] of [['first', room.first], ['second', room.second]]) {
    const who = list.map((g) => g.id);
    assert.equal(new Set(who).size, who.length, `${what}: someone guessed twice in ${name}`);
    for (const g of list) {
      assert.ok(isCell(g.cell), `${what}: bad guess ${g.cell}`);
      assert.ok(ids.includes(g.id), `${what}: a guess from someone who is not a player`);
      if (room.phase.startsWith('guessing')) assert.notEqual(g.id, room.hinter, `${what}: the hinter guessed`);
    }
  }
  if (room.phase === 'guessing1') assert.equal(room.second.length, 0, `${what}: second-round guesses in the first round`);
}

/** What any one player's view must satisfy (client side, e2e level). `viewer` is that player's account id. */
export function checkView(view, what = 'view') {
  if (view === null) return;
  assert.ok(PHASES.includes(view.phase), `${what}: unknown phase ${view.phase}`);
  const ids = view.players.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `${what}: duplicate players`);
  assert.ok(ids.length <= MAX_PLAYERS);
  const hinterView = view.hinter === view.you;
  const revealed = ['reveal', 'finished'].includes(view.phase);
  if (view.tint !== null) {
    assert.ok(isCell(view.tint), `${what}: tint ${view.tint}`);
    assert.ok(hinterView || revealed, `${what}: the tint was shown to a guesser before the reveal`);
  }
  if (view.phase === 'guessing1' || view.phase === 'guessing2') {
    if (ids.includes(view.you)) {
      if (hinterView) assert.ok(view.tint !== null, `${what}: the hinter must see the tint`);
      else assert.equal(view.tint, null);
    }
    assert.ok(ids.includes(view.hinter), `${what}: the hinter is not a player`);
    if (!hinterView) {
      assert.equal(view.result, null);
      const round = view.phase === 'guessing1' ? 1 : 2;
      assert.ok(view.guesses.filter((g) => g.round === round).every((g) => g.id === view.you), `${what}: another guesser's current guess was shown`);
    }
    if (view.phase === 'guessing1') assert.equal(view.hints.second, '', `${what}: the second hint is shown early`);
  }
  if (view.phase === 'lobby') assert.equal(view.tint, null);
  assert.ok(view.turn <= Math.max(view.turnsTotal, 1), `${what}: turn beyond total`);
  for (const key of ['first', 'second']) assert.ok(view.hints[key].length <= HINT_LENGTH);
  const seen = new Set();
  for (const g of view.guesses) {
    const key = `${g.round}:${g.id}`;
    assert.ok(!seen.has(key), `${what}: ${key} guessed twice`);
    seen.add(key);
    assert.ok(isCell(g.cell));
  }
  const totals = {};
  for (const round of view.scoreboard.rounds) for (const [id, points] of Object.entries(round.deltas)) totals[id] = (totals[id] ?? 0) + points;
  for (const p of view.players) assert.equal(p.score, totals[p.id] ?? 0, `${what}: score of ${p.id} differs from the scoreboard history`);
  const colours = view.players.map((p) => p.colour);
  assert.equal(new Set(colours).size, colours.length);
}

/** Checks a person's whole run of states: each one valid, and the phase only ever moving forward. */
export function checkRun(states, what = 'run') {
  let previous = null;
  states.forEach((view, i) => {
    checkView(view, `${what} #${i}`);
    if (view === null) {
      previous = null;
      return;
    }
    if (previous && previous.code === view.code) assert.ok(NEXT_PHASES[previous.phase].includes(view.phase), `${what} #${i}: ${previous.phase} -> ${view.phase}`);
    previous = view;
  });
}
