// Two ways of playing Splendour, for the simulations in this folder (not part of the game).
//
// Both use exactly the same gem-taking, reserving, token-returning and noble-choosing code, so that they differ only in the
// one thing being tested: which cards they spend their purchases on.
//
// Both only aim at cards they could really pay for: the cost after discounts has to fit inside the ten tokens a player may
// hold and inside what the table can supply of each colour (otherwise they would chase an out-of-reach card for ever). And
// both stay with the card they are working towards until it is bought or taken, unless another becomes much better.
//
//   engine(size)   BUILDS first. Until it has bought `size` cards it values every card as a piece of an engine: the cheapest
//                  ones, in the colours that discount the cards it will want later, and it takes gems to afford them. Once it has
//                  `size` cards it switches to buying points.
//   rush(points)   never builds. It only buys cards worth at least `points` prestige, from the first turn, and takes gems for
//                  the card with the most points for the gems it is short of.
//
// "Buying points" is the same for both: the card with the most prestige, cheapest to reach, as soon as it can be paid for.
import { CARD_BY_ID, GOLD } from '../cards.js';
import { boardCards, me, nobleList, overflowOf, payment, peakNeeds, pickBest, returnByNeeds, sum, targetsOf } from '../ai/lib.js';

/** How much each colour is wanted by the expensive cards on the table and the nobles in play: the colours worth discounting. */
function colourWorth(s) {
  const worth = [0, 0, 0, 0, 0];
  for (const card of boardCards(s)) {
    if (card.points < 2) continue;
    card.cost.forEach((n, c) => (worth[c] += n * 0.12 * card.points));
  }
  for (const noble of nobleList(s)) for (const [c, n] of Object.entries(noble.requires)) worth[Number(c)] += n * 0.25;
  const top = Math.max(1, ...worth);
  return worth.map((w) => w / top);
}

const SUPPLY = { 2: 4, 3: 5, 4: 7 }; // tokens of each colour at the table, by number of players

/** Whether a player could ever pay for this card: it fits in ten tokens, and the table has that many of each colour (plus Gold). */
const reachable = (s, t) => sum(t.need) <= 10 && t.need.every((n) => n <= SUPPLY[s.n] + 1);

function create({ id, name, engineSize, minPoints, description }) {
  const building = (s) => me(s).bought < engineSize;
  const memory = new Map(); // seat -> the card it is working towards: { id, round }

  /** The cards worth working towards, best first, for what the player is doing now. */
  function plan(s) {
    const player = me(s);
    const build = building(s);
    const worth = colourWorth(s);
    const lowest = Math.min(...player.bonuses);
    const options = targetsOf(s).filter((t) => reachable(s, t));
    const wanted = options.filter((t) => build || t.card.points >= minPoints);
    const fallback = wanted.length === 0; // nothing worth having is within reach: the cheapest card will do
    const ranked = (fallback ? options : wanted)
      .map((t) => {
        if (fallback) return { ...t, aim: 1 / (1 + t.short + sum(t.need) * 0.1) };
        const card = t.card;
        if (build) {
          const balance = player.bonuses[card.bonus] === lowest ? 0.5 : player.bonuses[card.bonus] >= 4 ? -0.6 : 0;
          const value = 1 + 0.6 * card.points + worth[card.bonus] * 0.8 + balance - (card.level === 3 ? 2 : 0);
          return { ...t, aim: value / (1 + t.short * 0.45 + sum(t.need) * 0.05) };
        }
        return { ...t, aim: (card.points + 0.1) / (1 + t.short * 0.45) };
      })
      .sort((a, b) => b.aim - a.aim);
    // Stay with the card it was working towards unless something has become much better.
    const kept = memory.get(s.seat);
    const keep = kept && kept.round <= s.round ? ranked.findIndex((t) => t.id === kept.id) : -1;
    if (keep > 0 && ranked[keep].aim >= 0.6 * ranked[0].aim) ranked.unshift(...ranked.splice(keep, 1));
    if (ranked.length) memory.set(s.seat, { id: ranked[0].id, round: s.round });
    const wants = [0, 0, 0, 0, 0];
    ranked.slice(0, 2).forEach((t, rank) => t.missing.forEach((m, c) => (wants[c] = Math.max(wants[c], rank === 0 ? m : Math.min(m, 1)))));
    return { ranked, wants, worth, build, lowest, fallback };
  }

  function chooseMove(s, rng) {
    if (!s.moves.length) return { type: 'pass' };
    const player = me(s);
    const { ranked, wants, worth, build, lowest, fallback } = plan(s);
    const score = (move) => {
      if (move.type === 'buy') {
        const card = CARD_BY_ID[move.card];
        const quote = payment(player, card);
        const paid = sum(quote.pay.slice(0, 5)) * 0.12 + quote.pay[GOLD] * 0.6;
        if (build) {
          const balance = player.bonuses[card.bonus] === lowest ? 0.4 : player.bonuses[card.bonus] >= 4 ? -0.6 : 0;
          return 10 + card.points * 0.8 + worth[card.bonus] * 0.8 + balance - (card.level === 3 ? 1 : 0) - paid;
        }
        if (fallback) return 6 + card.points - paid; // nothing in reach is worth points: take the cheapest card
        if (card.points < minPoints) return -5; // a rusher does not spend a turn on a card with no points
        return 10 + card.points * 3 - paid;
      }
      if (move.type === 'take') return move.colours.reduce((total, c) => total + (wants[c] > 0 ? 1 + Math.min(wants[c], 2) * 0.4 : 0.05), 0) - overflowOf(s, move.colours.length);
      if (move.type === 'takeTwo') return (wants[move.colour] >= 2 ? 3 : wants[move.colour] === 1 ? 1.2 : 0.1) - overflowOf(s, 2);
      // Reserving: to lock in the best card that is nearly affordable (and pick up a Gold on the way).
      const gold = s.supply[GOLD] > 0 ? 1 : 0;
      if (move.card === undefined) return 0.2 + gold * 0.3 - overflowOf(s, gold);
      const target = ranked.find((t) => t.id === move.card);
      const lock = !build && target === ranked[0] && target.short <= 3 && target.card.points >= 2 ? 2.2 : 0;
      return 0.3 + gold * 0.4 + lock - overflowOf(s, gold);
    };
    return pickBest(s.moves, score, rng);
  }

  return {
    id,
    name,
    description,
    chooseMove,
    chooseReturn: (s) => returnByNeeds(s, peakNeeds(plan(s).ranked.slice(0, 3))),
    chooseNoble: (s) => s.options[0],
  };
}

/** Builds an engine of `size` cards, then buys points. */
export const engine = (size = 8) => create({ id: `engine-${size}`, name: `Engine (${size} cards first)`, engineSize: size, minPoints: 1, description: `buys up to ${size} cheap cards first, then points` });

/** Never builds: buys only cards worth at least `points` prestige, from the start. */
export const rush = (points = 1) => create({ id: `rush-${points}`, name: `Rush (only ${points}+ point cards)`, engineSize: 0, minPoints: points, description: `buys only cards worth ${points}+ points, from the start` });
