// "Sharp": the strongest computer player. It values a whole position rather than a single tile:
//   - the points its full pattern lines will score when the wall is tiled (in row order, as the rules do it),
//   - minus the real floor penalty, so a move that overflows is priced exactly,
//   - plus a discounted share for lines that are part-built and can still be finished,
//   - plus progress towards the end-of-game bonuses (rows, columns, colour sets), weighted by how long it expects the
//     game to last.
// It chooses by looking ahead: the best few moves by that measure are each played out to the end of the round (everyone
// else taking the quick, sensible option), and the resulting boards are compared, so the floor risk of later turns and
// the cost of what it leaves the opponents are priced in rather than guessed.
// It also decides when the game should end. A row completed this round ends the game, so if finishing one leaves it
// ahead after the bonuses it goes for it; if it would be behind it declines and builds columns and sets instead, which
// is why games between sharp players are not all five rounds long.
// Depends on: ../rules.js (scoring, bonuses, floor, wall helpers) and ./common.js (copyWall, take previews, column choosing).
import { COLOURS, COLUMN_BONUS, FLOOR_SLOTS, ROW_BONUS, SET_BONUS, SIZE, bonuses, columnsFor, countOf, floorPenalty, lineCapacity, rowComplete, tileScore } from '../rules.js';
import { bestColumnBy, chooseColumnBy, copyWall, takeOf, tilesLeft } from './common.js';

// Tuning constants. LONG_GAME discounts bonuses that are not yet earned, because the game may end before they are;
// MARGIN_PAYS is the reward per point of lead when ending the game (capped in evaluate); CANDIDATES and PLAYOUTS bound
// the search so a move takes milliseconds; RIVAL_SHARE stops it from ignoring what a move gives the opponents,
// while still caring more about its own board.
const LONG_GAME = 0.55; // how much of an unfinished bonus is worth counting while the game may still go on
const MARGIN_PAYS = 0.35;
const CANDIDATES = 6; // moves played out to the end of the round
const PLAYOUTS = 2;
const RIVAL_SHARE = 0.5; // how much an opponent's gain counts against us

/**
 * Applies every full pattern line to a copy of the wall in row order, as the tiling phase does.
 * (The column is chosen with a fixed tie-break, `() => 0`, so the projection is deterministic.)
 *
 * @param {(number | null)[][]} wall  the wall now (not changed)
 * @param {{ colour: number | null, count: number }[]} lines  the pattern lines to tile
 * @param {boolean} free  true on a free wall
 * @returns {{ wall: (number | null)[][], gain: number }} the projected wall and the points the tiling would score
 *
 * Side effects: none (works on a copy of the wall).
 */
function project(wall, lines, free) {
  const next = copyWall(wall);
  let gain = 0;
  for (let row = 0; row < SIZE; row++) {
    const line = lines[row];
    if (line.count !== lineCapacity(row)) continue;
    const best = bestColumnBy(next, row, line.colour, free, () => 0, (w, col) => tileScore(w, row, col));
    if (!best) continue;
    next[row][best.col] = line.colour;
    gain += tileScore(next, row, best.col);
  }
  return { wall: next, gain };
}

/**
 * Progress towards the bonuses that are not yet earned: a cubic ramp, so nearly-done units count for most.
 *
 * @param {(number | null)[][]} wall
 * @returns {number} the summed share of the row, column and colour-set bonuses still to win
 *
 * Side effects: none.
 */
function potential(wall) {
  let p = 0;
  for (let r = 0; r < SIZE; r++) {
    const f = wall[r].filter((c) => c !== null).length;
    if (f < SIZE) p += ROW_BONUS * (f / SIZE) ** 3;
  }
  for (let c = 0; c < SIZE; c++) {
    const f = wall.filter((row) => row[c] !== null).length;
    if (f < SIZE) p += COLUMN_BONUS * (f / SIZE) ** 3;
  }
  for (const colour of COLOURS) {
    const f = wall.flat().filter((x) => x === colour).length;
    if (f < SIZE) p += SET_BONUS * (f / SIZE) ** 3;
  }
  return p;
}

/**
 * Is any row of this wall complete (which ends the game at the end of the round)?
 *
 * @param {(number | null)[][]} wall  the wall to look at
 * @returns {boolean} true when at least one row is full
 *
 * Side effects: none.
 */
const anyRow = (wall) => wall.some((_, r) => rowComplete(wall, r));

