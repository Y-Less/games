// A tournament played out through the real room server: the lobby, the tables it opens, the people walking between
// them, the rounds taking themselves in, and the standings at the end.
//
// The game is a stand-in rather than a real one — it starts when it is opened and finishes when it is told to — so
// that what is tested is the running of the evening and not how any game happens to deal.  Everything else is real:
// the room server, the store, the scheduler, and the sockets.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { rosterLayout } from './layout.js';
import { createRoomServer } from './roomServer.js';
import { createRosterRules, hasPlayer, isBot, isHuman, seatOf, withSlot } from './roster.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Lets every timer the room server has set (all of them are due at once) run. */
const settled = async () => {
  for (let i = 0; i < 12; i++) await sleep(5);
};

const isLive = (room) => room.phase !== 'finished';
const makePlayer = (room, base) => ({ ...base, score: 0 });
const roster = createRosterRules({ isLive, minPlayers: 2, maxPlayers: 6, fillTo: 4, makePlayer });

/** The smallest game the room server will accept: it starts when it is opened and finishes when a player says so. */
const standIn = {
  ...roster,
  isLive,
  isHuman,
  isBot,
  hasPlayer,
  seatOf,
  MIN_PLAYERS: 2,
  createRoom: ({ code, hostId, hostName, settings, now }) => {
    const room = { code, hostId, phase: 'lobby', players: [], size: 6, nextBot: 1, recorded: false, settings: { length: 1, ...settings }, createdAt: now, updatedAt: now };
    room.players.push(withSlot(room, makePlayer(room, { kind: 'human', id: hostId, name: hostName })));
    return room;
  },
  setSettings(room, userId, input) {
    if (room.hostId !== userId) return { ok: false, error: 'hostOnly' };
    if (input.length !== undefined) room.settings.length = input.length;
    return { ok: true };
  },
  start(room) {
    room.phase = 'playing';
    return { ok: true };
  },
  playAgain(room) {
    room.phase = 'lobby';
    return { ok: true };
  },
  // Whoever is first in the room won it: enough for standings that can be checked by hand.
  statsPlayers: (room) => room.players.flatMap((player, index) => (isHuman(player) ? [{ userId: player.id, outcome: index === 0 ? 'win' : 'loss', placement: index + 1, score: 10 - index }] : [])),
  viewFor: (room, userId) => ({ code: room.code, phase: room.phase, you: userId, settings: room.settings, players: room.players.map((p) => ({ id: p.id, name: p.name })) }),
};

