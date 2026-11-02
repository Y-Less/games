// "Sharp": the strongest computer player.  It scores a position for every seat by prestige, discounts (the engine), the
// gems that will actually be spent, progress towards nobles and how close the best card is to being affordable.  For each
// legal move it plays the move on a copy of the table, lets every opponent reply with their own best move, and keeps the
// move that leaves it best placed against the strongest opponent.  That one look ahead is what makes it deny cards and
// nobles, give back the right tokens, and spend Gold well.  It also plays the end of the game exactly: once somebody
// reaches the target (or it could), it only counts who would win when the round is played out.
//
// It works on the plain situation described in lib.js, so it knows nothing about the draw piles.  When it buys or
// reserves a card in its imagination the gap on the table is left empty rather than guessed at.
//
// Depends on: ../cards.js (card and noble data) and ./lib.js (situation helpers).
import { CARD_BY_ID, LEVELS, NOBLE_BY_ID } from '../cards.js';
import { GOLD, MAX_TOKENS, nobleList, nobleGap, needOf, payment, sum } from './lib.js';

/**
 * How much each part of a position is worth, in roughly "points" (the unit that evalSeat adds up).
 * bonus: a discount is a permanent saving, so it is worth the most; token: a gem that a card on the table needs; gold: a
 * wild token, worth more than an ordinary gem; noble: scales progress towards a noble; ready: how close the best cards
 * are to being bought; rival: how much of the strongest opponent's score is subtracted from ours.
 * They are hand-set heuristic values, not derived from theory.
 */
const W = { bonus: 1.8, token: 0.2, gold: 0.5, noble: 1.0, ready: 0.3, rival: 0.75 };

/**
 * A copy of a situation player that can be changed safely (its token, bonus, and reserve lists are copied).
 *
 * Side effects: none.
 *
 * @param {object} p  a player of the situation
 * @returns {object}
 */
const clonePlayer = (p) => ({ ...p, tokens: [...p.tokens], bonuses: [...p.bonuses], reserved: [...p.reserved] });

/**
 * A copy of the situation in which any one seat can be changed (the rest is shared and never written to).
 *
 * Side effects: none.
 *
 * @param {object} s  the situation
 * @returns {object} a new situation; the players array is new but the players in it are the originals until replaced
 */
function fork(s) {
  return { ...s, supply: [...s.supply], board: { 1: [...s.board[1]], 2: [...s.board[2]], 3: [...s.board[3]] }, nobles: [...s.nobles], players: [...s.players] };
}

/**
 * The ids of every face-up card in a situation (empty slots left out).
 *
 * Side effects: none.
 *
 * @param {object} s  the situation
 * @returns {string[]} card ids, level 1 first
 */
const boardIds = (s) => LEVELS.flatMap((l) => s.board[l]).filter(Boolean);

/**
 * The default payment a player would make for a card (the shared calculation in rules.js, via lib.js).
 *
 * Side effects: none.
 *
 * @param {object} p     a situation player
 * @param {object} card
 * @returns {number[] | null} six counts, or null if the player cannot afford the card
 */
const payFor = (p, card) => payment(p, card)?.pay ?? null;

// ---- judging a position ----

/**
 * The facts about the whole game that colour how every seat is judged: how far the game has got and whether the leader
 * is close enough to the target for points to matter more.
 *
 * Side effects: none.
 *
 * @param {object} s  the situation
 * @returns {{ phase: number, pointWeight: number }} `phase` falls from 1 towards 0.25 as the leader nears the target
 */
function context(s) {
  const top = Math.max(...s.players.map((p) => p.prestige));
  return { phase: Math.max(0.25, 1 - top / s.target), pointWeight: 1 + (top >= s.target - 4 ? 0.5 : 0) };
}

/**
 * What a seat's position is worth, in roughly "points": prestige, the next cards it could buy, tokens that will be
 * spent, discounts, Gold, and progress towards nobles.
 *
 * Side effects: none.
 *
 * @param {object} s    the situation
 * @param {number} i    the seat being judged
 * @param {object} ctx  from context()
 * @returns {number}
 */
