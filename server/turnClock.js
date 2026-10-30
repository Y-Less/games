// Times how long a player keeps a game waiting on their turn, for the "took over 10 minutes to take a turn" achievement.
// Every game sends each player a `state` view whose scoreboard says whose turn it is (`current`) for the player the view
// is for (`isMe`), so this watches those views rather than each game's rules. It watches one connection: a player who
// disconnects loses the clock, so only a turn taken while online counts.

export const SLOW_TURN_MS = 10 * 60 * 1000;

/** Whether a `state` view says it is the turn of the player it was sent to. */
export const isMyTurn = (view) => Boolean(view?.scoreboard?.players?.some((p) => p.isMe && p.current));

/**
 * @param {{ onSlow: () => void, now?: () => number, limit?: number }} options
 *   onSlow is called when a turn that lasted at least `limit` milliseconds ends with the player still connected.
 * @returns {(view: object | null) => void} to be given every view sent down the connection, in order
 */
export function watchTurns({ onSlow, now = Date.now, limit = SLOW_TURN_MS }) {
  let since = null; // when the current turn began, or null when it is not their turn
  return (view) => {
    const mine = isMyTurn(view);
    if (mine) {
      since ??= now();
      return;
    }
    const waited = since === null ? 0 : now() - since;
    since = null;
    if (view && waited >= limit) onSlow();
  };
}
