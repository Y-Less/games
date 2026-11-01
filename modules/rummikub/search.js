// The search shared by every Rummikub AI (see ai/). Tiles with the same colour and number are interchangeable, so the
// search works on "kinds" (colour, number) with a count of how many copies are on the table (which must all stay on it)
// and in the rack (which may be played). It builds the table set by set: always starting from the lowest kind that is
// left, it tries every run and group that begins there (jokers filling gaps or ends), or leaves a rack tile out. The
// value of a finished table is the points of rack tiles it uses (a joker is worth 30) unless the caller supplies its
// own `weights`, with memoising of states already seen and a cap on the number of states (a deterministic node count,
// never the clock), so a turn is always quick and always repeatable.
//
// Depends on ./rules.js only (set validation, joker rules and checkPlay). The AIs in ai/ choose how to call these
// functions (which weights, which joker value, how many table tiles may move); nothing here touches the room.
import { JOKER_VALUE, checkPlay, fitsJoker, isJoker, jokerOptions, rackValue, resolveSet, tileOf } from './rules.js';

// The default cap on states visited by one solve(): large enough to find good tables, small enough that a turn stays quick.
export const SEARCH_BUDGET = 6000;

/**
 * Searches for the best table. `need` and `opt` are counts per kind (index colour * numbers + number - 1): copies that
 * must be used and copies that may be. `jn` / `jo` the same for jokers. mode 'rack' values the rack tiles used (jokers 30),
 * mode 'rep' values the numbers the tiles stand for (the first-meld rule). Returns { value, sets } where each set is a
 * list of parts ({ k } a tile of that kind, { j } a joker standing for that number), or null when nothing fits.
 *
 * @param {object} s  the room's settings
 * @param {object} args
 * @param {Int8Array} args.need  per kind, copies that must be used (table tiles); lent to the search and restored
 * @param {Int8Array} args.opt  per kind, copies that may be used (rack tiles); lent to the search and restored
 * @param {number} args.jn  jokers that must be used (on the table)
 * @param {number} args.jo  jokers that may be used (in the rack)
 * @param {'rack' | 'rep'} args.mode  what to maximise (see above)
 * @param {number} [args.budget]  the most search states to visit before giving up on the rest
 * @param {Int32Array | null} [args.weights]  per-kind value of playing a rack tile, instead of its number (an AI's own taste)
 * @param {number} [args.jokerWeight]  the value of playing a rack joker (30 by default; negative means "hold it back")
 * @param {object | null} [args.stats]  if given, its `nodes` count is increased by the states visited, so callers can share a budget
 * @returns {{ value: number, sets: object[][], aborted: boolean } | null} the best table found (aborted: the budget ran out, so it
 *   may not be the best possible), or null when no arrangement uses every table tile
 * Side effects: temporarily changes need, opt (restored before returning); adds to args.stats.nodes if given.
 */
