// Helpers shared by the Splendour tests (not part of the game): building rooms and checking invariants.
//
// Depends on: node:assert, ./game.js (the rules), ./cards.js (card data) and ./rules.js (the shared limits).
import assert from 'node:assert/strict';
import * as game from './game.js';
import { CARDS, CARD_BY_ID } from './cards.js';
import { GOLD_SUPPLY, MAX_RESERVED, MAX_TOKENS, NOBLE_POINTS, supplyPerColour } from './rules.js';

export const ID = /\bc\d\d\b/g;

/**
 * A started room with seat 0 held by human 1 ("ann") and computer players elsewhere; seat order is not shuffled (the
 * default rng always returns 0.5, which keeps the order).
 *
 * Side effects: creates a new room (nothing shared); the rng is advanced by the shuffle; asserts that the game started.
 *
 * @param {number} seats  2, 3 or 4
 * @param {() => number} rng
 * @param {{ target?: number }} options
 * @returns {object} the room (asserts that it started)
 */
export function started(seats = 4, rng = () => 0.5, { target = 15 } = {}) {
  const room = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { seats, target } });
  game.fillWithBots(room, 1);
  const outcome = game.start(room, 1, rng);
  assert.equal(outcome.ok, true, outcome.error);
  return room;
}

/**
 * A room where every seat is a computer player.
 *
 * Side effects: as for started(), then replaces every seat with a computer player and clears the host.
 *
 * @param {number} seats
 * @param {() => number} rng
 * @param {object} options  as for started()
 * @returns {object} the room, with no host
 */
export function botsOnly(seats = 4, rng, options) {
  const room = started(seats, rng, options);
  for (let i = 0; i < room.seats.length; i++) room.seats[i] = { kind: 'bot', id: `bot:x${i}`, name: `Bot ${i}` };
  room.hostId = null;
  return room;
}

/**
 * Adds up a list of numbers.
 *
 * Side effects: none.
 *
 * @param {number[]} list
 * @returns {number}
 */
const sum = (list) => list.reduce((a, b) => a + b, 0);

/**
 * Everything that must hold after every action: tokens, cards and nobles conserved, prestige and history consistent,
 * limits respected. Throws an assertion error naming the first thing that does not hold.
 *
 * Side effects: none, except that it throws an assertion error when a check fails.
 *
 * @param {object} room
 * @param {string} label  shown in the message to say where the check was made
 */
export function checkInvariants(room, label = '') {
  const where = `${label} (round ${room.round}, turn ${room.turn})`;
  if (room.phase === 'lobby') return;
  const n = room.seats.length;
  const perColour = supplyPerColour(n);
  // Tokens are conserved, per colour.
  for (let c = 0; c < 6; c++) {
    const total = room.supply[c] + sum(room.players.map((p) => p.tokens[c]));
    assert.equal(total, c === 5 ? GOLD_SUPPLY : perColour, `${where}: token colour ${c} conserved`);
    assert.ok(room.supply[c] >= 0 && room.players.every((p) => p.tokens[c] >= 0), `${where}: no negative tokens`);
  }
  // Cards are conserved: each of the 90 is in exactly one place.
  const places = [
    ...[1, 2, 3].flatMap((l) => [...room.decks[l], ...room.board[l].filter(Boolean)]),
    ...room.players.flatMap((p) => [...p.reserved.map((r) => r.card), ...p.bought]),
  ];
  assert.equal(places.length, 90, `${where}: 90 cards accounted for`);
  assert.equal(new Set(places).size, 90, `${where}: no card twice`);
  assert.deepEqual([...places].sort(), CARDS.map((c) => c.id).sort(), `${where}: exactly the card set`);
  for (const l of [1, 2, 3]) {
    assert.equal(room.board[l].length, 4, `${where}: four slots at level ${l}`);
    if (room.decks[l].length) assert.ok(room.board[l].every(Boolean), `${where}: no gap while the pile has cards`);
    assert.ok(room.board[l].every((id) => id === null || CARD_BY_ID[id].level === l), `${where}: level ${l} board`);
    assert.ok(room.decks[l].every((id) => CARD_BY_ID[id].level === l), `${where}: level ${l} deck`);
  }
  // Nobles: n + 1 in play at the start, none lost or copied.
  const nobles = [...room.nobles, ...room.players.flatMap((p) => p.nobles)];
  assert.equal(nobles.length, n + 1, `${where}: nobles conserved`);
  assert.equal(new Set(nobles).size, n + 1, `${where}: no noble twice`);
  // Prestige is the sum of purchased cards and nobles, and equals the history plus the round in progress.
  room.players.forEach((p, i) => {
    assert.equal(game.prestigeOf(p), sum(p.bought.map((id) => CARD_BY_ID[id].points)) + NOBLE_POINTS * p.nobles.length, `${where}: prestige of seat ${i}`);
    const history = sum(room.history.map((r) => r.deltas[i]));
    assert.equal(history + room.roundDeltas[i], game.prestigeOf(p), `${where}: history of seat ${i}`);
    assert.ok(p.reserved.length <= MAX_RESERVED, `${where}: at most three reserved`);
    assert.equal(p.tally.cardsBought, p.bought.length, `${where}: cards bought tally`);
    assert.equal(p.tally.noblesVisited, p.nobles.length, `${where}: nobles tally`);
    if (!room.pending || room.pending.seat !== i) assert.ok(game.tokenTotal(p) <= MAX_TOKENS, `${where}: at most ten tokens (seat ${i} has ${game.tokenTotal(p)})`);
  });
  if (room.phase === 'playing') {
    assert.ok(room.turn >= 0 && room.turn < n, `${where}: a valid turn`);
    if (room.pending) assert.equal(room.pending.seat, room.turn, `${where}: pending belongs to the player on turn`);
  }
  if (room.phase === 'finished') {
    assert.ok(room.winners.length >= 1, `${where}: winners`);
    assert.equal(room.history.length, room.round, `${where}: every round recorded`);
    assert.ok(room.history.length === 0 || Object.keys(room.history.at(-1).deltas).length === n, `${where}: full last round`);
  } else {
    assert.equal(room.history.length, room.round - 1, `${where}: finished rounds recorded`);
  }
}

/**
 * The cards a viewer is allowed to know about: the table, their own reserve, others' face-up reserves and the log.
 *
 * Side effects: none.
 *
 * @param {object} room
 * @param {number} seat  the viewer's seat
 * @returns {Set<string>} card ids
 */
export function visibleIds(room, seat) {
  const ids = new Set();
  for (const l of [1, 2, 3]) for (const id of room.board[l]) if (id) ids.add(id);
  room.players.forEach((p, i) => p.reserved.forEach((r) => (i === seat || !r.blind) && ids.add(r.card)));
  for (const e of room.log) if (e.card) ids.add(e.card);
  return ids;
}

/**
 * A view must name no card its viewer may not see (no deck order, no one else's blind reserve). Throws if it does.
 *
 * Side effects: none, except that it throws an assertion error when a check fails.
 *
 * @param {object} room
 * @param {number} userId  the viewer's account id
 * @param {number} seat    the viewer's seat
 * @param {string} label   shown in the message
 * @returns {object} the view that was checked
 */
export function assertViewIsClean(room, userId, seat, label = '') {
  const view = game.viewFor(room, userId);
  const allowed = visibleIds(room, seat);
  const text = JSON.stringify(view);
  for (const id of text.match(ID) ?? []) assert.ok(allowed.has(id), `${label}: the view of seat ${seat} named ${id}, which it may not see`);
  assert.equal('decks' in view && Array.isArray(view.decks[1]), false, `${label}: the decks are counts only`);
  return view;
}