/** A site of one game, with however many signed-in people connected to it. */
function world(t, people = [1, 2, 3, 4]) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tournament-'));
  const logs = [];
  const recorded = [];
  let next = 0;
  let server;
  const ctx = {
    io: new EventEmitter(),
    dataDir,
    meta: { id: 'standin', minPlayers: 2, maxPlayers: 6 },
    log: (...args) => logs.push(args.map(String).join(' ')),
    codes: { normalise: (raw) => (typeof raw === 'string' ? raw.trim().toLowerCase() : ''), generate: () => `room-${++next}` },
    stats: { record: (result) => recorded.push(result) },
  };
  /** The site's server half, over the same folder each time it is started. */
  const open = () =>
    createRoomServer(ctx, {
      game: standIn,
      pickSettings: (payload) => (payload?.length === undefined ? {} : { length: payload.length }),
      members: (room) => room.players,
      layout: rosterLayout,
      nextAction: () => null,
      registerEvents({ on, act }) {
        on('endIt', () =>
          act((room) => {
            room.phase = 'finished';
            return { ok: true };
          }),
        );
      },
    });
  server = open();
  t.after(() => {
    server.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const sockets = new Map();
  /** Somebody signed in, with a socket that keeps every view it is sent. */
  const connect = (id) => {
    const socket = new EventEmitter();
    socket.data = { user: { id, name: `P${id}` } };
    socket.states = [];
    const emit = socket.emit.bind(socket);
    socket.emit = (event, payload) => (event === 'state' ? socket.states.push(payload) : emit(event, payload));
    socket.ask = (event, payload = {}) => new Promise((resolve) => emit(event, payload, resolve));
    socket.state = () => socket.states.at(-1);
    ctx.io.emit('connection', socket);
    sockets.set(id, socket);
    return socket;
  };
  for (const id of people) connect(id);
  return {
    logs,
    recorded,
    sockets,
    who: (id) => sockets.get(id),
    rooms: () => server.rooms,
    /** The games this person has on the go here, as the site's list of them asks for. */
    games: (id) => server.gamesOf(id),
    /** Stops the site and starts it again over the same folder, as a restart does; everybody connects afresh. */
    restart: () => {
      server.dispose();
      server = open();
      for (const id of [...sockets.keys()]) connect(id);
    },
  };
}

/** A tournament of these people, set up and started: the host makes the room and the rest join by code. */
async function tournament(world, { humans = 2, bots = 2, people = [2, 3, 4], host = 1 } = {}) {
  const made = await world.who(host).ask('create');
  for (const id of people) await world.who(id).ask('join', { code: made.code });
  assert.deepEqual(await world.who(host).ask('settings', { tournament: { on: true, humans, bots } }), { ok: true });
  assert.deepEqual(await world.who(host).ask('start'), { ok: true });
  await settled();
  return made.code;
}

/** The tournament as somebody is currently being shown it. */
const seen = (world, id) => world.who(id).state()?.tournament;
/** The rooms that are tables of this tournament. */
const tables = (world, code) => [...world.rooms().values()].filter((room) => room.inTournament?.code === code);

/** Everybody finishes the table they are at. */
async function finishTables(world, code) {
  for (const table of tables(world, code).filter((room) => room.phase !== 'finished')) {
    const player = table.players.find((p) => isHuman(p));
    await world.who(player.id).ask('join', { code: table.code });
    await world.who(player.id).ask('endIt');
  }
  await settled();
}

/** Everybody still in says they are ready, which is what opens the round waiting to be played. */
async function readyUp(world, code, people = null) {
  const waiting = people ?? (seen(world, [...world.sockets.keys()][0])?.notReady ?? []).map((person) => person.id);
  for (const id of waiting) {
    await world.who(id).ask('join', { code });
    await world.who(id).ask('tournamentReady');
  }
  await settled();
}

/** The round everybody has just finished is taken in, and the next one played: both halves of a round. */
async function playRound(world, code) {
  await finishTables(world, code);
  if (seen(world, [...world.sockets.keys()][0])?.waiting) await readyUp(world, code);
}

test('a tournament opens a table for each pair, with the people drawn for it and the settings it was set up with', async (t) => {
  const site = world(t);
  await site.who(1).ask('create');
  // The game's own settings are chosen in the ordinary lobby, and every table is dealt with them.
  await site.who(1).ask('settings', { length: 3 });
  const code = site.rooms().keys().next().value;
  for (const id of [2, 3, 4]) await site.who(id).ask('join', { code });
  await site.who(1).ask('settings', { tournament: { on: true } });
  assert.deepEqual(await site.who(1).ask('start'), { ok: true });
  await settled();

  const opened = tables(site, code);
  assert.equal(opened.length, 2, 'four people in pairs is two tables at once');
  for (const table of opened) {
    assert.equal(table.players.length, 4, 'two people and two computer players');
    assert.equal(table.players.filter((p) => isHuman(p)).length, 2);
    assert.equal(table.phase, 'playing', 'opened and started');
    assert.equal(table.settings.length, 3, 'with the settings the tournament was set up with');
    assert.deepEqual(table.inTournament.code, code);
  }
  // Everybody is drawn once a round, and the pairs are the ones the tournament says they are.
  const seats = opened.flatMap((table) => table.players.filter((p) => isHuman(p)).map((p) => p.id)).sort();
  assert.deepEqual(seats, [1, 2, 3, 4]);
  assert.equal(seen(site, 1).round, 1);
  assert.equal(seen(site, 1).rounds, 3, 'four people meet each other over three rounds');
});

test('the people walk into their own table, and nobody else may', async (t) => {
  const site = world(t, [1, 2, 3, 4, 5]);
  const code = await tournament(site);
  const mine = seen(site, 1).yourTable;
  assert.ok(mine, 'the tournament says where to go');
  // Walking from the tournament into the table it drew you for is not "you are already in a game".
  assert.deepEqual(await site.who(1).ask('join', { code: mine }), { ok: true, code: mine });
  assert.equal(site.who(1).state().phase, 'playing', 'and the game is what they are shown');
  // ...and back again, without leaving either.
  assert.deepEqual(await site.who(1).ask('join', { code }), { ok: true, code });
  assert.equal(site.who(1).state().tournament.yourTable, mine);

  const theirs = tables(site, code).find((table) => !table.players.some((p) => p.id === 5));
  assert.deepEqual(await site.who(5).ask('join', { code: theirs.code }), { ok: false, error: 'notYourTable' });
  assert.equal(theirs.players.some((p) => p.id === 5), false, 'and no computer player gave up its place to them');
});

test('a round is taken in when its tables have finished, and the next one waits to be readied up for', async (t) => {
  const site = world(t);
  const code = await tournament(site);
  const first = tables(site, code).map((table) => table.code);
  await finishTables(site, code);

  assert.equal(seen(site, 1).round, 2, 'the next round');
  assert.equal(seen(site, 1).waiting, true, 'which is waiting for everybody');
  assert.deepEqual(seen(site, 1).notReady.map((person) => person.id).sort(), [1, 2, 3, 4], 'nobody has said so yet');
  assert.equal(tables(site, code).filter((table) => !first.includes(table.code)).length, 0, 'and nothing is opened meanwhile');

  await readyUp(site, code);
  assert.equal(seen(site, 1).waiting, false);
  const second = tables(site, code).filter((table) => !first.includes(table.code));
  assert.equal(second.length, 2, 'the round opens once the last of them is ready');
  // Nobody meets the same person twice: that is the whole point of drawing the rounds up in advance.
  const met = (id) => tables(site, code).filter((table) => table.players.some((p) => p.id === id)).flatMap((table) => table.players.filter((p) => isHuman(p) && p.id !== id).map((p) => p.id));
  assert.equal(new Set(met(1)).size, met(1).length);
});

test('a round opens only when the last person is ready, and somebody can change their mind', async (t) => {
  const site = world(t);
  const code = await tournament(site);
  const first = tables(site, code).map((table) => table.code);
  await finishTables(site, code);

  for (const id of [1, 2, 3]) {
    await site.who(id).ask('join', { code });
    assert.deepEqual(await site.who(id).ask('tournamentReady'), { ok: true });
  }
  await settled();
  assert.equal(seen(site, 1).readyNow, 3);
  assert.equal(seen(site, 1).readyOf, 4);
  assert.equal(tables(site, code).filter((table) => !first.includes(table.code)).length, 0, 'three of four is not everybody');
  // Said in error, and taken back: the round is no nearer starting.
  assert.deepEqual(await site.who(3).ask('tournamentReady', { ready: false }), { ok: true });
  await settled();
  assert.equal(seen(site, 1).readyNow, 2);
  assert.equal(seen(site, 1).youReady, true, 'and saying so is each person for themselves');

  for (const id of [3, 4]) {
    await site.who(id).ask('join', { code });
    await site.who(id).ask('tournamentReady');
  }
  await settled();
  assert.equal(tables(site, code).filter((table) => !first.includes(table.code)).length, 2);
  // There is nothing to be ready for while the round is being played.
  assert.deepEqual(await site.who(1).ask('tournamentReady'), { ok: false, error: 'tournamentNotWaiting' });
});

test('a tournament waiting between rounds is picked up again after a restart', async (t) => {
  // The point of the gate: a round is played, everybody goes away, and the evening is still there to come back to.
  const site = world(t);
  const code = await tournament(site);
  await finishTables(site, code);
  for (const id of [1, 2]) {
    await site.who(id).ask('join', { code });
    await site.who(id).ask('tournamentReady');
  }
  await settled();

  site.restart();
  await settled();
  await site.who(1).ask('join', { code });
  assert.equal(seen(site, 1).waiting, true, 'still waiting, a restart later');
  assert.equal(seen(site, 1).readyNow, 2, 'and remembers who had said they were ready');
  assert.equal(tables(site, code).length, 2, 'nothing was opened by the restart itself');

  for (const id of [3, 4]) {
    await site.who(id).ask('join', { code });
    await site.who(id).ask('tournamentReady');
  }
  await settled();
  assert.equal(tables(site, code).length, 4, 'and the round opens when the last of them says so');
});

test('the host puts out somebody who never comes back, and the round gets going', async (t) => {
  const site = world(t);
  const code = await tournament(site);
  await finishTables(site, code);
  for (const id of [1, 2, 3]) {
    await site.who(id).ask('join', { code });
    await site.who(id).ask('tournamentReady');
  }
  await settled();
  assert.deepEqual(seen(site, 1).notReady.map((person) => person.id), [4], 'everybody but one');

  await site.who(1).ask('join', { code });
  const theirs = seen(site, 1).entrants.find((person) => person.id === 4);
  assert.deepEqual(await site.who(2).ask('kick', { slot: theirs.slot }), { ok: false, error: 'tournamentHostOnly' }, 'and not by anybody who feels like it');
  assert.deepEqual(await site.who(1).ask('kick', { slot: theirs.slot }), { ok: true });
  await settled();

  assert.equal(tables(site, code).length > 2, true, 'the round opened once they were out of it');
  assert.equal(seen(site, 1).readyOf, 3, 'and it is three people now');
  assert.ok(seen(site, 1).standings.some((row) => row.id === 4), 'though what they played still counts');
});

test('a person who leaves while a round is waiting is not waited for', async (t) => {
  const site = world(t);
  const code = await tournament(site);
  await finishTables(site, code);
  await site.who(4).ask('join', { code });
  assert.deepEqual(await site.who(4).ask('leave'), { ok: true });
  await settled();

  assert.equal(seen(site, 1).readyOf, 3, 'three left to be ready');
  assert.equal(seen(site, 1).notReady.some((person) => person.id === 4), false);
  for (const id of [1, 2, 3]) {
    await site.who(id).ask('join', { code });
    await site.who(id).ask('tournamentReady');
  }
  await settled();
  assert.equal(seen(site, 1).waiting, false, 'and the three of them are everybody');
});

test('a person reading the scores of the table they have just finished is told the next round is waiting', async (t) => {
  const site = world(t);
  const code = await tournament(site);
  const mine = seen(site, 1).yourTable;
  await site.who(1).ask('join', { code: mine });
  await finishTables(site, code);
  // They are still looking at the finished game, which has not changed; the tournament around it has.
  const state = site.who(1).state();
  assert.equal(state.code, mine, 'still at the table they played');
  assert.equal(state.tournament.here, mine);
  assert.equal(state.tournament.waiting, true, 'and they are asked, where they are, to say they are ready');
  assert.equal(state.tournament.youReady, false);

  // Said from the table they are sitting at, without going back to the tournament first.
  assert.deepEqual(await site.who(1).ask('tournamentReady'), { ok: true }, 'from where they are sitting');
  assert.equal(site.who(1).state().tournament.youReady, true, 'and they are told so where they are sitting');
  await readyUp(site, code);
  const after = site.who(1).state();
  assert.ok(after.tournament.yourTable && after.tournament.yourTable !== mine, 'and then the next table is named');
});

test('the standings add up, and the tournament ends when every pair has played', async (t) => {
  const site = world(t);
  const code = await tournament(site);
  for (let round = 0; round < 3; round++) await playRound(site, code);

  const tournamentRoom = site.rooms().get(code);
  assert.equal(tournamentRoom.phase, 'finished');
  const standings = seen(site, 1).standings;
  assert.equal(standings.length, 4);
  assert.deepEqual(standings.map((row) => row.played), [3, 3, 3, 3], 'everybody played every round');
  assert.equal(standings.reduce((total, row) => total + row.wins, 0), 6, 'six tables were won');
  // The standings are read out best first, and the places never go backwards.
  assert.deepEqual([...standings].sort((a, b) => b.wins - a.wins).map((row) => row.id), standings.map((row) => row.id));
  assert.equal(standings[0].place, 1);
  for (const [index, row] of standings.entries()) assert.ok(row.place <= index + 1 && row.place >= standings[Math.max(0, index - 1)].place, `row ${index} is placed ${row.place}`);
  // A tournament is not a game: its tables are what the statistics hear about.
  assert.equal(site.recorded.some((result) => result.code === code), false);
  assert.equal(site.recorded.length, 6, 'one for each table');
  // An evening is drawn up once and played once: neither a table (its result is counted) nor the tournament itself
  // is played again.
  assert.deepEqual(await site.who(1).ask('again'), { ok: false, error: 'tournamentNoAgain' }, 'not the table they are at');
  await site.who(1).ask('join', { code });
  assert.deepEqual(await site.who(1).ask('again'), { ok: false, error: 'tournamentNoAgain' }, 'and not the tournament');
});

test('a table everybody walks out of does not hold the evening up', async (t) => {
  const site = world(t);
  const code = await tournament(site);
  const [one, two] = tables(site, code);
  // One table finishes; the other is abandoned by everybody in it, which throws the room away.
  const player = one.players.find((p) => isHuman(p));
  await site.who(player.id).ask('join', { code: one.code });
  await site.who(player.id).ask('endIt');
  for (const person of two.players.filter((p) => isHuman(p))) {
    await site.who(person.id).ask('join', { code: two.code });
    await site.who(person.id).ask('leave');
  }
  await settled();

  assert.equal(site.rooms().has(two.code), false, 'the abandoned room is gone');
  assert.equal(seen(site, player.id).round, 2, 'and the round moved on without it');
  assert.equal(seen(site, player.id).waiting, true, 'to wait for everybody as usual');
});

test('somebody who leaves the tournament keeps what they played and is taken out of what is left', async (t) => {
  const site = world(t, [1, 2, 3, 4]);
  const code = await tournament(site);
  await finishTables(site, code);
  assert.deepEqual(await site.who(4).ask('join', { code }), { ok: true, code });
  assert.deepEqual(await site.who(4).ask('leave'), { ok: true });
  await settled();

  const tournamentRoom = site.rooms().get(code);
  const toCome = tournamentRoom.tournament.rounds.slice(tournamentRoom.tournament.round + 1).flat();
  assert.equal(toCome.some((group) => group.includes(4)), false, 'no table still to come has them at it');
  assert.ok(seen(site, 1).standings.some((row) => row.id === 4 && row.played === 1), 'but the table they played still counts');
});

test('a tournament lobby is the tournament, not the game: no computer players, and nothing of the game is played in it', async (t) => {
  const site = world(t);
  const made = await site.who(1).ask('create');
  await site.who(2).ask('join', { code: made.code });
  await site.who(1).ask('settings', { tournament: { on: true } });
  assert.deepEqual(await site.who(1).ask('addBot'), { ok: false, error: 'tournamentNoBots' });
  assert.deepEqual(await site.who(1).ask('fillBots', { count: 4 }), { ok: false, error: 'tournamentNoBots' });
  // The game's own settings are the ones chosen before the tournament was switched on, since its lobby is not on
  // screen afterwards: changing them means switching the tournament off first.
  assert.deepEqual(await site.who(1).ask('settings', { length: 5 }), { ok: false, error: 'tournamentSettingsFirst' });
  assert.deepEqual(await site.who(1).ask('start'), { ok: true });
  await settled();
  // The game's own events belong to the tables, not to the room the tournament is run from.
  assert.deepEqual(await site.who(1).ask('endIt'), { ok: false, error: 'tournamentRunning' });
});

test('a tournament that was half way through a round carries on after a restart', async (t) => {
  // Nothing about an evening is held in memory: the schedule, the round, the tables and the standings are all on the
  // room, and the opening and the taking in are what the server owes it rather than something a message does.  So a
  // site that stops between the two picks up where it left off.
  const site = world(t);
  const code = await tournament(site);
  const first = tables(site, code).map((table) => table.code);
  assert.equal(first.length, 2);

  site.restart();
  await settled();
  assert.deepEqual(tables(site, code).map((table) => table.code).sort(), [...first].sort(), 'the same tables, not a fresh set');

  await finishTables(site, code);
  await site.who(1).ask('join', { code });
  assert.equal(site.who(1).state().tournament.round, 2, 'and the round was taken in as usual');
});

test('a tournament whose first round was never opened opens it when the site comes back', async (t) => {
  const site = world(t);
  const made = await site.who(1).ask('create');
  for (const id of [2, 3, 4]) await site.who(id).ask('join', { code: made.code });
  await site.who(1).ask('settings', { tournament: { on: true } });
  // Started, and stopped before the server had opened anything: the tables are owed, not lost.
  assert.deepEqual(await site.who(1).ask('start'), { ok: true });
  site.restart();
  await settled();
  assert.equal(tables(site, made.code).length, 2);
});

test('the list of your games gives a tournament one line, and the table it drew you for none of its own', async (t) => {
  // The site's list is how somebody comes back days later, so what it holds is what there is to come back to.  A
  // table is reached through the tournament that opened it (`yourTable`), and a line of its own would be the same
  // game offered twice over.
  const site = world(t);
  const code = await tournament(site);

  const [row, ...rest] = site.games(1);
  assert.deepEqual(rest, [], 'one evening, one line');
  assert.equal(row.kind, 'tournament');
  assert.equal(row.code, code, 'the tournament, not the table');
  assert.equal(row.round, 1);
  assert.ok(tables(site, code).some((table) => table.code === row.yourTable), 'with the table it drew you for');

  // An ordinary game of the same thing sits beside it: neither crowds the other out.
  const made = await site.who(1).ask('create');
  assert.deepEqual(site.games(1).map((line) => line.kind), ['game', 'tournament'], 'the newer news first');
  assert.equal(site.games(1)[0].code, made.code);
});

test('leaving one game of several takes that one off your list and leaves the rest where they were', async (t) => {
  const site = world(t);
  const first = await site.who(1).ask('create');
  const second = await site.who(1).ask('create');
  await site.who(2).ask('join', { code: first.code });
  assert.deepEqual([...site.games(1).map((row) => row.code)].sort(), [first.code, second.code].sort(), 'both are hers');
  assert.deepEqual(site.games(1).find((row) => row.code === first.code).others, ['P2'], 'and one of them has company');

  await site.who(1).ask('resume', { code: first.code });
  assert.deepEqual(await site.who(1).ask('leave'), { ok: true });
  assert.deepEqual(site.games(1).map((row) => row.code), [second.code], 'the game she left is no longer offered back');
  assert.deepEqual(site.games(2).map((row) => row.code), [first.code], 'and the person still in it is not disturbed');
  assert.deepEqual(site.games(2)[0].others, [], 'though they are playing alone now');
});

test('the list has a way back into whatever room opening the game afresh would give you', async (t) => {
  // Since the menu starts a game rather than resuming one, this list is the only way back into a room.  Whatever
  // `resume` with no code would give somebody — which is the game they were last doing something in — the list must
  // name, in every state an evening passes through.
  const site = world(t);
  const listed = async (id) => {
    const back = await site.who(id).ask('resume', {});
    return site.games(id).some((row) => row.code === back.code || row.yourTable === back.code);
  };

  const made = await site.who(1).ask('create');
  assert.equal(await listed(1), true, 'a lobby of their own');

  // A tournament being set up is still a lobby, and the people gathering in it have nothing else to come back to.
  for (const id of [2, 3, 4]) await site.who(id).ask('join', { code: made.code });
  await site.who(1).ask('settings', { tournament: { on: true } });
  assert.deepEqual(site.games(1).map((row) => row.kind), ['game'], 'a tournament nobody has started is an ordinary lobby');
  assert.equal(await listed(1), true, 'the host of a tournament not yet started');
  assert.equal(await listed(3), true, 'and somebody who only joined it');

  await site.who(1).ask('start');
  await settled();
  assert.equal(await listed(1), true, 'a round being played');

  await finishTables(site, made.code);
  assert.equal(await listed(1), true, 'a round waiting to be readied up for');
});

test('a tournament played to its end is no longer something to come back to', async (t) => {
  const site = world(t);
  const code = await tournament(site);
  for (let round = 0; round < 3; round++) await playRound(site, code);

  assert.equal(site.rooms().get(code).phase, 'finished');
  assert.deepEqual(site.games(1), [], 'neither the tournament nor the tables it finished with');
});

test('a tournament of one person is refused, and the lobby is left as it was', async (t) => {
  const site = world(t, [1]);
  await site.who(1).ask('create');
  await site.who(1).ask('settings', { tournament: { on: true } });
  assert.deepEqual(await site.who(1).ask('start'), { ok: false, error: 'tournamentNeedsPeople', params: { min: 2 } });
  assert.equal(site.who(1).state().phase, 'lobby');
  assert.equal(site.who(1).state().tournament.on, true);
});
