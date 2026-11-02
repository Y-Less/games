// 'Sharp': the strongest Hearts AI.  It counts cards, infers each opponent's void suits from failures to follow, and then
// decides by looking ahead: it deals the unseen cards to the other seats in many plausible ways (respecting known voids
// and the cards it passed), plays each candidate card out to the end of the hand against a sensible opponent model, and
// picks the card with the fewest expected penalty points.  That one mechanism gives it safe leads, Queen of Spades
// management, dumping penalty cards on whoever is going to win the trick (and so the Queen on the leader of a trick) and
// the timing of when to win or duck, without any of it being hard-coded.  On top of that it has explicit rules for the moon:
//  - the seats that have taken points are tracked; while exactly one other seat owns every point so far it is a moon
//    risk, so Sharp does not hand that seat more penalty cards (it keeps its high hearts and the Queen back), and in its
//    look-ahead that seat is assumed to be chasing, which makes taking a point trick itself (becoming the second owner)
//    the move that wins when a moon is near;
//  - once two seats have points a moon is impossible and the look-ahead dumps high hearts and the Queen freely;
//  - with an overwhelming hand it goes for the moon itself, using the Moon AI's play for as long as that is alive.
// Passing tries every set of three cards against a hand-risk estimate (uncovered Queen, high spades, high hearts, short suits).
import { rankValue, suitOf } from '../../../shared/cards.js';
import { JACK, QUEEN, SUIT_LIST, bySuit, isHeart, isPointCard, observe, passSize, pointTakers, seatsIn, tricksIn } from './util.js';
import { HAND_POINTS, offsetOfDirection, openingCard } from '../deals.js';
import standard, { wantsMoon } from './standard.js';
import moon, { moonAlive } from './moon.js';

/** Numbers behind Sharp's judgement (hand-risk weights for passing and the sample count), kept together so they can be tuned against tournament results. */
export const TUNING = {
  samples: 16, // how many deals of the hidden cards each decision looks ahead through
  relative: 0, // weight of the points other seats score (a small positive favours dumping on others)
  queenHold: 8,
  queenCovered: 3,
  spadeHigh: 2.8,
  spadeHighCovered: 1.2,
  heartBase: 1,
  heartRank: 2.2,
  otherRank: 3,
  jackHold: 2.5,
  voidZero: 0.6,
  voidOne: 0.25,
  voidTwo: 0.1,
};

// ---- passing ----

/**
 * Estimates how many penalty points a hand is likely to cost, so passing can pick the three cards whose removal helps most.
 * Uncovered Queens, high spades, and high hearts add risk; short suits subtract it because a void lets the hand dump.
 * @param {string[]} hand  the cards that would be kept after passing.
 * @param {object} settings  game settings; jackOfDiamonds makes the Jack reduce risk.
 * @returns {number} a relative risk score (lower is better, not a literal point count).
 * Side effects: none.
 */
function handRisk(hand, settings) {
  const spadesLow = hand.filter((c) => suitOf(c) === 'S' && rankValue(c) < 12).length;
  const hasQueen = hand.includes(QUEEN);
  let risk = 0;
  for (const card of hand) {
    const rank = rankValue(card);
    if (card === QUEEN) risk += spadesLow >= 4 ? TUNING.queenCovered : TUNING.queenHold;
    else if (suitOf(card) === 'S' && rank >= 13) risk += hasQueen ? 0.8 : spadesLow >= 4 ? TUNING.spadeHighCovered : TUNING.spadeHigh;
    else if (isHeart(card)) risk += TUNING.heartBase + (TUNING.heartRank * (rank - 2)) / 12;
    else if (card === JACK && settings.jackOfDiamonds) risk -= TUNING.jackHold;
    else risk += (TUNING.otherRank * (rank - 2)) / 12;
  }
  for (const suit of SUIT_LIST) {
    const n = bySuit(hand, suit).length;
    risk -= n === 0 ? TUNING.voidZero : n === 1 ? TUNING.voidOne : n === 2 ? TUNING.voidTwo : 0;
  }
  return risk;
}

