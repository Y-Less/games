// The search shared by every Rummikub AI (see ai/). Tiles with the same colour and number are interchangeable, so the
// search works on "kinds" (colour, number) with a count of how many copies are on the table (which must all stay on it)
// and in the rack (which may be played). It builds the table set by set: always starting from the lowest kind that is
// left, it tries every run and group that begins there (jokers filling gaps or ends), or leaves a rack tile out. The
// value of a finished table is the points of rack tiles it uses (a joker is worth 30) unless the caller supplies its
// own `weights`, with memoising of states already seen and a cap on the number of states (a deterministic node count,
// never the clock), so a turn is always quick and always repeatable.
import { JOKER_VALUE, checkPlay, fitsJoker, isJoker, jokerOptions, rackValue, resolveSet, tileOf } from './rules.js';

export const SEARCH_BUDGET = 6000;

/**
 * Searches for the best table. `need` and `opt` are counts per kind (index colour * numbers + number - 1): copies that
 * must be used and copies that may be. `jn` / `jo` the same for jokers. mode 'rack' values the rack tiles used (jokers 30),
 * mode 'rep' values the numbers the tiles stand for (the first-meld rule). Returns { value, sets } where each set is a
 * list of parts ({ k } a tile of that kind, { j } a joker standing for that number), or null when nothing fits.
 */
export function solve(s, { need, opt, jn, jo, mode, budget = SEARCH_BUDGET, weights = null, jokerWeight = JOKER_VALUE, stats = null }) {
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
    return { k, was: 'opt', value: weights ? weights[k] : (k % N) + 1 };
  }
  function takeJoker() {
    if (jn > 0) {
      jn--;
      return { k: -1, was: 'need', value: 0 };
    }
    jo--;
    return { k: -1, was: 'opt', value: jokerWeight };
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
  if (stats) stats.nodes = (stats.nodes ?? 0) + nodes;
  if (!found) return null;
  const sets = [];
  for (let node = found.chain; node; node = node.next) sets.push(node.set);
  return { value: found.value, sets, aborted };
}

