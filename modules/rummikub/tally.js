// What Rummikub counts about each player for the statistics and achievements (see module.json "stats"). The game calls
// tallyPlay after a turn that puts tiles down and tallyRack whenever a rack changes; nothing here changes the game.
import { bump, freshTally, peak } from '../../shared/tally.js';
import { isJoker, jokersReplaced, rackValue, tilesMoved } from './rules.js';

export const STAT_KEYS = ['roundsWon', 'roundsPlayed', 'tilesPlayed', 'jokersPlayed', 'biggestTurn', 'pointsPlayed', 'tilesMoved', 'jokersReplaced', 'outInOne', 'biggestRack', 'bothJokers', 'turnsDrawn', 'longestSet'];
export const newTally = () => freshTally(STAT_KEYS);

/**
 * Counts one turn that put tiles down.
 *   added       the ids that came from the rack
 *   before, after  the table before the turn and as the player left it
 *   firstMeld   whether this was the player's first meld of the round
 *   wentOut     whether it emptied their rack
 */
export function tallyPlay(tally, settings, { added, before, after, firstMeld, wentOut }) {
  bump(tally, 'tilesPlayed', added.length);
  bump(tally, 'jokersPlayed', added.filter((id) => isJoker(settings, id)).length);
  bump(tally, 'pointsPlayed', rackValue(settings, added));
  bump(tally, 'tilesMoved', tilesMoved(before, after));
  bump(tally, 'jokersReplaced', jokersReplaced(settings, before, after));
  peak(tally, 'biggestTurn', added.length);
  peak(tally, 'longestSet', Math.max(...after.map((set) => set.length)));
  if (firstMeld && wentOut) bump(tally, 'outInOne');
}

/**
 * Counts what a rack shows: the most tiles it has held, and holding two jokers at once (once a round: `alreadyHadBoth` says
 * whether this round has been counted). Returns whether the player has held both this round.
 */
export function tallyRack(tally, settings, rack, alreadyHadBoth) {
  peak(tally, 'biggestRack', rack.length);
  const both = rack.filter((id) => isJoker(settings, id)).length >= 2;
  if (both && !alreadyHadBoth) bump(tally, 'bothJokers');
  return alreadyHadBoth || both;
}

/** Counts a turn spent drawing a tile. */
export const tallyDraw = (tally) => bump(tally, 'turnsDrawn');
