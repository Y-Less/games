// The computer players of Rummikub. A computer player only ever sends the server the same kind of request a person
// would (a whole proposed table, or a draw), and the same rules.checkPlay judges it; if the search ever produced
// something that check refuses, the computer simply draws, so a game always goes on.
//
// How it finds a play. Tiles with the same colour and number are interchangeable, so the search works on "kinds"
// (colour, number) with a count of how many copies are on the table (which must all stay on it) and in the rack
// (which may be played). It builds the table set by set: always starting from the lowest kind that is left, it tries
// every run and group that begins there (jokers filling gaps or ends), or leaves a rack tile out. The value of a
// finished table is the points of rack tiles it uses (a joker is worth 30), with memoising of states already seen and
// a cap on the number of states, so a turn is always quick. That covers playing new sets, extending runs and groups,
// taking tiles from one set to complete another and replacing jokers. Before the first meld only the rack is searched,
// and the new sets must reach the meld threshold.
import * as game from './game.js';
import { JOKER_VALUE, checkPlay, isJoker, tileOf, totalTiles } from './rules.js';

export const SEARCH_BUDGET = 6000;

/** The next thing a computer has to do, or null when the game waits for a person. */
export function pendingAction(room) {
  if (room.phase !== 'playing' || room.turn === null || room.turn === undefined) return null;
  return game.isBot(room.seats[room.turn]) ? { type: 'turn', seat: room.turn } : null;
}

/**
 * Searches for the best table. `need` and `opt` are counts per kind (index colour * numbers + number - 1): copies that
 * must be used and copies that may be. `jn` / `jo` the same for jokers. mode 'rack' values the rack tiles used (jokers 30),
 * mode 'rep' values the numbers the tiles stand for (the first-meld rule). Returns { value, sets } where each set is a
 * list of parts ({ k } a tile of that kind, { j } a joker standing for that number), or null when nothing fits.
 */
