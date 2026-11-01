// Test fixture: a "game" with one action. Whoever flips records a result for themselves.
// Depends on: only the `ctx` the site's module loader (server/modules.js) passes in (io, stats).

/**
 * The module entry point, as the loader expects.
 * @param {{ io: import('socket.io').Namespace, stats: { record: (result: object) => number | null } }} ctx  the module context
 * @returns {void}
 * Side effects: listens for connections; `whoami` replies with the caller, and `finish` records a one-player result.
 */
export default function (ctx) {
  ctx.io.on('connection', (socket) => {
    socket.on('whoami', (_payload, ack) => ack({ user: socket.data.user }));
    socket.on('finish', (payload, ack) => {
      const id = ctx.stats.record({
        code: 'test-game-code',
        players: [{ userId: socket.data.user.id, outcome: payload.outcome, score: payload.score, extras: { flips: 1, streak: payload.streak ?? 0 } }],
      });
      ack({ ok: true, id });
    });
  });
}