/**
 * Every way to choose `size` cards from a hand (in hand order), as a generator.
 * @param {string[]} hand  cards to choose from.
 * @param {number} size  how many to choose.
 * @param {number} [from]  recursion: first index still available.
 * @param {string[]} [chosen]  recursion: the cards chosen so far.
 * @yields {string[]} one combination of `size` cards.
 * Side effects: none.
 */
function* choices(hand, size, from = 0, chosen = []) {
  if (chosen.length === size) {
    yield chosen;
    return;
  }
  for (let i = from; i <= hand.length - (size - chosen.length); i++) yield* choices(hand, size, i + 1, [...chosen, hand[i]]);
}

/**
 * Sharp's pass: the moon AI's pass with an overwhelming hand, otherwise the choice of cards whose removal leaves the
 * lowest handRisk.
 * @param {object} ctx  AI context (see index.js); uses hand, settings, and passCount.
 * @returns {string[]} the cards to pass.
 * Side effects: none.
 */
function passSharp(ctx) {
  const { hand, settings } = ctx;
  const size = passSize(ctx);
  if (wantsMoon(hand)) return moon.choosePass(ctx);
  let best = null;
  let bestRisk = Infinity;
  for (const out of choices(hand, size)) {
    const risk = handRisk(hand.filter((c) => !out.includes(c)), settings);
    if (risk < bestRisk - 1e-9) {
      bestRisk = risk;
      best = out;
    }
  }
  return best;
}

// ---- look-ahead ----

const RANK = new Map();
// Memoised rankValue: the look-ahead calls it millions of times, so the lookup is cached per card.
const rv = (card) => {
  let r = RANK.get(card);
  if (r === undefined) RANK.set(card, (r = rankValue(card)));
  return r;
};
// The suit letter of a card code (last character); cheaper than suitOf inside the hot look-ahead loop.
const suit = (card) => card[card.length - 1];

/**
 * The cards a seat may play now, by the rules of the game (opening card, hearts not broken, follow suit, no points on trick one).
 * @param {object} sim  look-ahead state; `sim.tricks` is the number of finished tricks.
 * @param {number} seat  the seat to ask about.
 * @returns {string[]} the legal cards (the seat's hand, or a subset).
 * Side effects: none.
 */
function legalIn(sim, seat) {
  const hand = sim.hands[seat];
  if (!sim.trick.length) {
    if (sim.tricks === 0 && hand.includes(sim.opening)) return [sim.opening];
    if (!sim.broken) {
      const open = hand.filter((c) => suit(c) !== 'H');
      if (open.length) return open;
    }
    return hand;
  }
  const led = suit(sim.trick[0].card);
  const follow = hand.filter((c) => suit(c) === led);
  if (follow.length) return follow;
  if (sim.tricks === 0) {
    const clean = hand.filter((c) => !isPointCard(c));
    if (clean.length) return clean;
  }
  return hand;
}

// Lowest-ranked card of a non-empty list (uses the memoised rank).
const lowestOf = (cards) => cards.reduce((a, b) => (rv(b) < rv(a) ? b : a));
// Highest-ranked card of a non-empty list (uses the memoised rank).
const highestOf = (cards) => cards.reduce((a, b) => (rv(b) > rv(a) ? b : a));
// Drops the cards matching `bad`, unless that would leave nothing.
const without = (cards, bad) => {
  const kept = cards.filter((c) => !bad(c));
  return kept.length ? kept : cards;
};

/**
 * The opponent model for look-ahead: the standard AI's rules (deterministic), or a moon chaser's for a suspected shooter.
 * It is deterministic so each simulated world gives a repeatable outcome per candidate card.
 * @param {object} sim  look-ahead state.
 * @param {number} seat  the seat choosing.
 * @param {string[]} legal  that seat's legal cards.
 * @returns {string} the card the model says the seat plays.
 * Side effects: none.
 */
