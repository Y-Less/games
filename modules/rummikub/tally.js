// What Rummikub counts about each player for the statistics and achievements (see module.json "stats").  The game calls
// tallyPlay after a turn that puts tiles down and tallyRack whenever a rack changes; nothing here changes the game.
// Depends on shared/tally.js (the counter helpers) and rules.js (tile values and the table comparisons).  The counters are
// plain numbers on each player's tally object, which is saved with the room.
import { bump, freshTally, peak } from '../../shared/tally.js';
import { isJoker, jokersReplaced, rackValue, tilesMoved } from './rules.js';

// The name of every counter kept in a player's tally (see module.json "stats" for how they are shown).
export const STAT_KEYS = ['roundsWon', 'roundsPlayed', 'tilesPlayed', 'jokersPlayed', 'biggestTurn', 'pointsPlayed', 'tilesMoved', 'jokersReplaced', 'outInOne', 'biggestRack', 'bothJokers', 'turnsDrawn', 'longestSet'];
// A fresh tally for one player, with every counter at zero.  Takes no arguments; returns an object; no side effects.
export const newTally = () => freshTally(STAT_KEYS);

/**
 * Counts one turn that put tiles down.
 *   added       the ids that came from the rack
 *   before, after  the table before the turn and as the player left it
 *   firstMeld   whether this was the player's first meld of the round
 *   wentOut     whether it emptied their rack
 *
 * @param {object} tally  the player's tally; counters are added to
 * @param {object} settings  the room settings
 * @param {object} turn  { added, before, after, firstMeld, wentOut } as listed above
 * @returns {void}
 * Side effects: increases or raises counters on `tally`.
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
 * whether this round has been counted).  Returns whether the player has held both this round.
 *
 * @param {object} tally  the player's tally; counters may be raised
 * @param {object} settings  the room settings
 * @param {number[]} rack  the rack's tile ids
 * @param {boolean} alreadyHadBoth  whether both jokers were already counted this round
 * @returns {boolean} true once the player has held both jokers this round
 * Side effects: may raise biggestRack and bothJokers on `tally`.
 */
export function tallyRack(tally, settings, rack, alreadyHadBoth) {
  peak(tally, 'biggestRack', rack.length);
  const both = rack.filter((id) => isJoker(settings, id)).length >= 2;
  if (both && !alreadyHadBoth) bump(tally, 'bothJokers');
  return alreadyHadBoth || both;
}

/** Counts a turn spent drawing a tile.  Takes (tally); returns nothing useful; side effect: increases tally.turnsDrawn. */
export const tallyDraw = (tally) => bump(tally, 'turnsDrawn');