/** Counts per kind, and the ids behind them (table ids first, so the rack ones are the ones played). */
export function inventory(s, tableIds, rackIds) {
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
export function realise(inv, sets) {
  const queues = inv.ids.map((q) => [...q.table, ...q.rack]);
  const jokerQueue = [...inv.jokers.table, ...inv.jokers.rack];
  return sets.map((parts) => parts.map((part) => (part.j === undefined ? queues[part.k].shift() : jokerQueue.shift())));
}


/** The first attempt (best first) that the server's own check accepts, as { table, added, value }, or null. */
export function firstLegal(room, seat, attempts, limit = 6) {
  const s = room.settings;
  const rack = room.racks[seat];
  const melded = room.melded[seat];
  const sorted = attempts.map((a, i) => ({ a, i })).sort((x, y) => y.a.value - x.a.value || x.i - y.i);
  for (const { a } of sorted.slice(0, limit)) {
    const checked = checkPlay(s, { before: room.table, rack, proposed: a.table, melded, meld: s.meld });
    if (checked.ok) return { table: a.table, added: checked.added.length, value: a.value };
  }
  return null;
}

/** The first meld: new sets from the rack alone, worth the threshold. Returns attempts ({ value, table }). */
export function meldAttempts(room, seat, { budget = SEARCH_BUDGET, rackIds = room.racks[seat], weights = null, jokerWeight } = {}) {
  const s = room.settings;
  const inv = inventory(s, [], rackIds);
  const found = solve(s, { need: inv.need, opt: inv.opt, jn: 0, jo: inv.jo, mode: 'rep', budget, weights, jokerWeight });
  if (found && found.value >= s.meld && found.sets.length) return [{ value: found.value, table: [...room.table, ...realise(inv, found.sets)] }];
  return [];
}

/**
 * The search with no limit on how much of the table may be rearranged: either the whole table is taken apart and rebuilt, or
 * only new sets are made from the rack. This is what the 'standard' AI has always done.
 */
export function standardAttempts(room, seat, { budget = SEARCH_BUDGET, weights = null, jokerWeight } = {}) {
  const s = room.settings;
  const rack = room.racks[seat];
  const table = room.table;
  if (!room.melded[seat]) return meldAttempts(room, seat, { budget, weights, jokerWeight });
  const attempts = [];
  // A joker on the table cannot just be moved: it stands for a tile until that tile is swapped in. So a set with a joker is only
  // taken apart if the rack has a tile that fits (the server judges whether the swap was made); otherwise it stays as it is.
  const swappable = (ids) => ids.filter((id) => isJoker(s, id)).some((j) => rack.some((r) => fitsJoker(s, r, jokerOptions(s, ids, j))));
  const stays = table.filter((ids) => ids.some((id) => isJoker(s, id)) && !swappable(ids));
  const loose = table.filter((ids) => !stays.includes(ids));
  const full = inventory(s, loose.flat(), rack);
  const a = solve(s, { need: full.need, opt: full.opt, jn: full.jn, jo: full.jo, mode: 'rack', budget, weights, jokerWeight });
  if (a && a.value > 0) attempts.push({ value: a.value, table: [...stays, ...realise(full, a.sets)] });
  const withJoker = table.filter((ids) => ids.some((id) => isJoker(s, id)));
  if (withJoker.length > stays.length) {
    // the same without touching any joker set, in case the swap does not come off
    const safe = inventory(s, table.filter((ids) => !withJoker.includes(ids)).flat(), rack);
    const c = solve(s, { need: safe.need, opt: safe.opt, jn: safe.jn, jo: safe.jo, mode: 'rack', budget, weights, jokerWeight });
    if (c && c.value > 0) attempts.push({ value: c.value, table: [...withJoker, ...realise(safe, c.sets)] });
  }
  const own = inventory(s, [], rack);
  const b = solve(s, { need: own.need, opt: own.opt, jn: 0, jo: own.jo, mode: 'rack', budget, weights, jokerWeight });
  if (b && b.value > 0 && b.sets.length) attempts.push({ value: b.value, table: [...table, ...realise(own, b.sets)] });
  return attempts;
}

export function standardPlay(room, seat, options = {}) {
  return firstLegal(room, seat, standardAttempts(room, seat, options), 3);
}

// ---- a limit on how many table tiles may be moved ----
//
// "Moving" a table tile means taking it out of the set it is in, or taking its whole set apart. Tiles of a set that is
// merely added to are not moved. The search chooses which tiles of the table to free (the rest stay put as locked pieces,
// which may still be added to), solves for the freed tiles and the rack, and does that for every choice that moves at most
// `tableTiles` tiles, cheapest choices first. The order of the choices does not depend on the limit, so a bigger limit
// only ever looks at more choices (after the same ones a smaller limit looked at), and so can never do worse.

export const SHUFFLE_LIMITS = { solveNodes: 800, totalNodes: 20000, combos: 120 };

/** Possible ways to free tiles from one set: { cost, freed, kept } (kept: the pieces that stay together). */
function setOptions(s, ids, rack = []) {
  const L = ids.length;
  const resolved = resolveSet(s, ids);
  const jokers = ids.filter((id) => isJoker(s, id));
  if (jokers.length) {
    // a joker on the table cannot be moved, only swapped for a tile that fits: so the set stays, or is freed if the rack has one
    const swap = jokers.some((j) => rack.some((r) => fitsJoker(s, r, jokerOptions(s, ids, j))));
    return swap ? [{ cost: 0, freed: [], kept: [ids] }, { cost: L, freed: ids, kept: [] }] : [{ cost: 0, freed: [], kept: [ids] }];
  }
  const opts = [{ cost: 0, freed: [], kept: [ids] }, { cost: L, freed: ids, kept: [] }];
  const add = (freedIdx, pieces) => {
    const freed = freedIdx.map((i) => ids[i]);
    if (pieces.some((p) => p.length < 3 || !resolveSet(s, p).ok)) return;
    opts.push({ cost: freed.length, freed, kept: pieces });
  };
  if (!resolved.ok) return opts;
  if (resolved.kind === 'run') {
    if (L >= 4) {
      for (let i = 0; i < L; i++) add([i], [ids.slice(0, i), ids.slice(i + 1)].filter((p) => p.length));
    }
    if (L >= 5) {
      add([0, 1], [ids.slice(2)]);
      add([L - 2, L - 1], [ids.slice(0, L - 2)]);
      add([0, L - 1], [ids.slice(1, L - 1)]);
    }
  } else if (L === 4) {
    for (let i = 0; i < L; i++) add([i], [ids.filter((_, j) => j !== i)]);
  }
  return opts;
}

const touches = (a, b) => {
  if (a.joker || b.joker) return true;
  return a.number === b.number || (a.colour === b.colour && Math.abs(a.number - b.number) <= 2);
};

/** Adds rack tiles that fit to locked pieces, greedily. Returns { pieces, left }. */
function extendPieces(s, pieces, rackIds, withJokers) {
  const pool = [...rackIds].sort((x, y) => Number(isJoker(s, x)) - Number(isJoker(s, y)) || tileOf(s, y).number - tileOf(s, x).number);
  const out = pieces.map((p) => [...p]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const piece of out) {
      for (let i = 0; i < pool.length; i++) {
        if (!withJokers && isJoker(s, pool[i])) continue;
        if (resolveSet(s, [...piece, pool[i]]).ok) {
          piece.push(pool[i]);
          pool.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
  }
  return { pieces: out, left: pool };
}

/**
 * Every attempt for a computer that may move at most `tableTiles` table tiles in a turn: [{ value, table, moved }].
 * Deterministic: node counts (never the clock) bound the work.
 */
export function shuffleAttempts(room, seat, { tableTiles = 0, solveNodes, totalNodes, combos, weights = null, jokerWeight = JOKER_VALUE, extendJokers = true } = {}) {
  const limits = { ...SHUFFLE_LIMITS };
  if (solveNodes) limits.solveNodes = solveNodes;
  if (totalNodes) limits.totalNodes = totalNodes;
  if (combos) limits.combos = combos;
  const s = room.settings;
  const rack = room.racks[seat];
  if (!room.melded[seat]) return meldAttempts(room, seat);
  const rackSet = new Set(rack);
  const rackTiles = rack.map((id) => tileOf(s, id));
  const rackHasJoker = rackTiles.some((t) => t.joker);
  // A freed tile is only worth trying if it fits with a rack tile, or with a table tile of another set that does.
  const tableTiles1 = room.table.map((ids) => ids.map((id) => tileOf(s, id)));
  const direct = tableTiles1.map((tiles) => tiles.map((x) => rackHasJoker || x.joker || rackTiles.some((r) => touches(x, r))));
  const relevant = (ids, setIndex) => ids.some((id) => {
    const x = tileOf(s, id);
    if (rackHasJoker || x.joker || rackTiles.some((r) => touches(x, r))) return true;
    return tableTiles1.some((tiles, j) => j !== setIndex && tiles.some((y, k) => direct[j][k] && touches(x, y)));
  });
  const perSet = room.table.map((ids, index) => setOptions(s, ids, rack).filter((o) => o.cost === 0 || relevant(o.freed, index)));
  const maxFrom = Array(perSet.length + 1).fill(0);
  for (let i = perSet.length - 1; i >= 0; i--) maxFrom[i] = maxFrom[i + 1] + Math.max(...perSet[i].map((o) => o.cost));

  const stats = { nodes: 0 };
  const attempts = [];
  let evaluated = 0;
  const done = () => evaluated >= limits.combos || stats.nodes >= limits.totalNodes;

  const valueOf = (table) => {
    const played = table.flat().filter((id) => rackSet.has(id));
    if (!weights) return rackValue(s, played);
    return played.reduce((sum, id) => sum + (isJoker(s, id) ? jokerWeight : weights[kindOf(id)]), 0);
  };
  const kindOf = (id) => {
    const t = tileOf(s, id);
    return t.colour * s.numbers + t.number - 1;
  };
  const solveWith = (freed, rackLeft) => {
    const inv = inventory(s, freed, rackLeft);
    const found = solve(s, { need: inv.need, opt: inv.opt, jn: inv.jn, jo: inv.jo, mode: 'rack', budget: limits.solveNodes, stats, weights, jokerWeight });
    return found ? realise(inv, found.sets) : null;
  };
  const evaluate = (chosen, cost) => {
    evaluated++;
    const freed = chosen.flatMap((o) => o.freed);
    const kept = chosen.flatMap((o) => o.kept);
    const variants = [
      // 1: build with the rack, then add leftovers to the locked pieces
      () => {
        const t = solveWith(freed, rack);
        if (!t) return null;
        const used = new Set(t.flat());
        return [...extendPieces(s, kept, rack.filter((id) => !used.has(id)), extendJokers).pieces, ...t];
      },
      // 2: add to the locked pieces first (jokers too), then build with what is left
      () => {
        const ext = extendPieces(s, kept, rack, extendJokers);
        const t = solveWith(freed, ext.left);
        return t && [...ext.pieces, ...t];
      },
      // 3: add plain tiles first, build, then add anything left (jokers) afterwards
      () => {
        const ext = extendPieces(s, kept, rack, false);
        const t = solveWith(freed, ext.left);
        if (!t) return null;
        const used = new Set(t.flat());
        return [...extendPieces(s, ext.pieces, ext.left.filter((id) => !used.has(id)), extendJokers).pieces, ...t];
      },
    ];
    for (const variant of variants) {
      const table = variant();
      if (!table) continue;
      const value = valueOf(table);
      if (value > 0) attempts.push({ value, table, moved: cost });
    }
  };

  const maxCost = Math.min(tableTiles, maxFrom[0]);
  for (let cost = 0; cost <= maxCost && !done(); cost++) {
    const walk = (i, remaining, chosen) => {
      if (done()) return;
      if (i === perSet.length) {
        if (remaining === 0) evaluate(chosen, cost);
        return;
      }
      if (remaining > maxFrom[i]) return;
      for (const option of perSet[i]) {
        if (option.cost > remaining) continue;
        chosen.push(option);
        walk(i + 1, remaining - option.cost, chosen);
        chosen.pop();
      }
    };
    walk(0, cost, []);
  }
  return attempts;
}

export function shufflePlay(room, seat, options) {
  return firstLegal(room, seat, shuffleAttempts(room, seat, options));
}
