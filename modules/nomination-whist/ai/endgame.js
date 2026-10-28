// The last round with the instant win on: if you cannot win on points, the only way to win the game is to nominate 7 and
// then win all 7 tricks, so with a mediocre hand there is nothing to lose by going for it. This is not a rule that forces a
// nomination: every card's weight is turned up so that the hand reads as very strong, and if the AI's usual judgement, given
// those weights, would nominate 7, it does (and then plays to win every trick it needs). If it would nominate anything else
// (a dealer who may not nominate 7, say), the boost is dropped and it nominates as usual: a 6 can no more win the game than a 0.

/** The most one round can give anybody: 10 for a hit plus a nomination of 7. */
export const MOST_POINTS_IN_A_ROUND = 17;

/** How much is added to the weight of every card (each is worth about a trick to start with, so this is "a whole trick more"). */
export const LAST_CHANCE_BOOST = 1;

/**
 * Whether this player, nominating now, can no longer win on points. It needs the round's context: `instantWin` (this round can
 * end the game that way), `round` and `rounds` (so that it is the last round), `scores` (everybody's total before this round)
 * and `seat`. Even the most a round can give (17) must leave you behind the best of the others, who cannot score less than
 * nothing. Without the context (a simulation of single deals, say) it is false.
 */
export function cannotWinOnPoints({ instantWin, round, rounds, scores, seat }) {
  if (!instantWin || !scores || round !== rounds - 1) return false;
  const best = Math.max(...scores.filter((_, other) => other !== seat));
  return scores[seat] + MOST_POINTS_IN_A_ROUND < best;
}

/** The boost to add to every card's weight in this situation: none normally, a lot when there is nothing to lose. */
export const lastChanceBoost = (ctx) => (cannotWinOnPoints(ctx) ? LAST_CHANCE_BOOST : 0);

/**
 * An AI's nomination with the last chance applied. `decide(boost)` is its usual nomination with every card's weight turned up
 * by `boost`: when the player cannot win on points and it comes to 7, that is the nomination; otherwise `decide(0)`, as usual.
 */
export function withLastChance(ctx, decide) {
  const boost = lastChanceBoost(ctx);
  if (boost && decide(boost) === 7) return 7;
  return decide(0);
}