/**
 * The value of everyone's boards if the round ended now.
 *
 * @param {object} state  the AI snapshot
 * @param {number} seat   the seat doing the evaluating
 * @param {{ lines: object[], floor: number }[]} boards  one per seat; `floor` is a slot count
 * @param {(colour: number, need: number) => number} chance  how likely a part-built line is to be finished
 * @returns {{ mine: number, others: number }} the value for `seat` and the mean value of the other seats
 *
 * Side effects: none (all the work is on projected copies).
 */
function evaluate(state, seat, boards, chance) {
  const free = state.settings.freeWall;
  const projs = boards.map((b, p) => project(state.walls[p], b.lines, free));
  const penalties = boards.map((b) => floorPenalty({ length: b.floor }));
  const totals = projs.map((pr, p) => Math.max(0, state.scores[p] + pr.gain - penalties[p]));
  // `mine`: this seat would end the game; `ends`: anybody would. Once the game is ending, unearned bonuses stop counting.
  const mine = anyRow(projs[seat].wall);
  const ends = projs.some((pr) => anyRow(pr.wall));
  // Projected final totals (score plus every bonus), for judging whether ending the game would win it.
  const finals = projs.map((pr, p) => totals[p] + bonuses(pr.wall).points);
  const values = projs.map((pr, p) => {
    let value = pr.gain - penalties[p];
    boards[p].lines.forEach((line, row) => {
      if (line.count === 0 || line.count === lineCapacity(row)) return;
      const columns = columnsFor(pr.wall, row, line.colour, free);
      if (!columns.length) {
        value -= 0.3 * line.count; // tiles stuck on a line that can never be finished
        return;
      }
      // A part-built line is worth what it would score if finished, times the chance of finishing it, times how far along
      // it is: so the discount is steeper for lines that are barely started.
      const done = bestColumnBy(pr.wall, row, line.colour, free, () => 0, (w, col) => tileScore(w, row, col)).value;
      value += done * chance(line.colour, lineCapacity(row) - line.count) * (line.count / lineCapacity(row));
    });
    value += bonuses(pr.wall).points + (ends ? 0 : LONG_GAME * potential(pr.wall));
    if (p === seat && mine) {
      // Ending the game: good only if it is won. Behind, it is better to keep it going.
      // The margin over the best rival decides the reward (a lead of up to 10 counts) or the penalty (a deficit of up to 12).
      const margin = finals[seat] - Math.max(...finals.filter((_, q) => q !== seat));
      value += margin > 0 ? 3 + MARGIN_PAYS * Math.min(margin, 10) : -(2 + 0.5 * Math.min(-margin, 12));
    }
    return value;
  });
  const others = values.filter((_, p) => p !== seat);
  return { mine: values[seat], others: others.reduce((a, b) => a + b, 0) / others.length };
}

/**
 * The boards of every seat in a snapshot, in the shape evaluate() takes.
 *
 * @param {object} state  the AI snapshot (not changed)
 * @returns {{ lines: object[], floor: number }[]} one per seat; `floor` is a slot count, and the lines are the snapshot's own arrays (read only)
 *
 * Side effects: none.
 */
const boardsOf = (state) => state.lines.map((lines, p) => ({ lines, floor: state.floors[p].length }));

/**
 * A fast copy of the table for playing a round out.
 *
 * @param {object} state  the AI snapshot (not changed)
 * @returns {{ factories: number[][], centre: number[], marker: boolean, boards: object[] }} the sandbox, which take() mutates
 *
 * Side effects: none (it builds new objects; `state` is left alone).
 */
function sandbox(state) {
  return {
    factories: state.factories.map((f) => f.slice()),
    centre: state.centre.slice(),
    marker: state.markerInCentre,
    boards: state.lines.map((lines, p) => ({ lines: lines.map((l) => ({ ...l })), floor: state.floors[p].length })),
  };
}

/**
 * Plays a move on a sandbox (the same take as the rules, on the cheap copy).
 * Side effects: mutates `box` (the sources, the marker and seat `p`'s board).
 *
 * @param {object} box  from sandbox()
 * @param {number} p    the seat taking
 * @param {{ source: 'centre' | number, colour: number, line: number | 'floor' }} move
 */
