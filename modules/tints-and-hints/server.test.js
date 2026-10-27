// Tints and Hints against the real site: accounts over HTTP, a game over sockets, and the statistics it records.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { startSite } from '../../server/index.js';
import { parseCell } from './grid.js';

const modulesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = 'tints-and-hints';

async function launch(t, existingDir) {
  const dataDir = existingDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'tints-test-'));
  const site = await startSite({ port: 0, dataDir, modulesDir, log: () => {} });
  const base = `http://127.0.0.1:${site.port}`;
  const sockets = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const s of sockets) s.close();
    await site.close();
  };
  t.after(async () => {
    await close();
    if (!existingDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function account(username) {
    let cookie = '';
    const call = async (method, url, body) => {
      const res = await fetch(base + url, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return res.json();
    };
    const registered = await call('POST', '/api/auth/register', { username, password: `${username} password` });
    const me = {
      id: registered.user.id,
      name: registered.user.displayName,
      stats: () => call('GET', '/api/stats/me'),
      /** A socket with the latest state it was sent, and helpers to act and to wait. */
      async open() {
        const socket = connect(`${base}/${ID}`, { forceNew: true, extraHeaders: { cookie } });
        sockets.push(socket);
        const player = { socket, state: undefined, states: [] };
        socket.on('state', (s) => {
          player.state = s;
          player.states.push(s);
        });
        await new Promise((resolve, reject) => {
          socket.on('connect', resolve);
          socket.on('connect_error', reject);
        });
        player.send = (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));
        player.until = async (predicate, what = 'a state') => {
          for (let i = 0; i < 200; i++) {
            if (predicate(player.state)) return player.state;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.fail(`${username} never saw ${what}; last state: ${JSON.stringify(player.state)}`);
        };
        return player;
      },
    };
    return me;
  }
  return { site, base, account, close, dataDir };
}

const farFrom = (cell) => (parseCell(cell).col < 24 ? 'AZ24' : 'A1');

test('a whole game: create, join by code, start, two rounds a turn, reveal, finish and statistics', async (t) => {
  const { account } = await launch(t);
  const accounts = [await account('ann'), await account('bob'), await account('cat')];
  const players = [];
  for (const a of accounts) players.push(await a.open());
  const [ann, bob, cat] = players;

  assert.equal(ann.state, undefined);
  assert.deepEqual(await ann.send('resume'), { ok: true, code: null });
  assert.equal(ann.state, null, 'no game to resume');
  assert.equal((await ann.send('join', { code: 'nonsense' })).ok, false);
  assert.match((await ann.send('join', { code: 'boss-aware-you' })).error, /No game has that code/);

  const created = await ann.send('create', { turnsEach: 1 });
  assert.ok(created.ok);
  assert.match(created.code, /^[a-z]+-[a-z]+-[a-z]+$/);
  assert.equal((await ann.send('create')).ok, false, 'already in a game');
  const lobby = await ann.until((s) => s?.phase === 'lobby');
  assert.equal(lobby.hostId, accounts[0].id);
  assert.deepEqual(lobby.players.map((p) => p.name), ['ann']);

  assert.ok((await bob.send('join', { code: ` ${created.code.toUpperCase()} ` })).ok, 'codes are tidied');
  assert.ok((await cat.send('join', { code: `https://example.test/play/${ID}?${created.code}` })).ok, 'even a pasted link');
  await ann.until((s) => s.players.length === 3, 'three players');
  assert.equal((await bob.send('start')).ok, false, 'only the host starts');
  assert.equal((await bob.send('colour', { colour: ann.state.players[0].colour })).ok, false, 'colours are unique');
  assert.ok((await bob.send('colour', { colour: '#ff2d95' })).ok);
  assert.equal((await cat.send('settings', { turnsEach: 3 })).ok, false, 'only the host sets turns');
  assert.ok((await ann.send('settings', { turnsEach: 1 })).ok);
  await cat.until((s) => s.players.find((p) => p.name === 'bob').colour === '#ff2d95', 'the new colour');

  const stranger = await (await account('dan')).open();
  assert.equal((await stranger.send('join', { code: created.code })).ok, true);
  await stranger.until((s) => s?.players.length === 4);
  assert.ok((await stranger.send('leave')).ok);
  await stranger.until((s) => s === null);
  await ann.until((s) => s.players.length === 3, 'the stranger gone');

  assert.ok((await ann.send('start')).ok);
  assert.equal((await ann.send('start')).ok, false);
  assert.equal((await (await (await account('eve')).open()).send('join', { code: created.code })).ok, false, 'too late to join');

  const expected = new Map(accounts.map((a) => [a.id, { score: 0, exact: 0, hints: 0 }]));
  for (let turn = 1; turn <= 3; turn++) {
    for (const p of players) await p.until((s) => s.phase === 'guessing1' && s.turn === turn, `turn ${turn}`);
    const hinter = players.find((p) => p.state.tint);
    const guessing = players.filter((p) => p !== hinter);
    assert.equal(players.filter((p) => p.state.tint).length, 1, 'only the hinter sees the tint');
    const tint = hinter.state.tint;
    for (const p of players) {
      assert.equal(p.state.scoreboard.rounds.length, turn - 1, 'the running turn is not in the history yet');
      assert.ok(!JSON.stringify(p.state.scoreboard).includes(`"${tint}"`), 'no sign of the tint in the scoreboard');
    }
    for (const g of guessing) {
      assert.equal(g.state.tint, null);
      const seen = JSON.stringify(g.states.filter((s) => s?.phase === 'guessing1' && s.turn === turn));
      assert.ok(!seen.includes(`"${tint}"`), 'the tint never reached a guesser before the reveal');
    }
    expected.get(guessing[0].state.you).score += 9;
    expected.get(guessing[0].state.you).exact += 2;
    expected.get(hinter.state.you).score += 3;
    expected.get(hinter.state.you).hints += 1;

    assert.equal((await guessing[0].send('advance')).ok, false, 'a guesser cannot continue');
    assert.equal((await hinter.send('guess', { cell: 'A1' })).ok, false, 'the hinter cannot guess');
    assert.equal((await hinter.send('advance')).ok, false, 'not everyone has guessed');
    assert.equal((await guessing[0].send('guess', { cell: 'ZZ' })).ok, false);
    assert.ok((await hinter.send('hint', { text: 'like a sunset' })).ok);
    assert.ok((await guessing[0].send('guess', { cell: tint })).ok);
    assert.equal((await guessing[0].send('guess', { cell: tint })).ok, false, 'one guess a round');
    assert.ok((await guessing[1].send('guess', { cell: farFrom(tint) })).ok);
    await guessing[1].until((s) => s.hints.first === 'like a sunset', 'the hint');
    assert.deepEqual((await guessing[1].until((s) => s.guesses.length === 1)).guesses.map((x) => x.id), [guessing[1].state.you], 'others\' guesses stay hidden');

    assert.ok((await hinter.send('advance')).ok);
    await guessing[0].until((s) => s.phase === 'guessing2');
    assert.equal(guessing[0].state.guesses.length, 2, 'round one is open now');
    assert.equal(guessing[0].state.tint, null);
    assert.ok((await guessing[0].send('guess', { cell: tint })).ok);
    assert.ok((await guessing[1].send('guess', { cell: farFrom(tint) })).ok);
    assert.ok((await hinter.send('advance')).ok);

    const revealed = await guessing[1].until((s) => s.phase === 'reveal', 'the reveal');
    assert.equal(revealed.tint, tint);
    assert.equal(revealed.result.hinterPoints, 3);
    for (const p of players) {
      const board = (await p.until((s) => s.phase === 'reveal' && s.turn === turn, 'the reveal')).scoreboard;
      assert.equal(board.rounds.length, turn, 'every view has the history');
      assert.equal(board.rounds.at(-1).label, `Turn ${turn}: ${accounts.find((a) => a.id === hinter.state.you).name}`);
      assert.equal(board.rounds.at(-1).deltas[guessing[0].state.you], 9);
      assert.equal(board.rounds.at(-1).deltas[hinter.state.you], 3);
      assert.equal(board.rounds.at(-1).notes[hinter.state.you], '1 found it');
      assert.equal(board.players.find((x) => x.isMe).id, p.state.you);
      for (const bp of board.players) {
        assert.equal(bp.score, p.state.players.find((x) => x.id === bp.id).score);
        assert.equal(board.rounds.reduce((n, r) => n + (r.deltas[bp.id] ?? 0), 0), bp.score, 'the history adds up to the score');
      }
    }
    assert.deepEqual(revealed.result.entries.map((e) => [e.round, e.kind]), [[1, 'exact'], [1, 'miss'], [2, 'exact'], [2, 'miss']]);

    if (turn === 2) {
      // A phone loses its connection and comes back: the same game, with the same view.
      const index = players.indexOf(guessing[1]);
      guessing[1].socket.close();
      await hinter.until((s) => s.players.find((p) => p.id === accounts[index].id).online === false, 'someone offline');
      players[index] = await accounts[index].open();
      guessing[1] = players[index];
      assert.deepEqual(await players[index].send('resume'), { ok: true, code: created.code });
      const back = await players[index].until((s) => s?.phase === 'reveal');
      assert.equal(back.tint, tint);
      await hinter.until((s) => s.players.every((p) => p.online), 'everyone back');
    }
    const bystander = guessing.find((g) => g.state.you !== accounts[0].id);
    assert.equal((await bystander.send('advance')).ok, false, 'nobody closes the reveal with advance');
    for (const p of [hinter, ...guessing]) assert.ok((await p.send('ready')).ok, 'closing the scores');
  }

  const final = await ann.until((s) => s.phase === 'finished', 'the end');
  assert.equal(final.tint, final.result.tint, 'the last tint is shown');
  const totals = final.players.map((p) => p.score);
  for (const p of final.players) assert.equal(p.score, expected.get(p.id).score);
  assert.ok(final.players.every((p) => p.placement >= 1));
  assert.equal(final.players.filter((p) => p.winner).length, totals.filter((s) => s === Math.max(...totals)).length);

  // Everyone's profile has the game, once.
  let wins = 0;
  for (const a of accounts) {
    const stats = await a.stats();
    assert.equal(stats.summary.played, 1);
    assert.equal(stats.summary.wins + stats.summary.losses, 1);
    wins += stats.summary.wins;
    const mine = final.players.find((p) => p.id === a.id);
    const [entry] = stats.perGame;
    assert.equal(entry.game, ID);
    assert.equal(entry.totalScore, mine.score);
    const extras = Object.fromEntries(entry.extras.map((e) => [e.key, e.value]));
    assert.equal(extras.exactGuesses, expected.get(a.id).exact);
    assert.equal(extras.hintsGiven, 1);
    assert.equal(extras.closeGuesses ?? 0, 0);
    assert.equal(stats.recent[0].players, 3);
    assert.equal(stats.recent[0].placement, mine.placement);
  }
  assert.equal(wins, final.players.filter((p) => p.winner).length);

  // Finishing happens once, even if players keep poking at the finished game.
  assert.equal((await ann.send('advance')).ok, false);
  assert.equal((await accounts[0].stats()).summary.played, 1);

  assert.ok((await ann.send('leave')).ok);
  await ann.until((s) => s === null);
  assert.ok((await ann.send('create')).ok, 'free to start another game');
});

test('an abandoned game is not recorded, and the host can remove someone who has gone', async (t) => {
  const { account } = await launch(t);
  const accounts = [await account('ann'), await account('bob'), await account('cat')];
  const [ann, bob, cat] = await Promise.all(accounts.map((a) => a.open()));
  const { code } = await ann.send('create');
  await bob.send('join', { code });
  await cat.send('join', { code });
  await ann.until((s) => s.players.length === 3);

  assert.equal((await bob.send('kick', { userId: accounts[2].id })).ok, false, 'only the host removes players');
  assert.ok((await ann.send('kick', { userId: accounts[2].id })).ok, 'anyone can be removed from the lobby');
  await cat.until((s) => s === null);
  assert.ok((await cat.send('join', { code })).ok, 'and may come back');
  await ann.until((s) => s.players.length === 3);

  assert.ok((await ann.send('start')).ok);
  cat.socket.close();
  await ann.until((s) => s.players.find((p) => p.id === accounts[2].id).online === false);
  assert.ok((await ann.send('kick', { userId: accounts[2].id })).ok);
  await bob.until((s) => s.players.length === 2);

  assert.ok((await bob.send('leave')).ok);
  const left = await ann.until((s) => s.phase === 'abandoned', 'the game to be abandoned');
  assert.equal(left.players.length, 1);
  for (const a of accounts) assert.equal((await a.stats()).summary.played, 0, `${a.name} has no game recorded`);
});

test('rooms survive a restart of the site, and the game can be finished afterwards', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tints-restart-'));
  const first = await launch(t, dataDir);
  const accounts = [await first.account('ann'), await first.account('bob')];
  const [ann, bob] = await Promise.all(accounts.map((a) => a.open()));
  const { code } = await ann.send('create', { turnsEach: 1 });
  await bob.send('join', { code });
  await ann.send('start');
  await ann.until((s) => s.phase === 'guessing1');
  await bob.until((s) => s.phase === 'guessing1');
  const hinterIndex = ann.state.tint ? 0 : 1;
  const tint = [ann, bob][hinterIndex].state.tint;
  const guesser = [ann, bob][1 - hinterIndex];
  assert.ok((await [ann, bob][hinterIndex].send('hint', { text: 'a warm evening' })).ok);
  assert.ok((await guesser.send('guess', { cell: tint })).ok);
  await first.close();
  assert.ok(fs.existsSync(path.join(dataDir, 'modules', ID, 'rooms.json')));

  // The same data folder, a new process-worth of site. The accounts' sessions are in the same database.
  const second = await launch(t, dataDir);
  assert.ok(second.site.port);
  const relogin = async (name) => {
    const res = await fetch(`http://127.0.0.1:${second.site.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: name, password: `${name} password` }),
    });
    return res.headers.get('set-cookie').split(';')[0];
  };
  const open = async (name) => {
    const cookie = await relogin(name);
    const socket = connect(`http://127.0.0.1:${second.site.port}/${ID}`, { forceNew: true, extraHeaders: { cookie } });
    t.after(() => socket.close());
    let state;
    socket.on('state', (s) => (state = s));
    await new Promise((resolve) => socket.on('connect', resolve));
    return { socket, state: () => state, send: (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve)) };
  };
  const [ann2, bob2] = [await open('ann'), await open('bob')];
  const resumed = await guesserOf([ann2, bob2], hinterIndex).send('resume');
  assert.deepEqual(resumed, { ok: true, code });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const hinter2 = [ann2, bob2][hinterIndex];
  await hinter2.send('resume');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(hinter2.state().tint, tint, 'the same tint');
  const guesser2 = guesserOf([ann2, bob2], hinterIndex);
  assert.equal(guesser2.state().guesses.length, 1, 'and the guess made before the restart');
  assert.equal((await guesser2.send('guess', { cell: tint })).ok, false, 'which still counts as made');
  assert.ok((await hinter2.send('advance')).ok);
  assert.ok((await guesser2.send('guess', { cell: tint })).ok);
  assert.ok((await hinter2.send('advance')).ok);
  for (const p of [hinter2, guesser2]) assert.ok((await p.send('ready')).ok);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(hinter2.state().phase, 'guessing1', 'the second turn begins once both are ready');
  ann2.socket.close();
  bob2.socket.close();
  await second.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function guesserOf(pair, hinterIndex) {
  return pair[1 - hinterIndex];
}

test('the history is saved with the room, survives a restart, and rooms saved without one still load', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tints-history-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const roomsFile = path.join(dataDir, 'modules', ID, 'rooms.json');
  const names = ['ann', 'bob'];

  const first = await launch(t, dataDir);
  const accounts = [await first.account('ann'), await first.account('bob')];
  const [ann, bob] = await Promise.all(accounts.map((a) => a.open()));
  const { code } = await ann.send('create', { turnsEach: 2 });
  await bob.send('join', { code });
  await ann.send('start');
  const both = [ann, bob];
  for (const p of both) await p.until((s) => s.phase === 'guessing1');
  const hinter = both.find((p) => p.state.tint);
  const guesser = both.find((p) => p !== hinter);
  const tint = hinter.state.tint;
  assert.ok((await hinter.send('hint', { text: 'a warm evening' })).ok);
  await guesser.send('guess', { cell: tint });
  await hinter.send('advance');
  await guesser.send('guess', { cell: farFrom(tint) });
  await hinter.send('advance');
  const revealed = await guesser.until((s) => s.phase === 'reveal');
  const board = revealed.scoreboard;
  assert.equal(board.rounds.length, 1);
  assert.deepEqual(board.rounds[0].deltas, { [guesser.state.you]: 5, [hinter.state.you]: 3 });
  assert.equal(board.rounds[0].notes[guesser.state.you], 'exact in round 1');
  await first.close();
  const saved = JSON.parse(fs.readFileSync(roomsFile, 'utf8'));
  assert.equal(saved[0].history.length, 1, 'saved to disk');

  const peek = async (launched) => {
    const results = {};
    for (const name of names) {
      const res = await fetch(`http://127.0.0.1:${launched.site.port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: name, password: `${name} password` }),
      });
      const cookie = res.headers.get('set-cookie').split(';')[0];
      const socket = connect(`http://127.0.0.1:${launched.site.port}/${ID}`, { forceNew: true, extraHeaders: { cookie } });
      t.after(() => socket.close());
      await new Promise((resolve) => socket.on('connect', resolve));
      results[name] = await new Promise((resolve) => {
        socket.on('state', (s) => s && resolve(s));
        socket.emit('resume', { code });
      });
      socket.close();
    }
    return results;
  };

  const second = await launch(t, dataDir);
  const again = await peek(second);
  for (const name of names) assert.deepEqual({ ...again[name].scoreboard, players: undefined }, { ...board, players: undefined }, `${name} sees the same history`);
  assert.deepEqual(again.ann.scoreboard.players.map((p) => p.score), again.ann.players.map((p) => p.score));
  await second.close();

  // A save from before the history was kept: the points are there but no turn-by-turn record.
  for (const room of saved) delete room.history;
  fs.writeFileSync(roomsFile, JSON.stringify(saved));
  const third = await launch(t, dataDir);
  const legacy = await peek(third);
  const { rounds, players } = legacy.bob.scoreboard;
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].label, 'Earlier turns');
  for (const p of players) assert.equal(rounds.reduce((n, r) => n + (r.deltas[p.id] ?? 0), 0), p.score, 'old rooms still add up');
  assert.equal(legacy.bob.phase, 'reveal');
  await third.close();
});

test('at the reveal, someone who is away (never closes the scores) does not hold the game up for ever', async (t) => {
  process.env.TINTS_NEXT_WAIT = '200';
  t.after(() => delete process.env.TINTS_NEXT_WAIT);
  const { account } = await launch(t);
  const [ann, bob] = [await (await account('ann')).open(), await (await account('bob')).open()];
  const { code } = await ann.send('create', { turnsEach: 2 });
  await bob.send('join', { code });
  await ann.until((s) => s?.players.length === 2);
  await ann.send('start');
  const both = [ann, bob];
  for (const p of both) await p.until((s) => s.phase === 'guessing1');
  const hinter = both.find((p) => p.state.tint);
  const guesser = both.find((p) => p !== hinter);
  assert.ok((await hinter.send('hint', { text: 'warm' })).ok);
  await guesser.send('guess', { cell: 'A1' });
  await hinter.send('advance');
  await guesser.send('guess', { cell: 'A1' });
  await hinter.send('advance');
  await hinter.until((s) => s.phase === 'reveal');
  assert.equal(hinter.state.players.find((p) => p.id === hinter.state.you).ready, false);
  await hinter.send('ready');
  await guesser.until((s) => s.players.find((p) => p.id === hinter.state.you).ready, 'the hinter ready');
  assert.equal(guesser.state.phase, 'reveal', 'still waiting for the other person');
  await guesser.until((s) => s.phase === 'guessing1' && s.turn === 2, 'the next turn after the wait');
});