function evalSeat(s, i, ctx) {
  const p = s.players[i];
  const need = [0, 0, 0, 0, 0];
  let first = 0;
  let second = 0;
  /** Folds one card into the seat's colour needs and its two most ready-to-buy cards (updates need, first, and second). */
  const consider = (id) => {
    const card = CARD_BY_ID[id];
    const needed = needOf(card, p.bonuses);
    let missing = 0;
    for (let c = 0; c < 5; c++) {
      if (needed[c] > need[c]) need[c] = needed[c];
      missing += Math.max(0, needed[c] - p.tokens[c]);
    }
    const short = Math.max(0, missing - p.tokens[GOLD]);
    const ready = (card.points + 0.8) / (1 + short) ** 1.3;
    if (ready > first) [first, second] = [ready, first];
    else if (ready > second) second = ready;
  };
  for (const id of boardIds(s)) consider(id);
  for (const id of p.reserved) consider(id);
  // Prestige is the real score.  The best card counts fully and the runner-up at 0.4, because only one can be bought per turn.
  let value = p.prestige * ctx.pointWeight + (first + second * 0.4) * W.ready;
  for (let c = 0; c < 5; c++) {
    const have = p.tokens[c];
    const used = Math.min(have, need[c]);
    value += used * W.token + (have - used) * 0.05;
    const cards = p.bonuses[c];
    // Discounts: the first three of a colour are worth full price, the next two half, anything beyond five hardly anything
    // (no card costs more than seven), and all of it fades with `phase` because late on a discount has no time to pay back.
    value += (Math.min(cards, 3) * W.bonus + Math.min(Math.max(cards - 3, 0), 2) * W.bonus * 0.5 + Math.max(cards - 5, 0) * 0.2) * ctx.phase;
  }
  // More than three Gold is wasted: it is rarely needed in such amounts and it takes up room under the ten-token limit.
  value += Math.min(p.tokens[GOLD], 3) * W.gold;
  // Nobles: the nearest two, counted by how far along they are.
  const progress = nobleList(s)
    .map((noble) => {
      const total = sum(Object.values(noble.requires));
      const f = 1 - nobleGap(p.bonuses, noble) / total;
      // Squared so that a noble that is nearly complete counts for much more than one barely started (3 is its prize).
      return f * f * 3 * W.noble;
    })
    .sort((a, b) => b - a);
  value += (progress[0] ?? 0) + (progress[1] ?? 0) * 0.3;
  return value;
}

/**
 * My position against the strongest opponent (and, a little, the rest).
 *
 * Side effects: none.
 *
 * @param {object} s    the situation
 * @param {number} seat my seat
 * @param {object} ctx  from context()
 * @returns {number} higher is better for me
 */
function judge(s, seat, ctx) {
  const rivals = s.players.map((_, i) => i).filter((i) => i !== seat).map((i) => evalSeat(s, i, ctx));
  // The strongest opponent is the one that will beat us, so they count in full; the others only a quarter as much.
  const top = Math.max(...rivals);
  return evalSeat(s, seat, ctx) - W.rival * top - W.rival * 0.25 * (sum(rivals) - top);
}

// ---- imagining a move ----

/**
 * Makes a seat give back `count` tokens, one at a time, always the one whose loss hurts its position least.
 *
 * Side effects: mutates the seat's player in `s` (the caller must pass a forked copy) and puts the tokens in s.supply.
 *
 * @param {object} s      a forked situation
 * @param {number} i      the seat
 * @param {number} count  how many tokens to drop
 */
function dropTokens(s, i, count) {
  const ctx = context(s);
  const p = s.players[i];
  for (let k = 0; k < count; k++) {
    let best = -1;
    let bestValue = -Infinity;
    for (let c = 0; c < 6; c++) {
      if (p.tokens[c] < 1) continue;
      p.tokens[c]--;
      const value = evalSeat(s, i, ctx);
      p.tokens[c]++;
      if (value > bestValue) {
        best = c;
        bestValue = value;
      }
    }
    p.tokens[best]--;
    s.supply[best]++;
  }
}