function take(box, p, move) {
  const tiles = move.source === 'centre' ? box.centre : box.factories[move.source];
  const count = countOf(tiles, move.colour);
  const marker = move.source === 'centre' && box.marker;
  if (move.source === 'centre') {
    box.centre = box.centre.filter((c) => c !== move.colour);
    box.marker = false;
  } else {
    box.centre.push(...tiles.filter((c) => c !== move.colour));
    box.factories[move.source] = [];
  }
  const board = box.boards[p];
  let over = count;
  if (move.line !== 'floor') {
    const line = board.lines[move.line];
    const put = Math.min(count, lineCapacity(move.line) - line.count);
    board.lines[move.line] = { colour: move.colour, count: line.count + put };
    over = count - put;
  }
  board.floor = Math.min(FLOOR_SLOTS, board.floor + over + (marker ? 1 : 0));
}

/**
 * Every distinct (source, colour) on a sandbox table.
 *
 * @param {object} box  from sandbox()
 * @returns {{ source: 'centre' | number, colour: number, count: number, marker: boolean }[]}
 *
 * Side effects: none.
 */
function offers(box) {
  const out = [];
  for (const source of ['centre', ...box.factories.keys()]) {
    const tiles = source === 'centre' ? box.centre : box.factories[source];
    for (const colour of new Set(tiles)) out.push({ source, colour, count: countOf(tiles, colour), marker: source === 'centre' && box.marker });
  }
  return out;
}

/**
 * For each seat, row and colour: the wall score of the tile that colour would make in that row, or -1 if it cannot go there.
 *
 * @param {object} state  the AI snapshot
 * @returns {number[][][]} table[seat][row][colour]
 *
 * Side effects: none.
 */
function tileTable(state) {
  const free = state.settings.freeWall;
  return state.walls.map((wall) =>
    Array.from({ length: SIZE }, (_, row) =>
      COLOURS.map((colour) => {
        const best = bestColumnBy(wall, row, colour, free, () => 0, (w, col) => tileScore(w, row, col));
        return best ? best.value : -1;
      }),
    ),
  );
}

/**
 * The quick policy everyone follows in a play-out: finish lines for points, avoid the floor, a little noise.
 *
 * @param {object} box    from sandbox()
 * @param {number} p      the seat to move
 * @param {number[][][]} table  from tileTable()
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {{ source: 'centre' | number, colour: number, line: number | 'floor', value: number } | null} null if nothing is on the table
 *
 * Side effects: none, apart from drawing from `rng`.
 */
function quickMove(box, p, table, rng) {
  const board = box.boards[p];
  let best = null;
  for (const offer of offers(box)) {
    // Start from "put everything on the floor", priced at 0.7 per slot still free (a milder rate than the real penalty,
    // so a truly bad table can still be coped with), and see whether any line beats it.
    let choice = { line: 'floor', value: -0.7 * Math.min(FLOOR_SLOTS - board.floor, offer.count + (offer.marker ? 1 : 0)) };
    for (let line = 0; line < SIZE; line++) {
      const have = board.lines[line];
      const cap = lineCapacity(line);
      if (have.count >= cap || (have.count > 0 && have.colour !== offer.colour) || table[p][line][offer.colour] < 0) continue;
      const put = Math.min(offer.count, cap - have.count);
      const over = offer.count - put + (offer.marker ? 1 : 0);
      const pen = Math.max(0, floorPenalty({ length: Math.min(FLOOR_SLOTS, board.floor + over) }) - floorPenalty({ length: board.floor }));
      const done = have.count + put === cap;
      // A finished line is worth its wall score plus 0.5; otherwise a little for each tile and half-credit for progress.
      // The marker (0.3) is a small plus: going first next round helps.
      const value = -pen + (done ? table[p][line][offer.colour] + 0.5 : 0.1 * put + 0.5 * ((have.count + put) / cap)) + (offer.marker ? 0.3 : 0);
      if (value > choice.value) choice = { line, value };
    }
    // Noisier than the real evaluation (0.4): the stand-ins for the opponents should be sensible but not perfectly predictable.
    const value = choice.value + rng() * 0.4;
    if (!best || value > best.value) best = { source: offer.source, colour: offer.colour, line: choice.line, value };
  }
  return best;
}

/**
 * Plays the rest of the round after `move` and values the boards at the end of it.
 *
 * @param {object} state  the AI snapshot (not changed)
 * @param {number} seat   the seat making `move`
 * @param {object} move   the candidate move
 * @param {number[][][]} table  from tileTable()
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {{ mine: number, others: number }} from evaluate()
 *
 * Side effects: none, apart from drawing from `rng`.
 */
