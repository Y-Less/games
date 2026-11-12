// A tour against the real site: the vote settles, a room is opened in *another* module with these people in it, and
// when that game ends the tour comes back to a fresh vote.  Everything interesting about a tour crosses a module
// boundary, which no unit test can reach, so it is all here.
//
// The other module is a stand-in written for this test rather than a real game: it starts at once and ends when it is
// told to, so a whole cycle takes milliseconds and nothing depends on how Hearts happens to deal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { startSite } from '../../server/index.js';

process.env.TOUR_BOT_DELAY = '1-4';

const here = path.dirname(fileURLToPath(import.meta.url));
const platform = path.join(here, '..', '..');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, what, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await condition()) return;
    await sleep(10);
  }
  assert.fail(`timed out waiting for: ${what}`);
}

/** The stand-in game: a room-based module with no rules worth the name, which ends when a player says 'endIt'. */
const MINI_SERVER = `import { rosterLayout } from '../../shared/layout.js';
import { createRoomServer } from '../../shared/roomServer.js';
import { createRosterRules, hasPlayer, isBot, isHuman, seatOf, withSlot } from '../../shared/roster.js';

const isLive = (room) => room.phase !== 'finished';
const makePlayer = (room, base) => ({ ...base });
const roster = createRosterRules({ isLive, minPlayers: 2, maxPlayers: 8, makePlayer });

const game = {
  ...roster,
  isLive,
  isHuman,
  isBot,
  hasPlayer,
  seatOf,
  createRoom({ code, hostId, hostName, now }) {
    const room = { code, hostId, phase: 'lobby', players: [], size: 8, nextIdx: 0, nextBot: 1, recorded: false, createdAt: now, updatedAt: now };
    room.players.push(withSlot(room, makePlayer(room, { kind: 'human', id: hostId, name: hostName })));
    return room;
  },
  setSettings: () => ({ ok: false, error: 'noSettings' }),
  start(room) {
    room.phase = 'playing';
    return { ok: true };
  },
  playAgain(room) {
    room.phase = 'lobby';
    return { ok: true };
  },
  statsPlayers: () => [],
  viewFor: (room) => ({ phase: room.phase, players: room.players.map((p) => ({ slot: p.slot, id: p.id, name: p.name, bot: isBot(p) })) }),
};

export default function (ctx) {
  return createRoomServer(ctx, {
    game,
    pickSettings: () => ({}),
    members: (room) => room.players,
    layout: rosterLayout,
    nextAction: () => null,
    registerEvents({ on, act }) {
      on('endIt', () => act((room) => {
        room.phase = 'finished';
        return { ok: true };
      }));
    },
  });
}
`;

/** A modules folder holding the tour and the stand-in, and the shared code both import. */
function modulesFor(root) {
  const dir = path.join(root, 'modules');
  fs.cpSync(here, path.join(dir, 'tour'), { recursive: true, filter: (source) => !/\.test\.js$/.test(source) && path.basename(source) !== 'client' });
  fs.cpSync(path.join(platform, 'shared'), path.join(root, 'shared'), { recursive: true, filter: (source) => !/\.test\.js$/.test(source) });
  fs.mkdirSync(path.join(dir, 'mini'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'mini', 'module.json'), JSON.stringify({ id: 'mini', name: 'Mini', description: 'A stand-in.', minPlayers: 2, maxPlayers: 8, category: 'other' }));
  fs.writeFileSync(path.join(dir, 'mini', 'server.js'), MINI_SERVER);
  return dir;
}