/**
 * The table after a seat plays a move (tokens above the limit are given back in the best way, and a noble visits).
 * The situation passed in is left alone.
 *
 * Side effects: none.
 *
 * @param {object} s     the situation
 * @param {number} i     the seat playing
 * @param {object} move  a take, takeTwo, reserve, or buy move
 * @returns {object} a new situation
 */
function apply(s, i, move) {
  const t = fork(s);
  const p = (t.players[i] = clonePlayer(s.players[i]));
  if (move.type === 'take') {
    for (const c of move.colours) {
      p.tokens[c]++;
      t.supply[c]--;
    }
  } else if (move.type === 'takeTwo') {
    p.tokens[move.colour] += 2;
    t.supply[move.colour] -= 2;
  } else if (move.type === 'reserve') {
    if (move.card !== undefined) {
      for (const l of LEVELS) t.board[l] = t.board[l].map((id) => (id === move.card ? null : id));
      p.reserved.push(move.card);
    }
    p.reservedCount++;
    if (t.supply[GOLD] > 0) {
      t.supply[GOLD]--;
      p.tokens[GOLD]++;
    }
  } else if (move.type === 'buy') {
    const card = CARD_BY_ID[move.card];
    const pay = payFor(p, card);
    for (let c = 0; c < 6; c++) {
      p.tokens[c] -= pay[c];
      t.supply[c] += pay[c];
    }
    if (p.reserved.includes(move.card)) {
      p.reserved = p.reserved.filter((id) => id !== move.card);
      p.reservedCount--;
    } else for (const l of LEVELS) t.board[l] = t.board[l].map((id) => (id === move.card ? null : id));
    p.bonuses[card.bonus]++;
    p.prestige += card.points;
    p.bought++;
    const visiting = t.nobles.find((id) => nobleGap(p.bonuses, NOBLE_BY_ID[id]) === 0);
    if (visiting) {
      t.nobles = t.nobles.filter((id) => id !== visiting);
      p.prestige += NOBLE_BY_ID[visiting].points;
      p.nobles++;
    }
  }
  const over = sum(p.tokens) - MAX_TOKENS;
  if (over > 0) dropTokens(t, i, over);
  return t;
}

/**
 * The moves an opponent could plausibly make: every card they can buy and every way of taking gems.
 *
 * Side effects: none.
 *
 * @param {object} s  the situation
 * @param {number} i  the opponent's seat
 * @returns {object[]} moves (never reserves or passes)
 */
function replies(s, i) {
  const p = s.players[i];
  const moves = [];
  for (const id of [...boardIds(s), ...p.reserved]) if (payFor(p, CARD_BY_ID[id])) moves.push({ type: 'buy', card: id });
  const open = [0, 1, 2, 3, 4].filter((c) => s.supply[c] > 0);
  /** Every way of choosing k items from the list. */
  const combos = (list, k) => (k === 0 ? [[]] : list.flatMap((x, n) => combos(list.slice(n + 1), k - 1).map((rest) => [x, ...rest])));
  if (open.length >= 3) for (const colours of combos(open, 3)) moves.push({ type: 'take', colours });
  else for (let k = 1; k <= open.length; k++) for (const colours of combos(open, k)) moves.push({ type: 'take', colours });
  for (let c = 0; c < 5; c++) if (s.supply[c] >= 4) moves.push({ type: 'takeTwo', colour: c });
  return moves;
}

/**
 * What an opponent does in reply: whatever suits them best (and me least), or, in the last round, whatever scores most.
 *
 * Side effects: none.
 *
 * @param {object} s       the situation
 * @param {number} i       the replying opponent's seat
 * @param {number} seat    my seat
 * @param {boolean} ending true once the game is in its last round
 * @param {object} ctx     from context()
 * @returns {object} the situation after the reply (unchanged if they have no useful move)
 */