function playOut(state, seat, move, table, rng) {
  // The candidate move is played first; the other seats then follow in turn order with the quick policy until the table is empty.
  const box = sandbox(state);
  take(box, seat, move);
  let p = (seat + 1) % state.size;
  for (let guard = 0; guard < 60 && (box.centre.length || box.factories.some((f) => f.length)); guard++) {
    const next = quickMove(box, p, table, rng);
    if (!next) break;
    take(box, p, next);
    p = (p + 1) % state.size;
  }
  const leftover = box.centre.length + box.factories.reduce((n, f) => n + f.length, 0);
  // Tiles still on the table (never, once played out) would make a line more likely to finish; after the refill it is a coin toss.
  void leftover;
  return evaluate(state, seat, box.boards, () => 0.5);
}

/**
 * The one-move value, used to choose which moves deserve a play-out.
 *
 * @param {object} state  the AI snapshot
 * @param {number} seat   the seat moving
 * @param {object} move   the candidate move
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {number} higher is better
 *
 * Side effects: none, apart from drawing from `rng`.
 */
function quickValue(state, seat, move, rng) {
  // Build the boards as they would be after this move (without playing anyone else), then evaluate them.
  const { marker, preview } = takeOf(state, seat, move);
  const boards = boardsOf(state).map((b) => ({ lines: b.lines, floor: b.floor }));
  const lines = state.lines[seat].map((l) => ({ ...l }));
  if (move.line !== 'floor') lines[move.line] = { colour: move.colour, count: lines[move.line].count + preview.put };
  boards[seat] = { lines, floor: Math.min(FLOOR_SLOTS, state.floors[seat].length + preview.onFloor + (preview.markerOnFloor ? 1 : 0)) };
  const after = { ...state };
  const { mine } = evaluate(after, seat, boards, (colour, need) => {
    const available = tilesLeft(state, colour, move.source);
    return available >= need ? 0.7 : available > 0 ? 0.4 : 0.25;
  });
  // A little for the marker and a very little noise (0.05): this is only a ranking to choose which moves to play out.
  return mine + (marker ? 0.5 : 0) + rng() * 0.05;
}

export default {
  id: 'sharp',
  name: 'Sharp',
  description: 'Looks ahead: plays the best few moves out to the end of the round, pricing the floor exactly and what it leaves opponents. Ends the game early only when it is ahead, and plays on when it is not.',
  weight: 3,
  /**
   * Ranks every move by quickValue, then plays the best few out to the end of the round and picks the best of those.
   *
   * @param {object} state  the AI snapshot
   * @param {number} seat   the seat moving
   * @param {object[]} moves  the legal moves
   * @param {() => number} rng  random numbers in [0, 1)
   * @returns {{ source: 'centre' | number, colour: number, line: number | 'floor' } | null} null when there is no move
   *
   * Side effects: none, apart from drawing from `rng`.
   */
  chooseMove(state, seat, moves, rng) {
    if (!moves.length) return null;
    // Cheap one-move ranking first; only the best CANDIDATES get the expensive play-outs.
    const ranked = moves.map((move) => ({ move, value: quickValue(state, seat, move, rng) })).sort((a, b) => b.value - a.value);
    const table = tileTable(state);
    let best = null;
    for (const { move, value } of ranked.slice(0, CANDIDATES)) {
      let total = 0;
      for (let k = 0; k < PLAYOUTS; k++) {
        const { mine, others } = playOut(state, seat, move, table, rng);
        total += mine - RIVAL_SHARE * others;
      }
      // The mean play-out value (own value minus a share of the rivals') plus a fifth of the one-move value as a tie-break.
      const score = total / PLAYOUTS + 0.2 * value;
      if (!best || score > best.score) best = { source: move.source, colour: move.colour, line: move.line, score };
    }
    return { source: best.source, colour: best.colour, line: best.line };
  },
  /**
   * Picks a column by the tile's score plus how much it advances the end-of-game bonuses.
   *
   * @param {object} state  the AI snapshot
   * @param {number} seat   the seat choosing
   * @param {{ row: number, colour: number, columns: number[] }} pending
   * @param {() => number} rng  random numbers in [0, 1)
   * @returns {number} the chosen column
   *
   * Side effects: none, apart from drawing from `rng`.
   */
  chooseColumn(state, seat, pending, rng) {
    // The tile score, plus the change in unearned-bonus potential: a column that builds towards a row, column or set wins.
    return chooseColumnBy(state, seat, pending, rng, (wall, col) => tileScore(wall, pending.row, col) + LONG_GAME * (potential(wall) - potential(state.walls[seat])));
  },
};
