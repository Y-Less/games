// Where the tour you are in has got to, wherever on the site you are.
//
// A tour sends everybody off to play a game in another module, so while you are playing it you are not looking at the
// tour at all — a different page, a different socket, a different room.  The tour therefore says what it is doing on
// the site's own socket (server/siteSocket.js, through the module's `ctx.tell`), which every signed-in page holds open,
// and this keeps the last thing it said.  TourBand.vue is what shows it.
//
// What is deliberately NOT here: any decision to move you.  The band offers a link and you take it or you do not,
// because the alternative is pulling somebody off a final scoreboard they are still reading.
//
// This only knows what the tour has told you *this session*: reloading the page in the middle of a game loses it until
// the tour next moves (which is when it matters, since that is when there is somewhere new to go).
// Depends on: vue and ./siteFeed.js.
import { reactive } from 'vue';
import { onSite } from './siteFeed.js';

/**
 * The tour you are in, or all nulls when you are not in one (or have not been told about it yet).
 * `phase` is the tour's own: 'voting', 'opening', 'playing' or 'finished'.
 */
export const tour = reactive({ code: null, phase: null, game: null, gameCode: null, dismissed: false });

/**
 * Forgets the tour (it has ended, or you have hidden the band).
 * @param {boolean} [dismissed]  true when you hid it rather than it ending
 * @returns {void}
 * Side effects: empties `tour`.
 */
export function clearTour(dismissed = false) {
  Object.assign(tour, { code: null, phase: null, game: null, gameCode: null, dismissed });
}

// Whatever the tour last said.  A tour that has finished is no longer anywhere to go back to, so it clears instead.
onSite('tour', (payload) => {
  if (!payload?.code || payload.phase === 'finished' || payload.phase === 'lobby') {
    clearTour();
    return;
  }
  Object.assign(tour, { code: payload.code, phase: payload.phase, game: payload.game ?? null, gameCode: payload.gameCode ?? null, dismissed: false });
});