function reply(s, i, seat, ending, ctx) {
  let best = null;
  let bestValue = -Infinity;
  for (const move of replies(s, i)) {
    if (ending && move.type !== 'buy') continue;
    const after = apply(s, i, move);
    // In the last round only a purchase can change the score, and the game's own tie-break is fewest cards, so rank by prestige
    // then by fewest cards.  Otherwise assume a self-interested opponent who also (a little) spoils our position.
    const value = ending ? after.players[i].prestige * 1000 - after.players[i].bought : evalSeat(after, i, ctx) - 0.35 * evalSeat(after, seat, ctx);
    if (value > bestValue) {
      best = after;
      bestValue = value;
    }
  }
  if (ending && best && best.players[i].prestige <= s.players[i].prestige) return s;
  return best ?? s;
}

/**
 * Once the final round is under way: win or lose, and by how much.
 *
 * Side effects: none.
 *
 * @param {object} s    the situation
 * @param {number} seat my seat
 * @returns {number} about +60 for a win and -60 for a loss, nudged by the margin
 */
function outcome(s, seat) {
  const key = (p) => p.prestige * 1000 - p.bought;
  const mine = key(s.players[seat]);
  const rival = Math.max(...s.players.filter((_, i) => i !== seat).map(key));
  const margin = (mine - rival) / 1000;
  return (margin > 0 ? 60 : -60) + margin * 6;
}

/**
 * Chooses a move by playing each legal move on a copy of the table, letting every opponent reply, and keeping the move
 * that leaves this seat best placed.
 *
 * Side effects: advances `rng` (one draw per move scored); changes nothing else.
 *
 * @param {object} s     the situation
 * @param {() => number} rng  breaks near-ties
 * @returns {object} one of s.moves, or { type: 'pass' } if there are none
 */
function chooseMove(s, rng) {
  if (!s.moves.length) return { type: 'pass' };
  const ctx = context(s);
  let best = null;
  let bestValue = -Infinity;
  for (const move of s.moves) {
    let t = apply(s, s.seat, move);
    const ending = t.finalRound || t.players[s.seat].prestige >= s.target;
    // Players still to move this round, then (unless the game is about to end) the ones who have already gone.
    const order = [];
    for (let i = s.seat + 1; i < s.n; i++) order.push(i);
    if (!ending) for (let i = 0; i < s.seat; i++) order.push(i);
    for (const i of order) t = reply(t, i, s.seat, ending, ctx);
    // The tiny random term only decides between moves that are otherwise exactly equal.
    const value = (ending ? outcome(t, s.seat) : judge(t, s.seat, ctx)) + rng() * 0.02;
    if (value > bestValue) {
      best = move;
      bestValue = value;
    }
  }
  return best;
}

export default {
  id: 'sharp',
  name: 'Sharp',
  description: 'The strongest: weighs prestige, discounts, gems and nobles, looks one move ahead at what each opponent could do, and plays the end of the game carefully.',
  weight: 3,
  chooseMove,
  /**
   * Which tokens to give back: the ones whose loss costs the position least.
   *
   * Side effects: none.
   *
   * @param {object} s  the situation (uses returnCount)
   * @returns {number[]} six counts
   */
  chooseReturn(s) {
    const t = fork(s);
    const p = (t.players[s.seat] = clonePlayer(s.players[s.seat]));
    const before = [...p.tokens];
    dropTokens(t, s.seat, s.returnCount);
    return before.map((n, c) => n - p.tokens[c]);
  },
  /**
   * When several nobles visit at once: take the one an opponent is closest to getting.
   *
   * Side effects: none.
   *
   * @param {object} s  the situation (uses options)
   * @returns {string} a noble id from s.options
   */
  chooseNoble(s) {
    /** How close the best-placed opponent is to this noble, from 0 to 1 (1 means they would already qualify). */
    const closeness = (id) => Math.max(0, ...s.players.filter((p) => p.seat !== s.seat).map((p) => 1 - nobleGap(p.bonuses, NOBLE_BY_ID[id]) / sum(Object.values(NOBLE_BY_ID[id].requires))));
    return [...s.options].sort((a, b) => closeness(b) - closeness(a))[0];
  },
};
