// What Cheat counts about each player for the statistics and achievements (see module.json "stats"). The game calls these as
// plays and calls are made; nothing here changes the game.
import { bump, freshTally } from '../../shared/tally.js';

export const STAT_KEYS = ['liesTold', 'liesCaught', 'callsMade', 'callsCorrect', 'liesGotAway', 'badCalls', 'brazenLies', 'cleanGetaways'];
export const newTally = () => freshTally(STAT_KEYS);

/** The counters the table shows to everybody (the others are for the player's own statistics only). */
export const PUBLIC_KEYS = ['liesTold', 'liesCaught', 'callsMade', 'callsCorrect'];

/** The most cards that can be played at once: a lie with this many is a brazen one. */
export const BRAZEN_COUNT = 4;

/** Counts a play of `count` cards, which was a lie or not. */
export function tallyPlay(tally, { count, lie }) {
  if (!lie) return;
  bump(tally, 'liesTold');
  if (count === BRAZEN_COUNT) bump(tally, 'brazenLies');
}

/** Counts a call of "Cheat!": the caller's, and a lie caught out or a call that was wrong. */
export function tallyCall(callerTally, accusedTally, lie) {
  bump(callerTally, 'callsMade');
  if (lie) {
    bump(callerTally, 'callsCorrect');
    bump(accusedTally, 'liesCaught');
  } else bump(callerTally, 'badCalls');
}

/** Counts a lie that nobody called before the next play, or before the player who went out was believed. */
export const tallyLieStood = (tally) => bump(tally, 'liesGotAway');

/** Counts going out with a lie that nobody called, and so winning. */
export const tallyCleanGetaway = (tally) => bump(tally, 'cleanGetaways');
