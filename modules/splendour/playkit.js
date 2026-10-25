// Helpers for the socket-level tests: a "person" that plays from nothing but the view the server sends it.
import assert from 'node:assert/strict';
import { ID } from './kit.js';
import { sleep } from '../../shared/testkit.js';

export const fast = (delay = '0-2') => {
  process.env.SPLENDOUR_BOT_DELAY = delay;
};

const sum = (list) => list.reduce((a, b) => a + b, 0);

/** Does whatever this person has to do right now (a simple, always legal strategy). Returns true if it acted. */
export async function step(p) {
  const s = p.state;
  if (!s || s.phase !== 'playing' || s.turn !== s.you) return false;
  const me = s.seats[s.you];
  if (s.pending) {
    if (s.pending.type === 'return') {
      const give = [0, 0, 0, 0, 0, 0];
      const have = [...me.tokens];
      for (let k = 0; k < s.pending.count; k++) {
        const c = have.findIndex((n) => n > 0);
        have[c]--;
        give[c]++;
      }
      const reply = await p.call('giveBack', { tokens: give });
      assert.equal(reply.ok, true, reply.error);
    } else {
      const reply = await p.call('noble', { noble: s.pending.options[0] });
      assert.equal(reply.ok, true, reply.error);
    }
    return true;
  }
  const buyable = Object.keys(s.afford ?? {});
  let reply;
  if (buyable.length) reply = await p.call('buy', { card: buyable[0] });
  else {
    const open = [0, 1, 2, 3, 4].filter((c) => s.supply[c] > 0);
    if (open.length >= 3) reply = await p.call('take', { colours: open.slice(0, 3) });
    else if (open.length) reply = await p.call('take', { colours: open });
    else if (s.canPass) reply = await p.call('pass');
    else reply = await p.call('reserve', { level: [1, 2, 3].find((l) => s.decks[l] > 0) });
  }
  assert.equal(reply.ok, true, reply.error);
  return true;
}

/** Plays every person's turns until the condition holds. */
export async function playOn(people, done, { timeout = 60000 } = {}) {
  const started = Date.now();
  while (!done()) {
    assert.ok(Date.now() - started < timeout, `the game got stuck: ${JSON.stringify(people.map((p) => [p.name, p.state?.phase, p.state?.turn, p.state?.round]))}`);
    let moved = false;
    for (const p of people) moved = (await step(p)) || moved;
    if (!moved) await sleep(3);
  }
}

export const playToEnd = (people, options) => playOn(people, () => people.every((p) => p.state?.phase === 'finished'), options);

/** Every card named in a view is one that viewer may see. */
export function assertNoLeaks(view, who = '') {
  if (!view || view.phase === 'lobby') return;
  const allowed = new Set();
  for (const l of [1, 2, 3]) for (const id of view.board[l]) if (id) allowed.add(id);
  for (const seat of view.seats) for (const r of seat?.reserved ?? []) if (r.card) allowed.add(r.card);
  for (const entry of view.log) if (entry.card) allowed.add(entry.card);
  for (const id of JSON.stringify(view).match(ID) ?? []) assert.ok(allowed.has(id), `${who}: was sent ${id}, which is not theirs to see`);
  for (const seat of view.seats) {
    for (const r of seat?.reserved ?? []) if (r.blind && seat.seat !== view.you) assert.equal(r.card, null, `${who}: another player's blind reserve is hidden`);
  }
  for (const l of [1, 2, 3]) assert.equal(typeof view.decks[l], 'number', `${who}: the piles are counts`);
}

/** A view must make sense, whatever has been thrown at the server. */
export function validateView(s, who) {
  if (s === null || s === undefined) return;
  const label = `${who} (${s.phase})`;
  assert.ok(['lobby', 'playing', 'finished'].includes(s.phase), `${label}: a known phase`);
  assert.ok([2, 3, 4].includes(s.seats.length) && s.seats.length === s.settings.seats, `${label}: seats match the setting`);
  assert.ok([10, 15, 20].includes(s.settings.target), `${label}: valid target`);
  assert.ok(s.you === -1 || (s.you >= 0 && s.you < s.seats.length && s.seats[s.you]), `${label}: seated where it says`);
  assert.ok(s.hostSeat === -1 || s.seats[s.hostSeat]?.bot === false, `${label}: the host is a person`);
  assert.equal(s.scoreboard.players.length, s.seats.filter(Boolean).length, label);
  if (s.phase === 'lobby') return;
  if (s.seats.some((seat) => !seat)) return assertNoLeaks(s, who); // a seat was freed after the game ended
  const n = s.seats.length;
  const each = { 2: 4, 3: 5, 4: 7 }[n];
  for (let c = 0; c < 6; c++) {
    assert.equal(s.supply[c] + sum(s.seats.map((seat) => seat?.tokens[c] ?? 0)), c === 5 ? 5 : each, `${label}: token colour ${c} conserved`);
  }
  assert.equal(s.nobles.length + sum(s.seats.map((seat) => seat?.nobles.length ?? 0)), n + 1, `${label}: nobles conserved`);
  for (const seat of s.seats) {
    if (!seat) continue;
    assert.ok(seat.prestige >= s.scoreboard.rounds.reduce((total, r) => total + (r.deltas[seat.seat] ?? 0), 0), `${label}: prestige covers the history`);
    assert.ok(seat.reserved.length <= 3, `${label}: at most three reserved`);
  }
  if (s.phase === 'finished') {
    for (const seat of s.seats) if (seat) assert.equal(seat.prestige, s.scoreboard.rounds.reduce((total, r) => total + r.deltas[seat.seat], 0), `${label}: history sums to prestige`);
  }
  assertNoLeaks(s, who);
}