function modelPlay(sim, seat, legal) {
  if (legal.length === 1) return legal[0];
  const hand = sim.hands[seat];
  const chasing = sim.chaser === seat;
  const jackOn = sim.jack;
  const notJack = (cards) => (jackOn ? without(cards, (c) => c === JACK) : cards);
  if (!sim.trick.length) {
    if (chasing) return highestOf(without(legal, (c) => suit(c) === 'H'));
    const lowSpades = legal.filter((c) => suit(c) === 'S' && rv(c) < 12);
    if (lowSpades.length && !hand.includes(QUEEN) && !sim.queenGone) return lowestOf(lowSpades);
    let options = notJack(legal);
    if (hand.includes(QUEEN)) options = without(options, (c) => suit(c) === 'S');
    options = without(options, (c) => suit(c) === 'H');
    return lowestOf(options);
  }
  const led = suit(sim.trick[0].card);
  const following = legal.filter((c) => suit(c) === led);
  if (following.length) {
    let best = 0;
    for (const p of sim.trick) if (suit(p.card) === led && rv(p.card) > best) best = rv(p.card);
    const last = sim.trick.length === sim.n - 1;
    const winning = following.filter((c) => rv(c) > best);
    const ducking = following.filter((c) => rv(c) < best);
    if (chasing) return winning.length ? highestOf(winning) : lowestOf(following);
    if (jackOn && led === 'D' && sim.trick.some((p) => p.card === JACK) && !sim.trick.some((p) => isPointCard(p.card)) && winning.length) {
      return last ? lowestOf(winning) : highestOf(winning);
    }
    if (ducking.length) return highestOf(notJack(ducking));
    return last ? highestOf(without(following, (c) => c === QUEEN)) : lowestOf(without(following, (c) => c === QUEEN));
  }
  const queenGone = sim.queenGone || hand.includes(QUEEN);
  let bestCard = legal[0];
  let bestWorry = -Infinity;
  for (const card of legal) {
    const rank = rv(card);
    let worry;
    if (chasing) worry = -rank - (isPointCard(card) ? 100 : 0);
    else if (card === QUEEN) worry = 1000;
    else if (jackOn && card === JACK) worry = -1000;
    else if (suit(card) === 'S' && rank >= 13 && !queenGone) worry = 700 + rank;
    else if (suit(card) === 'H') worry = 500 + rank * 10;
    else worry = rank * 10;
    if (worry > bestWorry) {
      bestWorry = worry;
      bestCard = card;
    }
  }
  return bestCard;
}

/**
 * Applies a play to the simulated hand: removes it from the seat's hand, adds it to the trick, and updates the flags.
 * @param {object} sim  look-ahead state (hands, trick, broken, queenGone...).
 * @param {number} seat  the seat playing.
 * @param {string} card  the card played.
 * @returns {void}
 * Side effects: mutates sim (hands, trick, broken, queenGone).
 */
function playCardIn(sim, seat, card) {
  const hand = sim.hands[seat];
  hand.splice(hand.indexOf(card), 1);
  sim.trick.push({ seat, card });
  if (suit(card) === 'H' || card === QUEEN) sim.broken = true;
  if (card === QUEEN) sim.queenGone = true;
}

/**
 * Resolves the full trick in the simulation: finds the winner and credits them with the hearts, Queen, and Jack in it.
 * @param {object} sim  look-ahead state.
 * @returns {void}
 * Side effects: mutates sim (hearts, queen, jackTaker, trick, tricks, turn).
 */
function finishTrick(sim) {
  const led = suit(sim.trick[0].card);
  let win = sim.trick[0];
  for (const p of sim.trick) if (suit(p.card) === led && rv(p.card) > rv(win.card)) win = p;
  for (const { card } of sim.trick) {
    if (suit(card) === 'H') sim.hearts[win.seat]++;
    else if (card === QUEEN) sim.queen = win.seat;
    else if (card === JACK) sim.jackTaker = win.seat;
  }
  sim.trick = [];
  sim.tricks++;
  sim.turn = win.seat;
}

/**
 * Plays the hand out from the current position (the card in `sim.trick` so far) and returns each seat's points.
 * Shooting the moon is scored per the room's `moon` setting, and the Jack of Diamonds counts as -jackValue.
 * @param {object} sim  look-ahead state.
 * @param {object} settings  game settings (moon, jackOfDiamonds).
 * @param {number} jackValue  how many points the Jack is worth to its taker.
 * @returns {number[]} points per seat.
 * Side effects: mutates sim (plays every remaining card).
 */