export function solve(s, { need, opt, jn, jo, mode, budget = SEARCH_BUDGET }) {
  const N = s.numbers;
  const C = s.colours;
  const K = N * C;
  let nodes = 0;
  let aborted = false;
  const memo = new Map();
  const avail = (k) => need[k] + opt[k];

  function takeKind(k) {
    if (need[k] > 0) {
      need[k]--;
      return { k, was: 'need', value: 0 };
    }
    opt[k]--;
    return { k, was: 'opt', value: (k % N) + 1 };
  }
  function takeJoker() {
    if (jn > 0) {
      jn--;
      return { k: -1, was: 'need', value: 0 };
    }
    jo--;
    return { k: -1, was: 'opt', value: JOKER_VALUE };
  }
  function give(taken) {
    for (const t of taken) {
      if (t.k === -1) t.was === 'need' ? jn++ : jo++;
      else (t.was === 'need' ? need : opt)[t.k]++;
    }
  }

  function candidates(p) {
    const list = [];
    const c = Math.floor(p / N);
    const n = (p % N) + 1;
    const jokers = jn + jo;
    // runs that start (at their lowest real tile) here, possibly with jokers in front
    for (let lead = 0; lead <= Math.min(2, n - 1, jokers); lead++) {
      const parts = [];
      for (let i = 0; i < lead; i++) parts.push({ j: n - lead + i });
      parts.push({ k: p });
      let used = lead;
      for (let number = n + 1; ; number++) {
        if (parts.length >= 3) list.push({ parts: [...parts], rep: parts.reduce((sum, part) => sum + (part.j ?? (part.k % N) + 1), 0) });
        if (number > N) break;
        const k = c * N + number - 1;
        if (avail(k) > 0) parts.push({ k });
        else if (used < jokers) {
          parts.push({ j: number });
          used++;
        } else break;
      }
    }
    // groups whose lowest colour is this tile's
    if (C >= 3) {
      const others = [];
      for (let c2 = c + 1; c2 < C; c2++) if (avail(c2 * N + n - 1) > 0) others.push(c2 * N + n - 1);
      for (let mask = 0; mask < 1 << others.length; mask++) {
        const chosen = others.filter((_, i) => mask & (1 << i));
        const r = 1 + chosen.length;
        const base = Math.max(0, 3 - r);
        for (let jc = base; jc <= Math.min(jokers, C - r, base + 1); jc++) {
          if (r + jc < 3) continue;
          const parts = [{ k: p }, ...chosen.map((k) => ({ k })), ...Array.from({ length: jc }, () => ({ j: n }))];
          list.push({ parts, rep: n * (r + jc) });
        }
      }
    }
    return list.sort((a, b) => b.parts.length - a.parts.length || a.parts.filter((x) => x.j).length - b.parts.filter((x) => x.j).length);
  }

  function search(start) {
    let p = start;
    while (p < K && need[p] + opt[p] === 0) p++;
    if (p === K) return jn === 0 ? { value: 0, chain: null } : null;
    if (++nodes > budget) {
      aborted = true;
      return null;
    }
    const key = `${p},${jn},${jo},${need.subarray(p).join('')}|${opt.subarray(p).join('')}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let best = null;
    for (const cand of candidates(p)) {
      const taken = cand.parts.map((part) => (part.j === undefined ? takeKind(part.k) : takeJoker()));
      const here = mode === 'rep' ? cand.rep : taken.reduce((sum, t) => sum + t.value, 0);
      const sub = search(p);
      give(taken);
      if (sub && (!best || here + sub.value > best.value)) best = { value: here + sub.value, chain: { set: cand.parts, next: sub.chain } };
    }
    if (need[p] === 0) {
      opt[p]--;
      const sub = search(p);
      opt[p]++;
      if (sub && (!best || sub.value > best.value)) best = sub;
    }
    if (!aborted) memo.set(key, best);
    return best;
  }

  const found = search(0);
  if (!found) return null;
  const sets = [];
  for (let node = found.chain; node; node = node.next) sets.push(node.set);
  return { value: found.value, sets, aborted };
}

/** Counts per kind, and the ids behind them (table ids first, so the rack ones are the ones played). */
function inventory(s, tableIds, rackIds) {
  const K = s.numbers * s.colours;
  const need = new Int8Array(K);
  const opt = new Int8Array(K);
  const ids = Array.from({ length: K }, () => ({ table: [], rack: [] }));
  const jokers = { table: [], rack: [] };
  const add = (list, where) => {
    for (const id of list) {
      if (isJoker(s, id)) jokers[where].push(id);
      else {
        const t = tileOf(s, id);
        const k = t.colour * s.numbers + t.number - 1;
        ids[k][where].push(id);
        (where === 'table' ? need : opt)[k]++;
      }
    }
  };
  add(tableIds, 'table');
  add(rackIds, 'rack');
  return { need, opt, jn: jokers.table.length, jo: jokers.rack.length, ids, jokers };
}

/** Turns the search's sets (kinds) back into sets of real tile ids. */
function realise(inv, sets) {
  const queues = inv.ids.map((q) => [...q.table, ...q.rack]);
  const jokerQueue = [...inv.jokers.table, ...inv.jokers.rack];
  return sets.map((parts) => parts.map((part) => (part.j === undefined ? queues[part.k].shift() : jokerQueue.shift())));
}

/** Everything a computer can see when choosing: the rules, the table and its own rack. */
export function bestPlay(room, seat, { budget = SEARCH_BUDGET } = {}) {
  const s = room.settings;
  const rack = room.racks[seat];
  const table = room.table;
  const melded = room.melded[seat];
  const attempts = [];

  if (!melded) {
    const inv = inventory(s, [], rack);
    const found = solve(s, { need: inv.need, opt: inv.opt, jn: 0, jo: inv.jo, mode: 'rep', budget });
    if (found && found.value >= s.meld && found.sets.length) attempts.push({ value: found.value, table: [...table, ...realise(inv, found.sets)] });
  } else {
    const flat = table.flat();
    const full = inventory(s, flat, rack);
    const a = solve(s, { need: full.need, opt: full.opt, jn: full.jn, jo: full.jo, mode: 'rack', budget });
    if (a && a.value > 0) attempts.push({ value: a.value, table: realise(full, a.sets) });
    const own = inventory(s, [], rack);
    const b = solve(s, { need: own.need, opt: own.opt, jn: 0, jo: own.jo, mode: 'rack', budget });
    if (b && b.value > 0 && b.sets.length) attempts.push({ value: b.value, table: [...table, ...realise(own, b.sets)] });
  }

  attempts.sort((x, y) => y.value - x.value);
  for (const attempt of attempts) {
    const checked = checkPlay(s, { before: table, rack, proposed: attempt.table, melded, meld: s.meld });
    if (checked.ok) return { table: attempt.table, added: checked.added.length };
  }
  return null;
}

/** { type: 'play', table } or { type: 'draw' }. */
export function chooseTurn(room, seat, options) {
  const play = bestPlay(room, seat, options);
  return play ? { type: 'play', table: play.table } : { type: 'draw' };
}

/** Does what pendingAction says. Returns the game's result. */
export function runPending(room, rng = Math.random, now = Date.now()) {
  const action = pendingAction(room);
  if (!action) return { ok: false, error: 'Nothing to do.' };
  const choice = chooseTurn(room, action.seat);
  if (choice.type === 'play') {
    const result = game.play(room, action.seat, { table: choice.table }, now);
    if (result.ok) return result;
  }
  return game.draw(room, action.seat, now);
}

export { totalTiles };
