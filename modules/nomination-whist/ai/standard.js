// The original computer player's judgement for Nomination Whist: plain functions of what a player may know, with no room or
// sockets. game.js decides what is legal; everything here picks from a list it is given, so it can never cheat.
import { isJoker, rankValue, suitOf, SUITS } from '../../../shared/cards.js';
import { highest, isMaster, lowest, nearestAllowed, winningCard } from './cards.js';
import { lastChanceBoost } from './endgame.js';

const TRUMP_VALUE = { 14: 0.95, 13: 0.8, 12: 0.62, 11: 0.48, 10: 0.36, 9: 0.26 };
const SIDE_ACE = { trumps: 0.72, none: 0.9 };
/** A Joker wins whenever it is led or played on a suit it cannot follow, unless the other Joker is in the same trick. */
export const JOKER_VALUE = 0.85;

/** More players means fewer sure tricks: somebody is more likely to be void and to ruff. */
const crowding = (players) => Math.max(0.55, 1 - 0.07 * (players - 3));

/** How many tricks a hand is likely to win: high trumps, aces and kings elsewhere, and short suits to ruff with. */
export function estimateTricks(hand, trump, players, boost = 0) {
  const trumps = trump ? hand.filter((c) => suitOf(c) === trump) : [];
  let total = trumps.reduce((sum, c) => sum + (TRUMP_VALUE[rankValue(c)] ?? 0.14), 0);
  const aceValue = trump ? SIDE_ACE.trumps : SIDE_ACE.none;
  let ruffs = 0;
  for (const suit of SUITS) {
    if (suit === trump) continue;
    const ranks = hand.filter((c) => suitOf(c) === suit).map(rankValue);
    const has = (rank) => ranks.includes(rank);
    let side = 0;
    if (has(14)) side += aceValue;
    if (has(13)) side += ranks.length >= 2 ? (has(14) ? 0.55 : 0.4) : 0.2;
    if (has(12) && ranks.length >= 3 && (has(13) || has(14))) side += 0.25;
    if (!trump && has(11) && ranks.length >= 3 && has(12)) side += 0.2;
    total += side * crowding(players);
    if (hand.length >= 3) ruffs += ranks.length === 0 ? 1 : ranks.length === 1 ? 0.5 : 0;
  }
  if (trump) {
    const low = trumps.filter((c) => rankValue(c) < 10).length;
    total += Math.min(low, ruffs) * 0.55;
  }
  total += hand.filter(isJoker).length * JOKER_VALUE;
  total += hand.length * boost; // every card's weight turned up (see endgame.js)
  return Math.min(total, hand.length);
}

/**
 * Whether a 7-card hand is realistically capable of taking every trick: a run of the top trumps from the ace down
 * (six of them, or five when every other card is a trump or an ace). The estimate above is too cautious to say this.
 */
export function canTakeAllSeven(hand, trump) {
  if (!trump || hand.length !== 7) return false;
  const trumps = new Set(hand.filter((c) => suitOf(c) === trump).map(rankValue));
  let run = 0;
  while (trumps.has(14 - run)) run++;
  if (run >= 6) return true;
  return run >= 5 && hand.every((c) => suitOf(c) === trump || rankValue(c) === 14);
}

/**
 * The nomination a computer player makes: its estimate, or the nearest number it is allowed. When `instantWin` is true
 * (the round can be won outright by taking all 7 tricks), a hand that can realistically do so nominates 7.
 */
export function chooseNomination(ctx) {
  const { hand, trump, players, allowed, instantWin = false, rng = Math.random } = ctx;
  const goForIt = instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump);
  const estimate = goForIt ? 7 : estimateTricks(hand, trump, players, lastChanceBoost(ctx)) + (rng() - 0.5) * 0.3;
  return nearestAllowed(allowed, estimate);
}

/**
 * The card a computer player plays. `legal` is what it may play, `trick` the cards on the table so far (in order),
 * `played` every card seen this round, `need` how many more tricks it nominated than it has won. While it needs
 * tricks it wins them (sure winners first, the cheapest card that beats the table otherwise); once it has enough
 * it ducks, and sheds its most dangerous cards when it cannot follow suit.
 */
export function chooseCard({ hand, legal, trick, trump, played, need, players, jokers = false }) {
  if (legal.length === 1) return legal[0];
  const wantWin = need > 0;
  const cardsLeft = hand.length;

  if (trick.length === 0) {
    if (!wantWin) return lowest(legal, trump);
    const masters = legal.filter((c) => isMaster(c, hand, played, jokers));
    const trumpMasters = masters.filter((c) => suitOf(c) === trump);
    if (trumpMasters.length) return highest(trumpMasters, trump);
    if (masters.length) return highest(masters, trump);
    if (need >= cardsLeft) return highest(legal, trump);
    const side = legal.filter((c) => suitOf(c) !== trump);
    return highest(side.length ? side : legal, trump);
  }

  const winners = legal.filter((c) => winningCard([...trick, c], trump) === c);
  const losers = legal.filter((c) => !winners.includes(c));
  const last = trick.length === players - 1;

  if (wantWin) {
    if (!winners.length) return lowest(legal, trump);
    if (last) return lowest(winners, trump);
    const masters = winners.filter((c) => isMaster(c, hand, played, jokers));
    if (masters.length) return lowest(masters, trump);
    const following = winners.filter((c) => suitOf(c) === suitOf(trick[0]));
    return following.length ? highest(following, trump) : lowest(winners, trump);
  }
  return losers.length ? highest(losers, trump) : lowest(winners, trump);
}

export { winningCard };

export const standard = {
  id: 'standard',
  name: 'Standard',
  description: 'Nominates from a rule-of-thumb count of its likely tricks, then plays to hit its number exactly.',
  weight: 3,
  nominate: (ctx) => chooseNomination(ctx),
  play: (ctx) => chooseCard(ctx),
};