function playOut(sim, settings, jackValue) {
  while (sim.tricks < sim.total) {
    if (sim.trick.length === sim.n) {
      finishTrick(sim);
      continue;
    }
    const seat = sim.turn;
    playCardIn(sim, seat, modelPlay(sim, seat, legalIn(sim, seat)));
    sim.turn = (seat + 1) % sim.n;
  }
  const shooter = sim.hearts.findIndex((h, s) => h === 13 && sim.queen === s);
  return sim.hearts.map((h, s) => {
    let points;
    if (shooter !== -1) points = settings.moon === 'self' ? (s === shooter ? -HAND_POINTS : 0) : s === shooter ? 0 : HAND_POINTS;
    else points = h + (sim.queen === s ? 13 : 0);
    return points + (settings.jackOfDiamonds && sim.jackTaker === s ? -jackValue : 0);
  });
}

/**
 * Deals the unseen cards to the other seats: known voids are respected and the cards this seat passed go to their receiver.
 * @param {object} ctx  AI context (see index.js).
 * @param {object} know  card-counting result from observe(ctx).
 * @param {() => number} rng  random source in [0, 1).
 * @returns {string[][]|null} a hand per seat (this seat's left empty), or null if no consistent deal was found.
 * Side effects: advances rng.
 */
function sampleWorld(ctx, know, rng) {
  const { seat } = ctx;
  const n = seatsIn(ctx);
  const others = Array.from({ length: n }, (_, t) => t).filter((t) => t !== seat);
  const unseen = [...know.unseen];
  // Where this seat's passed cards went (the receiver is known to hold them, which sharpens the sampled worlds).
  const shift = ctx.passOffset ?? offsetOfDirection(n, ctx.direction);
  const receiver = shift ? (seat + shift) % n : -1;
  for (let attempt = 0; attempt < 30; attempt++) {
    const hands = Array.from({ length: n }, () => []);
    const room = Array(n).fill(0);
    for (const t of others) room[t] = know.sizes[t];
    const free = [];
    for (const card of unseen) {
      if (receiver !== -1 && (ctx.passed ?? []).includes(card) && room[receiver] > 0 && !know.voids[receiver].has(suit(card))) {
        hands[receiver].push(card);
        room[receiver]--;
      } else free.push(card);
    }
    // Early attempts respect every known void; the last few relax that so a contradictory belief cannot stall the deal.
    const strict = attempt < 25;
    // The seats that may legally hold this card given what is known of their voids.
    const eligible = (card) => others.filter((t) => !(strict && know.voids[t].has(suit(card))));
    free.sort((a, b) => eligible(a).length - eligible(b).length || rng() - 0.5);
    let stuck = false;
    for (const card of free) {
      const seats = eligible(card).filter((t) => room[t] > 0);
      if (!seats.length) {
        stuck = true;
        break;
      }
      let roll = rng() * seats.reduce((n, t) => n + room[t], 0);
      let pick = seats[seats.length - 1];
      for (const t of seats) {
        roll -= room[t];
        if (roll < 0) {
          pick = t;
          break;
        }
      }
      hands[pick].push(card);
      room[pick]--;
    }
    if (!stuck) return hands;
  }
  return null;
}

/**
 * Cards that play identically: neighbours in a suit with no unseen card between them.  Keeps the lowest of each run, so
 * the look-ahead does not waste samples on equivalent candidates.
 * @param {string[]} cards  candidate cards.
 * @param {object} know  card-counting result from observe(ctx).
 * @returns {string[]} the candidates with equivalents removed.
 * Side effects: none.
 */
function distinct(cards, know) {
  const out = [];
  for (const card of cards) {
    const twin = out.findIndex((other) => {
      if (suit(other) !== suit(card)) return false;
      const lo = Math.min(rv(other), rv(card));
      const hi = Math.max(rv(other), rv(card));
      return ![...know.unseen].some((u) => suit(u) === suit(card) && rv(u) > lo && rv(u) < hi);
    });
    if (twin === -1) out.push(card);
    else if (rv(card) < rv(out[twin])) out[twin] = card;
  }
  return out;
}

/**
 * Sharp's play: legal singleton, the Moon AI's play while this seat's own moon bid is alive, otherwise look-ahead.
 * @param {object} ctx  AI context (see index.js).
 * @returns {string} one card from ctx.legal.
 * Side effects: advances ctx.rng (through the look-ahead sampling).
 */