export function solve(s, { need, opt, jn, jo, mode, budget = SEARCH_BUDGET, weights = null, jokerWeight = JOKER_VALUE, stats = null }) {
  const N = s.numbers;
  const C = s.colours;
  const K = N * C;
  let nodes = 0;
  let aborted = false;
  const memo = new Map();
  // How many copies of a kind are left to use, whether they must be used (on the table) or may be (in the rack).
  const avail = (k) => need[k] + opt[k];

  /**
   * Uses up one copy of a kind for a set being built, preferring a copy that has to be used (a table tile) over one that
   * may be (a rack tile). Side effect: lowers need[k] or opt[k]; undo it with give().
   *
   * @param {number} k  the kind (colour * numbers + number - 1)
   * @returns {{ k: number, was: 'need' | 'opt', value: number }} what was taken, and what it adds to the table's value
   *   (nothing for a table tile; the weight, or the plain number, for a rack tile)
   */
  function takeKind(k) {
    if (need[k] > 0) {
      need[k]--;
      return { k, was: 'need', value: 0 };
    }
    opt[k]--;
    return { k, was: 'opt', value: weights ? weights[k] : (k % N) + 1 };
  }
  /**
   * Uses up one joker, preferring one that has to be used (on the table) over one from the rack. Side effect: lowers jn or
   * jo; undo it with give().
   *
   * @returns {{ k: -1, was: 'need' | 'opt', value: number }} what was taken (k is -1 for a joker) and its value
   */
  function takeJoker() {
    if (jn > 0) {
      jn--;
      return { k: -1, was: 'need', value: 0 };
    }
    jo--;
    return { k: -1, was: 'opt', value: jokerWeight };
  }
  /**
   * Puts back what takeKind and takeJoker took, so the search can try another choice. Side effect: raises the counts again.
   *
   * @param {{ k: number, was: 'need' | 'opt' }[]} taken  the results of those calls
   */
  function give(taken) {
    for (const t of taken) {
      if (t.k === -1) t.was === 'need' ? jn++ : jo++;
      else (t.was === 'need' ? need : opt)[t.k]++;
    }
  }

  /**
   * Every set that could start at kind p, being the lowest kind still unused: runs that begin at p (with up to two jokers in
   * front, and jokers filling gaps or extending the end) and groups of one number in different colours whose lowest colour
   * is p's. Biggest sets first, and fewer jokers first among equals, so the best-looking choices are tried early.
   *
   * @param {number} p  the kind the next set must contain
   * @returns {{ parts: ({ k: number } | { j: number })[], rep: number }[]} each set as its parts (a tile of a kind, or a
   *   joker standing for a number) and what its tiles add up to as numbers (for the first-meld rule)
   */
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

  /**
   * The depth-first search itself: finds the best way to arrange everything that is left, from kind `start` upwards. Results
   * are remembered (memo) by position and what remains. Stops, and marks the whole solve as aborted, when the node budget is
   * spent. Side effects: borrows and returns tiles through takeKind/give; counts nodes.
   *
   * @param {number} start  the lowest kind that might still have copies left
   * @returns {{ value: number, chain: object | null } | null} the best value and the chain of sets giving it, or null when
   *   no arrangement uses every table tile
   */
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

/**
 * Counts the tiles per kind, and remembers which tile ids are behind each count (table ids first, so the rack ones are the
 * ones played).
 *
 * @param {object} s  the room's settings
 * @param {number[]} tableIds  tiles that must stay on the table
 * @param {number[]} rackIds  tiles that may be played
 * @returns {{ need: Int8Array, opt: Int8Array, jn: number, jo: number, ids: object[], jokers: object }} the counts for solve()
 *   and the ids to turn its answer back into tiles
 * Side effects: none.
 */
export function inventory(s, tableIds, rackIds) {
  const K = s.numbers * s.colours;
  const need = new Int8Array(K);
  const opt = new Int8Array(K);
  const ids = Array.from({ length: K }, () => ({ table: [], rack: [] }));
  const jokers = { table: [], rack: [] };
  // Files each id of `list` under the table or rack side of its kind (or the jokers), and counts it in need or opt.
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

/**
 * Turns the search's sets (kinds) back into sets of real tile ids. Does not change `inv`.
 *
 * @param {object} inv  what inventory() returned
 * @param {object[][]} sets  the sets solve() found
 * @returns {number[][]} the same sets as tile ids
 * Side effects: none.
 */
export function realise(inv, sets) {
  const queues = inv.ids.map((q) => [...q.table, ...q.rack]);
  const jokerQueue = [...inv.jokers.table, ...inv.jokers.rack];
  return sets.map((parts) => parts.map((part) => (part.j === undefined ? queues[part.k].shift() : jokerQueue.shift())));
}

/**
 * The first attempt (best first) that the server's own check accepts, as { table, added, value }, or null.
 *
 * @param {object} room  not changed
 * @param {number} seat  whose rack the attempts play from
 * @param {{ value: number, table: number[][] }[]} attempts  candidate tables
 * @param {number} [limit]  how many of the best attempts to check
 * @returns {{ table: number[][], added: number, value: number } | null} the play (added = rack tiles it uses), or null when none of
 *   the best `limit` passes the check (the search can propose layouts the rules refuse, e.g. a joker moved without a swap)
 * Side effects: none.
 */
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

/**
 * The first meld: new sets from the rack alone, worth the threshold.
 *
 * @param {object} room  not changed
 * @param {number} seat  whose rack to use
 * @param {object} [options]  budget, rackIds (default the whole rack), weights and jokerWeight for solve()
 * @returns {{ value: number, table: number[][] }[]} zero or one attempts (mode 'rep' counts the numbers the tiles stand for,
 *   because that is how the first-meld threshold is scored)
 * Side effects: none.
 */
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
 *
 * @param {object} room  not changed
 * @param {number} seat  whose rack to use
 * @param {object} [options]  budget, weights and jokerWeight for solve()
 * @returns {{ value: number, table: number[][] }[]} candidate tables, in no particular order
 * Side effects: none.
 */
export function standardAttempts(room, seat, { budget = SEARCH_BUDGET, weights = null, jokerWeight } = {}) {
  const s = room.settings;
  const rack = room.racks[seat];
  const table = room.table;
  if (!room.melded[seat]) return meldAttempts(room, seat, { budget, weights, jokerWeight });
  const attempts = [];
  // A joker on the table cannot just be moved: it stands for a tile until that tile is swapped in. So a set with a joker is only
  // taken apart if the rack has a tile that fits (the server judges whether the swap was made); otherwise it stays as it is.
  /** Can a set with a joker be taken apart because the rack has a tile the joker could be swapped for? */
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

/**
 * The play of the 'standard' AI: the best of the attempts of standardAttempts that the server's own check accepts.
 *
 * @param {object} room  not changed
 * @param {number} seat  whose rack to play from
 * @param {object} [options]  passed to standardAttempts (budget, weights, jokerWeight)
 * @returns {{ table: number[][], added: number, value: number } | null} the play, or null when there is none
 * Side effects: none.
 */
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

// Work caps for shuffleAttempts: nodes per solve, nodes over the whole turn, and table-tile choices tried. Fixed numbers (not
// time) so a turn is repeatable; they are what keep the biggest table-tile limits affordable.
export const SHUFFLE_LIMITS = { solveNodes: 800, totalNodes: 20000, combos: 120 };

/**
 * Possible ways to free tiles from one set: keep it whole, free all of it, or (for a run of 4+ or a group of 4) free one or
 * two end/middle tiles so the leftovers are still legal sets. A set holding a joker is only freed if the rack could swap the
 * joker out, since a table joker cannot just be moved.
 *
 * @param {object} s  the room's settings
 * @param {number[]} ids  the set
 * @param {number[]} [rack]  the rack, to see whether a joker in the set could be swapped
 * @returns {{ cost: number, freed: number[], kept: number[][] }[]} cost = table tiles moved; kept = pieces that stay together
 * Side effects: none.
 */
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
  /**
   * Records one way of splitting this set if every piece left over is still a legal set.
   *
   * @param {number[]} freedIdx  positions in `ids` of the tiles taken out
   * @param {number[][]} pieces  what is left of the set, as pieces that stay put
   */
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

/**
 * Could two tiles end up in the same set? True for a joker, the same number, or the same colour within two numbers. Used to
 * skip table tiles that cannot possibly be of use to the rack.
 *
 * @param {object} a  a tile as returned by tileOf
 * @param {object} b  another tile
 * @returns {boolean} whether they could share a set
 * Side effects: none.
 */
const touches = (a, b) => {
  if (a.joker || b.joker) return true;
  return a.number === b.number || (a.colour === b.colour && Math.abs(a.number - b.number) <= 2);
};

/**
 * Adds rack tiles that fit to locked pieces, greedily (high tiles first, jokers last, so jokers are spent only when nothing
 * else fits).
 *
 * @param {object} s  the room's settings
 * @param {number[][]} pieces  the sets that stay put
 * @param {number[]} rackIds  rack tiles that may be added
 * @param {boolean} withJokers  whether rack jokers may be added too
 * @returns {{ pieces: number[][], left: number[] }} the extended copies of the pieces and the rack tiles not used
 * Side effects: none (the inputs are copied).
 */
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
 *
 * @param {object} room  not changed
 * @param {number} seat  whose rack to play from
 * @param {object} [options]
 * @param {number} [options.tableTiles]  the most table tiles that may be moved
 * @param {number} [options.solveNodes]  override of SHUFFLE_LIMITS.solveNodes
 * @param {number} [options.totalNodes]  override of SHUFFLE_LIMITS.totalNodes
 * @param {number} [options.combos]  override of SHUFFLE_LIMITS.combos
 * @param {Int32Array | null} [options.weights]  per-kind value of playing a rack tile (default: its number)
 * @param {number} [options.jokerWeight]  the value of playing a rack joker
 * @param {boolean} [options.extendJokers]  whether jokers may be added to locked sets (false when jokers are being held back)
 * @returns {{ value: number, table: number[][], moved: number }[]} candidate tables with how many table tiles each moves
 * Side effects: none.
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
  // direct[j][k]: could table tile k of set j go with a rack tile (or is a joker about)?
  const direct = tableTiles1.map((tiles) => tiles.map((x) => rackHasJoker || x.joker || rackTiles.some((r) => touches(x, r))));
  /**
   * Is it worth freeing these tiles? Only if one fits with a rack tile, or with a tile of another set that does.
   *
   * @param {number[]} ids  the tiles that would be freed
   * @param {number} setIndex  the index of the set they come from
   * @returns {boolean}
   */
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
  // Has the search used up its budget of combinations or solver nodes?
  const done = () => evaluated >= limits.combos || stats.nodes >= limits.totalNodes;

  /**
   * What a table is worth to this player: the rack tiles it uses, by points or by the AI's own weights.
   *
   * @param {number[][]} table  the proposed table
   * @returns {number}
   */
  const valueOf = (table) => {
    const played = table.flat().filter((id) => rackSet.has(id));
    if (!weights) return rackValue(s, played);
    return played.reduce((sum, id) => sum + (isJoker(s, id) ? jokerWeight : weights[kindOf(id)]), 0);
  };
  // The kind (colour * numbers + number - 1) of a numbered tile id.
  const kindOf = (id) => {
    const t = tileOf(s, id);
    return t.colour * s.numbers + t.number - 1;
  };
  /**
   * Solves for a set of freed table tiles plus the rack tiles still free to use, within the per-solve node limit.
   *
   * @param {number[]} freed  table tiles that must all end up in sets
   * @param {number[]} rackLeft  rack tiles that may be used
   * @returns {number[][] | null} the new sets as tile ids, or null if no arrangement exists
   */
  const solveWith = (freed, rackLeft) => {
    const inv = inventory(s, freed, rackLeft);
    const found = solve(s, { need: inv.need, opt: inv.opt, jn: inv.jn, jo: inv.jo, mode: 'rack', budget: limits.solveNodes, stats, weights, jokerWeight });
    return found ? realise(inv, found.sets) : null;
  };
  /**
   * Turns one choice of freed tiles into attempts: tries three orders of building (build then extend locked pieces, extend
   * then build, extend with plain tiles then build then add jokers) and keeps each result that plays something. Side
   * effects: adds to `attempts` and counts one evaluation.
   *
   * @param {{ freed: number[], kept: number[][] }[]} chosen  the option picked for each table set
   * @param {number} cost  how many table tiles this choice moves
   */
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
    /**
     * Visits every combination of per-set options that moves exactly `cost` tiles, calling evaluate() on each.
     *
     * @param {number} i  the index of the table set being decided
     * @param {number} remaining  how many tiles may still be moved
     * @param {object[]} chosen  the options picked so far (pushed and popped as the walk goes)
     */
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

/**
 * The play of an AI that may move a limited number of table tiles: the best legal attempt of shuffleAttempts.
 *
 * @param {object} room  not changed
 * @param {number} seat  whose rack to play from
 * @param {object} [options]  passed to shuffleAttempts (tableTiles, node limits, weights...)
 * @returns {{ table: number[][], added: number, value: number } | null} the play, or null when there is none
 * Side effects: none.
 */
export function shufflePlay(room, seat, options) {
  return firstLegal(room, seat, shuffleAttempts(room, seat, options));
}
