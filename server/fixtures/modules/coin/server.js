// Test fixture: a "game" with one action. Whoever flips records a result for themselves.
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