function playSharp(ctx) {
  if (ctx.legal.length === 1) return ctx.legal[0];
  if (ctx.chasingMoon && moonAlive(ctx)) return moon.choosePlay(ctx);
  return lookAhead(ctx);
}

/**
 * Chooses a card by looking ahead (see the top of this file). `jackValue` is how many points the Jack of Diamonds is
 * worth to whoever takes it when that option is on: 5 in the rules, more for an AI that wants it badly.
 * @param {object} ctx  AI context (see index.js).
 * @param {{jackValue?: number}} [options]  jackValue override.
 * @returns {string} the candidate card with the lowest expected penalty over the sampled worlds.
 * Side effects: advances ctx.rng.
 */
export function lookAhead(ctx, { jackValue = 5 } = {}) {
  const { legal, seat, settings } = ctx;
  const n = seatsIn(ctx);
  const know = observe(ctx);
  const rng = ctx.rng;

  // Moon watch: who owns every point so far?
  const takers = pointTakers(ctx);
  const lone = takers.size === 1 && !takers.has(seat) ? [...takers][0] : -1;
  const chaser = lone !== -1 && ctx.taken[lone].filter(isHeart).length >= 3 ? lone : -1;
  let candidates = legal;
  if (lone !== -1 && ctx.trick.length) {
    // Do not feed a lone point owner who is winning this trick while there is another card to play.
    const led = suit(ctx.trick[0].card);
    const winning = ctx.trick.reduce((b, p) => (suit(p.card) === led && rv(p.card) > rv(b.card) ? p : b), ctx.trick[0]);
    const cannotFollow = !legal.some((c) => suit(c) === led);
    if (cannotFollow && winning.seat === lone) {
      const clean = legal.filter((c) => !isPointCard(c));
      if (clean.length) candidates = clean;
    }
  }
  candidates = distinct(candidates, know);
  if (candidates.length === 1) return candidates[0];

  const worlds = [];
  for (let i = 0; i < TUNING.samples; i++) {
    const world = sampleWorld(ctx, know, rng);
    if (world) worlds.push(world);
  }
  if (!worlds.length) return standard.choosePlay(ctx);

  let best = candidates[0];
  let bestValue = Infinity;
  for (const card of candidates) {
    let total = 0;
    for (const world of worlds) {
      const hands = world.map((h) => [...h]);
      hands[seat] = ctx.hand.filter((c) => c !== card);
      const sim = {
        hands,
        trick: ctx.trick.map((p) => ({ ...p })),
        tricks: ctx.tricksPlayed,
        broken: ctx.heartsBroken || isHeart(card) || card === QUEEN,
        hearts: ctx.taken.map((cards) => cards.filter(isHeart).length),
        queen: ctx.taken.findIndex((cards) => cards.includes(QUEEN)),
        jackTaker: ctx.taken.findIndex((cards) => cards.includes(JACK)),
        queenGone: know.played.has(QUEEN) || card === QUEEN,
        jack: Boolean(settings.jackOfDiamonds),
        chaser,
        turn: (seat + 1) % n,
        n,
        total: tricksIn(ctx),
        opening: openingCard(n),
      };
      sim.trick.push({ seat, card });
      const points = playOut(sim, settings, jackValue);
      total += points[seat] - (TUNING.relative * points.reduce((a, b, s) => a + (s === seat ? 0 : b), 0)) / (n - 1);
    }
    const value = total / worlds.length;
    if (value < bestValue - 1e-9 || (Math.abs(value - bestValue) <= 1e-9 && rv(card) > rv(best))) {
      bestValue = value;
      best = card;
    }
  }
  return best;
}

export default {
  id: 'sharp',
  name: 'Sharp',
  description: 'Counts cards, tracks who is out of which suit and looks ahead: safe leads, Queen management, dumping on the likely winner, stopping moon attempts.',
  weight: 3,
  // Moon bidding is the standard AI's: only with an overwhelming hand.
  bidsMoon: (ctx) => standard.bidsMoon(ctx),
  choosePass: passSharp,
  choosePlay: playSharp,
};
