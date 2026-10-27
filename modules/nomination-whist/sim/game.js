// Plays whole games of Nomination Whist (all the rounds, with scores) for the tournament runner and for AIs that need to
// know the state of the table. It follows the rules in ../rules.md through the live game's own helpers (schedule, trump
// order, scoring, the dealer's forbidden number, trick winner), and gives the AIs the same contexts as game.js does,
// plus the score situation: `scores` (everybody's total before this round), `round` (0-based) and `rounds` (in the game).
import { shuffle, sortHand, suitOf, fullDeck } from '../../../shared/cards.js';
import { AIS } from '../ai/index.js';
import { FULL_SCHEDULE, INSTANT_WIN_TRICKS, SHORT_SCHEDULE, forbiddenNomination, scoreRound, trickWinner, trumpOf, winnersOf } from '../game.js';

/** Whether a round can end the game on the spot (the same rule as isInstantWinRound in ../game.js): a 7-card first or last round. */
export const isInstantWinRound = (schedule, round) => schedule[round] === INSTANT_WIN_TRICKS && (round === 0 || round === schedule.length - 1);

const standard = AIS.find((ai) => ai.id === 'standard');
const DECK = fullDeck();

const legalOf = (hand, trick) => {
  if (!trick.length) return hand;
  const led = suitOf(trick[0].card);
  const follow = hand.filter((card) => suitOf(card) === led);
  return follow.length ? follow : hand;
};

/**
 * Plays one round. `observe`, when given, is called as `observe({ type: 'nominate' | 'play' | 'trick', ... })` for
 * every decision, so callers can collect whatever they like without this file knowing about it.
 * @returns {{ nominations: number[], taken: number[], hands: string[][] }} `hands` are as dealt
 */
export function playRound({ ais, cards, trump, dealer, scores, round, rounds, settings, instantWin = false }, rng, observe = null) {
  const players = ais.length;
  const deck = shuffle(DECK, rng);
  const hands = Array.from({ length: players }, (_, seat) => sortHand(deck.slice(seat * cards, (seat + 1) * cards)));
  const dealt = hands.map((hand) => [...hand]);
  const shared = { trump, players, dealer, cards, scores: [...scores], round, rounds, instantWin, missPoints: settings.missPoints, rng };

  const nominations = Array(players).fill(null);
  for (let i = 1; i <= players; i++) {
    const seat = (dealer + i) % players;
    const forbidden = seat === dealer ? forbiddenNomination(cards, nominations.reduce((sum, bid, s) => sum + (s === dealer ? 0 : bid ?? 0), 0)) : null;
    const allowed = Array.from({ length: cards + 1 }, (_, n) => n).filter((n) => n !== forbidden);
    const context = { ...shared, hand: hands[seat], allowed, seat, nominations: [...nominations] };
    const number = ais[seat].nominate(context);
    nominations[seat] = allowed.includes(number) ? number : standard.nominate(context);
    observe?.({ type: 'nominate', seat, nomination: nominations[seat], context });
  }

  const taken = Array(players).fill(0);
  const played = [];
  let leader = (dealer + 1) % players;
  for (let t = 0; t < cards; t++) {
    const trick = [];
    for (let k = 0; k < players; k++) {
      const seat = (leader + k) % players;
      const hand = hands[seat];
      const legal = legalOf(hand, trick);
      const context = {
        ...shared,
        hand,
        legal,
        trick: trick.map((p) => p.card),
        trickPlays: trick.map((p) => ({ ...p })),
        played: [...played],
        need: nominations[seat] - taken[seat],
        seat,
        nominations: [...nominations],
        taken: [...taken],
        handSizes: hands.map((h) => h.length),
      };
      let card = ais[seat].play(context);
      if (!legal.includes(card)) card = standard.play(context);
      observe?.({ type: 'play', seat, card, context });
      hands[seat] = hand.filter((c) => c !== card);
      trick.push({ seat, card });
      played.push(card);
    }
    const winner = trickWinner(trick, trump);
    taken[winner]++;
    observe?.({ type: 'trick', winner, trick });
    leader = winner;
  }
  return { nominations, taken, hands: dealt };
}

/**
 * Plays a whole game and returns its record.
 * With `instantWin` on, a player who nominates 7 and wins all 7 tricks in a 7-card first or last round wins the game on
 * the spot (`instantWin` in the result is that seat, otherwise null); the scores are those at that moment.
 * @param {{ ais: object[], firstDealer?: number, schedule?: number[], missPoints?: boolean, instantWin?: boolean }} game  one AI per seat
 * @returns {{ scores: number[], winners: number[], instantWin: number | null, rounds: object[] }}
 */
export function playGame({ ais, firstDealer = 0, schedule = FULL_SCHEDULE, missPoints = true, instantWin = true }, rng, observe = null) {
  const players = ais.length;
  const settings = { missPoints };
  const scores = Array(players).fill(0);
  const rounds = [];
  let instantWinner = null;
  for (let round = 0; round < schedule.length && instantWinner === null; round++) {
    const cards = schedule[round];
    const trump = trumpOf(round);
    const dealer = (firstDealer + round) % players;
    const result = playRound({ ais, cards, trump, dealer, scores, round, rounds: schedule.length, settings, instantWin: instantWin && isInstantWinRound(schedule, round) }, rng, observe);
    const points = result.nominations.map((bid, seat) => scoreRound(bid, result.taken[seat], settings));
    points.forEach((p, seat) => (scores[seat] += p));
    rounds.push({ cards, trump, dealer, ...result, points });
    if (instantWin && isInstantWinRound(schedule, round)) {
      const seat = result.nominations.findIndex((bid, s) => bid === INSTANT_WIN_TRICKS && result.taken[s] === INSTANT_WIN_TRICKS);
      if (seat !== -1) instantWinner = seat;
    }
  }
  return { scores, winners: instantWinner === null ? winnersOf(scores) : [instantWinner], instantWin: instantWinner, rounds };
}

export { FULL_SCHEDULE, SHORT_SCHEDULE };
