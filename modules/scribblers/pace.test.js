// How a computer player's picture reaches the table: a few strokes at a time, in a scattered order, rather than the
// whole thing in one message.  The rate is turned down here so that a second of drawing is a test rather than a wait;
// everywhere else it is turned right up, so that no other test waits for a picture at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Twenty strokes a second against the server's quarter-second tick is five a message: the test picture (one band every
// eighth row) then takes about a second, and arrives in about four messages.
process.env.SCRIBBLERS_CHOOSE_WAIT = '1500';
process.env.SCRIBBLERS_BETWEEN_WAIT = '150';
process.env.SCRIBBLERS_SCORES_WAIT = '1500';
process.env.SCRIBBLERS_BOT_DELAY = '50-150';
process.env.SCRIBBLERS_BOT_DRAW = '100';
process.env.SCRIBBLERS_BOT_RATE = '20';
process.env.SCRIBBLERS_PICTURES = 'test';

test('a computer player draws a few strokes at a time, scattered over the board', async (t) => {
  const site = await launchModule(t, { id: 'scribblers', moduleDir: here });
  const ann = await site.person('ann').open();
  const created = await ann.call('create', { rounds: 1, drawTime: 60 });
  assert.equal(created.ok, true, created.error);
  assert.equal((await ann.call('fillBots', { count: 3 })).ok, true);
  await until(() => ann.state?.players.length === 3, 'a table of three');
  assert.equal((await ann.call('start')).ok, true);

  const draws = [];
  ann.socket.on('draw', (message) => draws.push(message));
  // If Ann is drawing she chooses at once, so that a computer player's turn comes round.
  await until(
    async () => {
      if (ann.state?.phase === 'choosing' && ann.state.youDraw) await ann.call('word', { n: 0 });
      return ann.state?.phase === 'drawing' && !ann.state.youDraw;
    },
    'a computer player is drawing',
    { timeout: 60000 },
  );

  const began = Date.now();
  await until(() => draws.flatMap((message) => message.ops).length >= 15, 'its picture reaches the table', { timeout: 60000 });
  const took = Date.now() - began;
  const ops = draws.flatMap((message) => message.ops);

  assert.ok(draws.length >= 3, `the picture came in ${draws.length} messages, not a few strokes at a time`);
  assert.ok(ops.length / draws.length < 10, 'and no message carried the whole picture');
  assert.ok(took > 400, `it appeared over ${took}ms, which is not slowly`);
  // The test picture is one band a row, top to bottom; shuffled, it is all but certain not to arrive that way.
  const tops = ops.map((op) => op.y);
  assert.ok(
    tops.some((y, at) => at > 0 && y < tops[at - 1]),
    'the strokes went on in the order the picture stores them, rather than scattered',
  );
});