async function launch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-e2e-'));
  const logs = [];
  const site = await startSite({ port: 0, dataDir: path.join(root, 'site'), modulesDir: modulesFor(root), log: (...args) => logs.push(args.map(String).join(' ')) });
  const base = `http://127.0.0.1:${site.port}`;
  const sockets = [];
  t.after(async () => {
    sockets.forEach((s) => s.close());
    await site.close();
    fs.rmSync(root, { recursive: true, force: true });
    assert.deepEqual(logs.filter((line) => /failed|could not|TypeError/.test(line)), [], 'the server logged a failure');
  });

  /** One signed-in account, with a socket per module it is looking at. */
  class Person {
    constructor(name) {
      this.name = name;
      this.cookie = '';
      this.states = {}; // module id -> the latest 'state' it was sent
    }
    async http(method, url, body) {
      const res = await fetch(base + url, { method, headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) this.cookie = set.split(';')[0];
      return res.json().catch(() => null);
    }
    async register() {
      const out = await this.http('POST', '/api/auth/register', { username: this.name, password: `${this.name} password` });
      this.id = out.user.id;
      return this;
    }
    /** Opens a socket on one module's namespace and follows the states it sends. */
    async open(module) {
      const socket = connect(`${base}/${module}`, { forceNew: true, extraHeaders: { cookie: this.cookie } });
      sockets.push(socket);
      this[module] = socket;
      socket.on('state', (state) => (this.states[module] = state));
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      return this;
    }
    /** Sends an event and waits for the server's answer. */
    call(module, event, payload = {}) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${event} was never answered`)), 5000);
        this[module].emit(event, payload, (reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
      });
    }
  }
  return { base, Person };
}

test('a tour votes, opens the winning game in another module with its people in it, and comes back when it ends', async (t) => {
  const { Person } = await launch(t);
  const ann = await new Person('ann').register();
  await ann.open('tour');

  // A tour of one person and three computer players.  The only other module here is the stand-in, so the vote has
  // exactly one game to offer and the result is not in doubt — what is being tested is the crossing, not the choosing.
  assert.equal((await ann.call('tour', 'create')).ok, true);
  assert.equal((await ann.call('tour', 'fillBots', { count: 4 })).ok, true);
  await until(() => ann.states.tour?.players?.length === 4, 'the tour to fill up');
  assert.equal((await ann.call('tour', 'start')).ok, true);

  await until(() => ann.states.tour?.phase === 'voting', 'the first vote to open');
  assert.deepEqual(ann.states.tour.choices.map((c) => c.id), ['mini'], 'the only other module is the only choice');
  assert.equal((await ann.call('tour', 'vote', { choice: 'mini' })).ok, true);

  // The computer players vote too, the vote settles and the tour opens a room in the other module.
  await until(() => ann.states.tour?.phase === 'playing', 'the tour to open the game');
  const { current } = ann.states.tour;
  assert.equal(current.game, 'mini');
  assert.match(current.code, /^[a-z]+-[a-z]+-[a-z]+$/);
  assert.deepEqual(ann.states.tour.played.map((p) => p.game), ['mini']);

  // That room is real, already under way, and has the tour's people in it.
  await ann.open('mini');
  assert.deepEqual(await ann.call('mini', 'join', { code: current.code }), { ok: true, code: current.code });
  await until(() => ann.states.mini?.phase === 'playing', 'the opened game to be under way');
  assert.equal(ann.states.mini.players.length, 4, 'the tour\'s four are all at the table');
  assert.equal(ann.states.mini.players.filter((p) => !p.bot).length, 1, 'with the one person among them');

  // When it ends, the tour hears about it by itself and opens a fresh vote.
  assert.equal((await ann.call('mini', 'endIt')).ok, true);
  await until(() => ann.states.tour?.phase === 'voting', 'the tour to come back to a vote');
  assert.equal(ann.states.tour.current, null);
  assert.deepEqual(ann.states.tour.played.map((p) => p.game), ['mini'], 'and remembers what it played');
  assert.equal(ann.states.tour.yourVote, null, 'everybody votes afresh');
});

test('a tour whose table votes to end finishes instead of opening anything', async (t) => {
  const { Person } = await launch(t);
  const ann = await new Person('ann').register();
  const bob = await new Person('bob').register();
  await ann.open('tour');
  await bob.open('tour');

  assert.equal((await ann.call('tour', 'create')).ok, true);
  const { code } = ann.states.tour;
  assert.equal((await bob.call('tour', 'join', { code })).ok, true);
  await until(() => ann.states.tour?.players?.length === 2, 'both people to be in');
  assert.equal((await ann.call('tour', 'start')).ok, true);
  await until(() => ann.states.tour?.phase === 'voting', 'the vote to open');

  // Two people, nobody else: both vote to finish, so nothing is opened at all.
  assert.equal((await ann.call('tour', 'vote', { choice: 'end' })).ok, true);
  assert.equal((await bob.call('tour', 'vote', { choice: 'end' })).ok, true);
  await until(() => ann.states.tour?.phase === 'finished', 'the tour to end');
  assert.deepEqual(ann.states.tour.played, [], 'nothing was played');
  assert.equal((await ann.call('tour', 'again')).ok, true, 'and the host can start another');
  await until(() => ann.states.tour?.phase === 'lobby', 'the tour to go back to its lobby');
});
