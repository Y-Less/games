// What can happen to a room apart from anybody asking for it (shared/roomLife.js): who is looking at it, who is told
// when it changes, how somebody gets into one, and how it ends.  shared/roomServer.test.js reaches some of this through
// the socket protocol (the sweep, a finished game being recorded once, a room that keeps failing); this file takes the
// protocol away and tests the life underneath it directly.  What is protected here:
//
//   - `enter` puts a socket in exactly the room it should be in, and a person in only one game under way at a time;
//   - a change is stamped, saved, and shown to everybody looking, each seeing their own view, built once per person;
//   - somebody who leaves, is voted out, or whose room is discarded is sent back to the menu and gets nothing more;
//   - nothing the game's own hooks throw stops the room being saved and shown.
//
// The rules here are a stand-in that knows only what a room's life asks of a game; the list family's layout is real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { workspace } from '../server/fixtures/testkit.js';
import { rosterLayout, withSlot } from './layout.js';
import { seeded } from './random.js';
import { createRoomLife } from './roomLife.js';
import { until } from './testkit.js';

const CODES = ['a-b-c', 'd-e-f', 'g-h-i'];
/** How many people the stand-in game seats. */
const SEATS = 3;

/** The stand-in rules: a list of players, a lobby anybody may join until it is full, and nothing else. */
function rules(calls) {
  return {
    isLive: (room) => room.phase !== 'finished',
    isHuman: (member) => member?.kind === 'human',
    hasPlayer: (room, id) => room.players.some((p) => p.kind === 'human' && p.id === id),
    viewFor: (room, id, options) => {
      calls.push({ what: 'viewFor', code: room.code, id, options });
      return { code: room.code, phase: room.phase, you: id, players: room.players.map((p) => p.id), away: room.players.filter((p) => p.kind === 'human' && !options.online(p.id)).map((p) => p.id), note: room.note, extra: options.extra };
    },
    addHuman: (room, id, name, extras) => {
      calls.push({ what: 'addHuman', code: room.code, id, name, extras });
      if (room.phase === 'finished') return { ok: false, error: 'gameOver' };
      if (room.barred?.includes(id)) return { ok: false, error: 'putOutOfThisGame' };
      if (room.players.length >= SEATS) return { ok: false, error: 'roomFull' };
      room.players.push(withSlot(room, { kind: 'human', id, name, ...extras }));
      return { ok: true };
    },
    removeHuman: (room, id) => {
      calls.push({ what: 'removeHuman', code: room.code, id });
      const index = room.players.findIndex((p) => p.kind === 'human' && p.id === id);
      if (index === -1) return { ok: false, error: 'notInThisGame' };
      if (room.phase === 'finished') return { ok: true, empty: false, changed: false }; // the standings keep everybody
      if (room.phase === 'playing') room.players[index] = { ...room.players[index], kind: 'bot', id: `bot:${id}` };
      else room.players.splice(index, 1);
      return { ok: true, empty: !room.players.some((p) => p.kind === 'human') };
    },
    statsPlayers: (room) => room.players.map((p) => ({ userId: p.id })),
  };
}

/** The life of a game's rooms over a temporary folder, with a clock and a log a test can read. */
function world(t, options = {}) {
  const { dir, track } = workspace(t, 'roomlife-');
  const calls = [];
  const logs = [];
  const state = { clock: 1_000_000, nextAction: null, afterChange: null };
  const game = rules(calls);
  const ctx = {
    dataDir: dir,
    log: (...args) => logs.push(args.map(String).join(' ')),
    codes: { normalise: (raw) => (typeof raw === 'string' && /^[a-z]-[a-z]-[a-z]$/.test(raw.trim().toLowerCase()) ? raw.trim().toLowerCase() : '') },
    stats: { record: (...args) => options.record?.(...args) },
  };
  const rng = seeded(1);
  const now = () => state.clock;
  const open = () =>
    createRoomLife({
      ctx,
      game,
      members: (room) => room.players,
      layout: rosterLayout,
      viewOptions: options.viewOptions ?? (() => ({})),
      afterChange: (room) => state.afterChange?.(room),
      playerExtras: options.playerExtras ?? (() => ({})),
      nextAction: (...args) => state.nextAction?.(...args) ?? null,
      rng,
      now,
    });
  const it = { life: open(), calls, logs, state, game, rng, now };
  track({ close: () => it.life.dispose() });
  /** Stops the site and starts it again over the same folder. */
  it.restart = () => {
    it.life.dispose();
    it.life = open();
    return it.life;
  };
  /** A room with these people in it, kept by the life as the protocol's `create` would. */
  it.room = (code, ids = [], extra = {}) => {
    const room = { code, phase: 'lobby', updatedAt: state.clock, players: [], ...extra };
    for (const id of ids) room.players.push(withSlot(room, typeof id === 'number' ? { kind: 'human', id, name: `User ${id}` } : { kind: 'bot', id, name: id }));
    it.life.keep(room);
    return room;
  };
  /** A connected socket for an account, which records everything it is sent. */
  it.socket = (id) => {
    const socket = { data: { user: { id, name: `User ${id}` } }, sent: [], emit: (event, payload) => socket.sent.push({ event, payload }) };
    socket.states = () => socket.sent.filter((message) => message.event === 'state').map((message) => message.payload);
    it.life.addSocket(id, socket);
    return socket;
  };
  return it;
}

// ---- getting into a room ----

test('a room that has been kept is found by its code, and its code is taken', (t) => {
  const { life, room } = world(t);
  const made = room('a-b-c', [1]);
  assert.equal(life.roomAt('a-b-c'), made);
  assert.equal(life.rooms.get('a-b-c'), made);
  assert.equal(life.taken('a-b-c'), true);
  assert.equal(life.taken('d-e-f'), false);
  assert.equal(life.roomAt('d-e-f'), undefined);
});

test('somebody with no game under way and no code is shown the menu', (t) => {
  const { life, socket } = world(t);
  const ann = socket(1);
  assert.deepEqual(life.enter(ann, undefined), { ok: true, code: null });
  assert.deepEqual(ann.states(), [null]);
  assert.equal(ann.data.code, null);
});

test('something that is not an invite code is refused as such, before any room is looked for', (t) => {
  const { life, room, socket, calls } = world(t);
  room('a-b-c', [2]);
  const ann = socket(1);
  for (const raw of ['not a code', 'a-b', 12345, { code: 'a-b-c' }, ['a-b-c'], true]) {
    assert.deepEqual(life.enter(ann, raw), { ok: false, error: 'notAnInviteCode' }, String(raw));
  }
  assert.equal(ann.data.code, null);
  assert.deepEqual(calls.filter((call) => call.what === 'addHuman'), []);
});

test('a code no room has is refused, and the socket is shown the menu', (t) => {
  const { life, socket } = world(t);
  const ann = socket(1);
  assert.deepEqual(life.enter(ann, 'd-e-f'), { ok: false, error: 'noGameWithCode' });
  assert.deepEqual(ann.states(), [null]);
});

test('a code as typed is normalised before it is looked up', (t) => {
  const { life, room, socket } = world(t);
  room('a-b-c', [2]);
  const ann = socket(1);
  assert.deepEqual(life.enter(ann, '  A-B-C '), { ok: true, code: 'a-b-c' });
});

test('joining by code adds the person with their name and what the server knows of them, and shows everybody the room', (t) => {
  const { life, room, socket, calls, state } = world(t, { playerExtras: (id) => ({ colour: `colour of ${id}` }) });
  const made = room('a-b-c', [2]);
  const bob = socket(2);
  life.enter(bob, 'a-b-c');
  bob.sent.length = 0;
  state.clock += 500;
  const ann = socket(1);
  assert.deepEqual(life.enter(ann, 'a-b-c'), { ok: true, code: 'a-b-c' });
  assert.deepEqual(calls.filter((call) => call.what === 'addHuman'), [{ what: 'addHuman', code: 'a-b-c', id: 1, name: 'User 1', extras: { colour: 'colour of 1' } }]);
  assert.equal(ann.data.code, 'a-b-c');
  assert.deepEqual(ann.states().at(-1).players, [2, 1]);
  assert.equal(ann.states().at(-1).you, 1, 'each person is sent their own view');
  assert.deepEqual(bob.states().at(-1).players, [2, 1], 'whoever was already there sees the newcomer');
  assert.equal(bob.states().at(-1).you, 2);
  assert.equal(made.updatedAt, state.clock, 'joining is a change, and the room is stamped with it');
});

test('somebody already in a room walks back into it without being added again', (t) => {
  const { life, room, socket, calls } = world(t);
  room('a-b-c', [1, 2], { phase: 'finished' }); // even a finished one, given its code
  const ann = socket(1);
  assert.deepEqual(life.enter(ann, 'a-b-c'), { ok: true, code: 'a-b-c' });
  assert.equal(ann.data.code, 'a-b-c');
  assert.equal(ann.states().at(-1).code, 'a-b-c');
  assert.deepEqual(calls.filter((call) => call.what === 'addHuman'), []);
});

test('with no code, a person is put back in the game they have under way', (t) => {
  const { life, room, socket } = world(t);
  room('a-b-c', [1, 2], { phase: 'playing' });
  const ann = socket(1);
  assert.deepEqual(life.enter(ann, undefined), { ok: true, code: 'a-b-c' });
  assert.equal(ann.data.code, 'a-b-c');
  assert.equal(ann.states().at(-1).code, 'a-b-c');
});

test('a finished game is not resumed without its code: coming back from the menu starts afresh', (t) => {
  const { life, room, socket } = world(t);
  room('a-b-c', [1, 2], { phase: 'finished' });
  const ann = socket(1);
  assert.deepEqual(life.enter(ann, undefined), { ok: true, code: null });
  assert.deepEqual(ann.states(), [null]);
});

test('a person with a game under way cannot join another: they are told which, and shown their own', (t) => {
  const { life, room, socket, calls } = world(t);
  room('a-b-c', [1, 2], { phase: 'playing' });
  const other = room('d-e-f', [3]);
  const ann = socket(1);
  assert.deepEqual(life.enter(ann, 'd-e-f'), { ok: false, error: 'alreadyInGameJoin', params: { code: 'a-b-c' } });
  assert.equal(ann.data.code, 'a-b-c');
  assert.equal(ann.states().at(-1).code, 'a-b-c');
  assert.deepEqual(other.players.map((p) => p.id), [3], 'and they were not added to the other');
  assert.deepEqual(calls.filter((call) => call.what === 'addHuman'), []);
});

test('a room the rules will not let somebody into answers with the rules’ own refusal, and shows them the menu', (t) => {
  const { life, room, socket } = world(t);
  const full = room('a-b-c', [2, 3, 4]);
  const ann = socket(1);
  assert.deepEqual(life.enter(ann, 'a-b-c'), { ok: false, error: 'roomFull' });
  assert.deepEqual(ann.states(), [null]);
  assert.equal(ann.data.code, null);
  assert.deepEqual(full.players.map((p) => p.id), [2, 3, 4]);
});

test('a stranger arriving at a game that is over is told it has finished, whatever the rules called it', (t) => {
  const { life, room, socket } = world(t);
  room('a-b-c', [2, 3], { phase: 'finished' });
  const ann = socket(1);
  assert.deepEqual(life.enter(ann, 'a-b-c'), { ok: false, error: 'thatGameFinished' });
  assert.deepEqual(ann.states(), [null]);
});

test('a room nobody was let into is not stamped as changed', (t) => {
  const { life, room, socket, state } = world(t);
  const full = room('a-b-c', [2, 3, 4]);
  state.clock += 5000;
  life.enter(socket(1), 'a-b-c');
  assert.equal(full.updatedAt, state.clock - 5000);
});

for (const [name, how] of [
  ['asks to resume with no code', (life, socket) => life.enter(socket, undefined)],
  ['gives a code no room has', (life, socket) => life.enter(socket, 'x-y-z')],
  ['is refused by another room', (life, socket) => life.enter(socket, 'd-e-f')],
]) {
  test(
    `a socket looking at a finished game that ${name} is shown the menu, and from then on is at the menu`,
    (t) => {
      const { life, room, socket } = world(t);
      const finished = room('a-b-c', [1, 2], { phase: 'finished' });
      room('d-e-f', [3, 4, 5]); // full
      const ann = socket(1);
      const bob = socket(2);
      life.enter(ann, 'a-b-c');
      life.enter(bob, 'a-b-c');
      how(life, ann);
      assert.equal(ann.states().at(-1), null, 'shown the menu');
      assert.equal(ann.data.code, null, 'a socket’s code is the room it is looking at, or null for the menu');
      life.push(finished);
      assert.equal(ann.states().at(-1), null, 'and is not sent the room it was taken away from');
      assert.deepEqual(bob.states().at(-1).away, [1], 'nor counted as still there');
    },
  );
}

test('statistics that cannot be recorded are logged, and the finished game is still saved and shown', (t) => {
  const { life, room, socket, logs, restart } = world(t, { record: () => { throw new Error('the statistics are down'); } });
  const made = room('a-b-c', [1, 2], { phase: 'playing' });
  const ann = socket(1);
  life.enter(ann, undefined);
  made.phase = 'finished';
  assert.doesNotThrow(() => life.changed(made));
  assert.ok(logs.some((line) => line.includes('the statistics are down')), `logged: ${logs.join(' | ')}`);
  assert.equal(ann.states().at(-1).phase, 'finished');
  assert.equal(restart().roomAt('a-b-c').phase, 'finished');
});

test('the game somebody has under way is found, and one that has finished is not it', (t) => {
  const { life, room } = world(t);
  room('a-b-c', [1, 2], { phase: 'finished' });
  assert.equal(life.liveRoomOf(1), undefined);
  const playing = room('d-e-f', [1, 3], { phase: 'playing' });
  assert.equal(life.liveRoomOf(1), playing);
  assert.equal(life.liveRoomOf(2), undefined);
  assert.equal(life.liveRoomOf(99), undefined);
});

// ---- telling people ----

test('a view is built once per person, not once per tab, and nobody who is not looking has one built', (t) => {
  const { life, room, socket, calls } = world(t);
  const made = room('a-b-c', [1, 2, 'bot:1'], { phase: 'playing' });
  const tabs = [socket(1), socket(1)];
  for (const tab of tabs) life.enter(tab, undefined);
  calls.length = 0;
  for (const tab of tabs) tab.sent.length = 0;
  life.push(made);
  const built = calls.filter((call) => call.what === 'viewFor');
  assert.deepEqual(built.map((call) => call.id), [1], 'one view for Ann’s two tabs; none for Bob, who is away, or the computer player');
  assert.equal(tabs[0].states().length, 1);
  assert.equal(tabs[1].states().length, 1);
  assert.equal(tabs[0].states()[0], tabs[1].states()[0], 'both tabs were sent the one view');
});

test('a view is handed a way to ask who is connected, and whatever the game’s own view options add', (t) => {
  const asked = [];
  const { life, room, socket, state } = world(t, { viewOptions: (...args) => (asked.push(args), { extra: `for ${args[1]}` }) });
  const made = room('a-b-c', [1, 2, 3], { phase: 'playing' });
  const ann = socket(1);
  const bob = socket(2);
  life.enter(ann, undefined);
  life.enter(bob, undefined);
  assert.deepEqual(ann.states().at(-1).away, [3], 'Cat has no socket on the room');
  assert.equal(ann.states().at(-1).extra, 'for 1');
  assert.equal(bob.states().at(-1).extra, 'for 2');
  const [forRoom, forId, clock] = asked.at(-1);
  assert.equal(forRoom, made);
  assert.equal(forId, 2);
  assert.equal(clock(), state.clock, 'the options are given the server’s clock');
});

test('a tab closing is noticed: once somebody’s last socket has gone they are shown as away', (t) => {
  const { life, room, socket } = world(t);
  const made = room('a-b-c', [1, 2], { phase: 'playing' });
  const ann = socket(1);
  const bobTabs = [socket(2), socket(2)];
  life.enter(ann, undefined);
  for (const tab of bobTabs) life.enter(tab, undefined);
  life.dropSocket(2, bobTabs[0]);
  life.push(made);
  assert.deepEqual(ann.states().at(-1).away, [], 'Bob still has a tab open');
  life.dropSocket(2, bobTabs[1]);
  life.push(made);
  assert.deepEqual(ann.states().at(-1).away, [2]);
  const sentToClosed = bobTabs[1].sent.length;
  life.push(made);
  assert.equal(bobTabs[1].sent.length, sentToClosed, 'and a socket that has gone is sent nothing more');
});

test('a vote running in the room is carried in everybody’s view, named by slot, and a view with no vote has none', (t) => {
  const { life, room, socket } = world(t);
  const made = room('a-b-c', [1, 2, 3], { phase: 'playing' });
  const ann = socket(1);
  const cat = socket(3);
  life.enter(ann, undefined);
  life.enter(cat, undefined);
  assert.equal('vote' in ann.states().at(-1), false, 'a view nobody is being voted out of is untouched');
  assert.deepEqual(life.votes.ask(made, 1, 's2'), { ok: true });
  life.push(made);
  assert.equal(ann.states().at(-1).vote.target, 's2', 'the person named the way the game names them');
  assert.equal(ann.states().at(-1).vote.by, 's0');
  assert.equal(ann.states().at(-1).vote.mine, true);
  assert.equal(cat.states().at(-1).vote.mine, false, 'each person is shown the vote as it is for them');
  assert.equal(ann.states().at(-1).players.length, 3, 'and the rest of the view is still there');
});

test('an event relayed to a room reaches every socket looking at it, except those of whoever is left out', (t) => {
  const { life, room, socket } = world(t);
  const made = room('a-b-c', [1, 2, 3, 'bot:1'], { phase: 'playing' });
  room('d-e-f', [4], { phase: 'playing' });
  const annTabs = [socket(1), socket(1)];
  const bob = socket(2);
  const catAtMenu = socket(3); // in the room, but not looking at it
  const dan = socket(4); // looking at another room
  for (const tab of [...annTabs, bob, dan]) life.enter(tab, undefined);
  const payload = { ops: [1, 2, 3] };
  const strokes = (who) => who.sent.filter((message) => message.event === 'draw').map((message) => message.payload);
  life.relay(made, 'draw', payload);
  assert.deepEqual([...annTabs, bob].map(strokes), [[payload], [payload], [payload]]);
  assert.deepEqual([catAtMenu, dan].map(strokes), [[], []]);
  life.relay(made, 'draw', payload, { except: 1 });
  assert.deepEqual([...annTabs, bob].map((who) => strokes(who).length), [1, 1, 2], 'the one who drew it is not sent it back, on any tab');
});

// ---- a change ----

test('a change stamps the room, runs the game’s hook before anybody is shown it, and shows everybody looking', (t) => {
  const { life, room, socket, state } = world(t);
  const made = room('a-b-c', [1, 2], { phase: 'playing' });
  const ann = socket(1);
  const bob = socket(2);
  life.enter(ann, undefined);
  life.enter(bob, undefined);
  state.clock += 777;
  state.afterChange = (changedRoom) => { changedRoom.note = 'an achievement'; };
  made.phase = 'guessing';
  life.changed(made);
  assert.equal(made.updatedAt, state.clock);
  for (const who of [ann, bob]) {
    assert.equal(who.states().at(-1).phase, 'guessing');
    assert.equal(who.states().at(-1).note, 'an achievement', 'what the hook did is in the view that was sent');
  }
});

test('a hook that throws is logged and ignored: the room is still shown, saved, and scheduled', (t) => {
  const { life, room, socket, state, logs, restart } = world(t);
  const made = room('a-b-c', [1, 2], { phase: 'playing' });
  const ann = socket(1);
  life.enter(ann, undefined);
  let scheduled = 0;
  state.nextAction = () => (scheduled++, null);
  state.afterChange = () => { throw new Error('the hook fell over'); };
  made.phase = 'guessing';
  assert.doesNotThrow(() => life.changed(made));
  assert.ok(logs.some((line) => line.includes('the hook fell over')), `logged: ${logs.join(' | ')}`);
  assert.equal(ann.states().at(-1).phase, 'guessing');
  assert.equal(scheduled, 1);
  state.afterChange = null;
  assert.equal(restart().roomAt('a-b-c').phase, 'guessing', 'and it was saved');
});

test('a change is saved: after a restart the room is as it was left, and its people can walk back in', (t) => {
  const { life, room, socket, state, restart } = world(t);
  const made = room('a-b-c', [1, 2], { phase: 'playing' });
  made.note = 'left like this';
  state.clock += 10;
  life.changed(made);
  const again = restart();
  assert.deepEqual(again.roomAt('a-b-c'), made);
  assert.notEqual(again.roomAt('a-b-c'), made, 'read back from disk, not handed over in memory');
  const ann = { data: { user: { id: 1, name: 'User 1' } }, sent: [], emit: (event, payload) => ann.sent.push({ event, payload }) };
  again.addSocket(1, ann);
  assert.deepEqual(again.enter(ann, undefined), { ok: true, code: 'a-b-c' }, 'who is in which room is known again from the rooms themselves');
});

test('after a change the game is asked what the server owes the room, with the random source, the clock, who is connected, and a way to relay', (t) => {
  const { life, room, socket, state, rng, now } = world(t);
  const made = room('a-b-c', [1, 2], { phase: 'playing' });
  const ann = socket(1);
  life.enter(ann, undefined);
  const asked = [];
  state.nextAction = (...args) => (asked.push(args), null);
  life.changed(made);
  assert.equal(asked.length, 1);
  const [forRoom, random, clock, who] = asked[0];
  assert.equal(forRoom, made);
  assert.equal(random, rng);
  assert.equal(clock, now);
  assert.equal(who.online(1), true);
  assert.equal(who.online(2), false);
  who.relay(made, 'draw', { ops: [] });
  assert.deepEqual(ann.sent.at(-1), { event: 'draw', payload: { ops: [] } });
});

test('what the server owes a room is done by itself, and the room is then changed like any other: stamped, shown, and asked again', async (t) => {
  const { life, room, socket, state } = world(t);
  const made = room('a-b-c', [1, 2], { phase: 'playing' });
  const ann = socket(1);
  life.enter(ann, undefined);
  state.nextAction = (owedRoom) => (owedRoom.phase === 'playing' ? { wait: 1, run: () => { owedRoom.phase = 'guessing'; } } : null);
  state.clock += 99;
  life.reschedule(made);
  await until(() => made.phase === 'guessing', 'the scheduled move to run');
  assert.equal(made.updatedAt, state.clock);
  assert.equal(ann.states().at(-1).phase, 'guessing');
});

test('rooms loaded at start-up are each asked what they are owed, so a game does not stall across a restart', (t) => {
  const { room, state, restart, life } = world(t);
  life.changed(room('a-b-c', [1], { phase: 'playing' }));
  life.changed(room('d-e-f', [2], { phase: 'playing' }));
  const asked = [];
  state.nextAction = (owedRoom) => (asked.push(owedRoom.code), null);
  restart();
  assert.deepEqual(asked.sort(), ['a-b-c', 'd-e-f']);
});

// ---- leaving, being put out, and the end of a room ----

test('somebody leaving a game under way is sent to the menu on every tab, and the others see who took their place', (t) => {
  const { life, room, socket, state } = world(t);
  const made = room('a-b-c', [1, 2], { phase: 'playing' });
  const annTabs = [socket(1), socket(1)];
  const bob = socket(2);
  for (const tab of [...annTabs, bob]) life.enter(tab, undefined);
  state.clock += 50;
  assert.deepEqual(life.leaveRoom(made, 1), { ok: true, empty: false });
  for (const tab of annTabs) {
    assert.equal(tab.states().at(-1), null);
    assert.equal(tab.data.code, null);
  }
  assert.deepEqual(bob.states().at(-1).players, ['bot:1', 2]);
  assert.equal(made.updatedAt, state.clock);
  assert.equal(life.liveRoomOf(1), undefined, 'and they are free to start another game');
  const sent = annTabs[0].sent.length;
  life.changed(made);
  assert.equal(annTabs[0].sent.length, sent, 'the leaver hears nothing more of the room');
});

test('a leaving the rules refuse changes nothing and sends nobody anywhere', (t) => {
  const { life, room, socket, state } = world(t);
  const made = room('a-b-c', [1, 2], { phase: 'playing' });
  const ann = socket(1);
  life.enter(ann, undefined);
  const sent = ann.sent.length;
  state.clock += 50;
  assert.deepEqual(life.leaveRoom(made, 99), { ok: false, error: 'notInThisGame' });
  assert.equal(ann.sent.length, sent);
  assert.equal(ann.data.code, 'a-b-c');
  assert.equal(made.updatedAt, state.clock - 50);
});

test('the last person leaving discards the room: its code is free again, and it does not come back after a restart', (t) => {
  const { life, room, socket, restart } = world(t);
  const made = room('a-b-c', [1]);
  life.changed(made);
  const ann = socket(1);
  life.enter(ann, 'a-b-c');
  assert.deepEqual(life.leaveRoom(made, 1), { ok: true, empty: true });
  assert.equal(ann.states().at(-1), null);
  assert.equal(life.taken('a-b-c'), false);
  assert.equal(life.rooms.size, 0);
  assert.equal(restart().taken('a-b-c'), false);
});

test('leaving every room takes a person out of each one they are in, except the one they are on their way into', (t) => {
  const { life, room, calls } = world(t);
  const lobby = room('a-b-c', [1, 2]);
  const kept = room('d-e-f', [1, 3]);
  const untouched = room('g-h-i', [2, 3]);
  life.leaveAllRooms(1, kept);
  assert.deepEqual(lobby.players.map((p) => p.id), [2]);
  assert.deepEqual(kept.players.map((p) => p.id), [1, 3]);
  assert.deepEqual(untouched.players.map((p) => p.id), [2, 3]);
  assert.deepEqual(calls.filter((call) => call.what === 'removeHuman').map((call) => call.code), ['a-b-c']);
  life.leaveAllRooms(1);
  assert.deepEqual(kept.players.map((p) => p.id), [3], 'with no exception, every one');
});

test('somebody voted out is replaced like anybody who leaves, sent to the menu, and barred so the invitation does not let them back', (t) => {
  const { life, room, socket } = world(t);
  const made = room('a-b-c', [1, 2, 3], { phase: 'playing' });
  const ann = socket(1);
  const cat = socket(3);
  life.enter(ann, undefined);
  life.enter(cat, undefined);
  assert.deepEqual(life.putOutByVote(made, 3), { ok: true, empty: false });
  assert.equal(cat.states().at(-1), null);
  assert.equal(cat.data.code, null);
  assert.deepEqual(made.barred, [3]);
  assert.deepEqual(ann.states().at(-1).players, [1, 2, 'bot:3']);
});

test('the bar on somebody voted out is saved with the room', (t) => {
  const { life, room, restart } = world(t);
  const made = room('a-b-c', [1, 2, 3], { phase: 'playing' });
  life.putOutByVote(made, 3);
  assert.deepEqual(restart().roomAt('a-b-c').barred, [3]);
});

test('putting out somebody the rules cannot remove bars nobody and changes nothing', (t) => {
  const { life, room, state } = world(t);
  const made = room('a-b-c', [1, 2, 3], { phase: 'playing' });
  state.clock += 50;
  assert.deepEqual(life.putOutByVote(made, 99), { ok: false, error: 'notInThisGame' });
  assert.equal(made.barred, undefined);
  assert.equal(made.updatedAt, state.clock - 50);
});

test('a discarded room sends everybody still looking at it back to the menu, and the move it was owed never runs', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { life, room, socket, state } = world(t);
  const made = room('a-b-c', [1, 2], { phase: 'playing' });
  const ann = socket(1);
  const bob = socket(2);
  life.enter(ann, undefined);
  life.enter(bob, undefined);
  let ran = 0;
  state.nextAction = () => ({ wait: 100, run: () => { ran++; } });
  life.reschedule(made);
  life.discard(made);
  for (const who of [ann, bob]) {
    assert.equal(who.states().at(-1), null);
    assert.equal(who.data.code, null);
  }
  assert.equal(life.taken('a-b-c'), false);
  for (let i = 0; i < 500; i++) t.mock.timers.tick(1);
  assert.equal(ran, 0);
});

// ---- at random ----

test('fuzz: however people come, go, and close their tabs, nobody is in two games at once and no socket is shown a room its person is not in', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); // nothing is left to fire on its own: every step is the test's
  for (const seed of [41, 42, 43, 0xa11ce]) {
    const rng = seeded(seed);
    const pick = (list) => list[Math.floor(rng() * list.length)];
    // The same clean-up `workspace` does, by hand: the fuzz makes one world per seed inside one test.
    const hooks = [];
    const it = world({ after: (hook) => hooks.push(hook) });
    try {
      const users = [1, 2, 3, 4, 5];
      const problems = [];
      const sockets = [];
      let entered = 0;
      const connect = (id) => {
        const socket = it.socket(id);
        const record = socket.emit;
        socket.emit = (event, payload) => {
          // A view is one person's own view of a room they are in, sent to a socket that is looking at that room.
          if (event === 'state' && payload) {
            if (payload.you !== id) problems.push(`user ${id} was sent user ${payload.you}'s view`);
            if (!payload.players.includes(id)) problems.push(`user ${id} was shown ${payload.code}, which they are not in`);
            if (socket.data.code !== payload.code) problems.push(`a socket looking at ${socket.data.code} was sent ${payload.code}`);
          }
          record(event, payload);
        };
        sockets.push(socket);
        return socket;
      };
      for (const id of users) connect(id);
      for (let step = 0; step < 700; step++) {
        const where = `seed ${seed}, step ${step}`;
        it.state.clock += Math.floor(rng() * 1000);
        const roll = rng();
        const socket = pick(sockets);
        const id = socket.data.user.id;
        if (roll < 0.1) {
          const code = pick(CODES);
          const old = it.life.roomAt(code);
          if (old?.phase === 'finished') it.life.discard(old); // as the sweep does in the end, so the codes come round again
          if (!it.life.taken(code)) it.room(code, [], { phase: 'lobby' }); // the protocol's `create`, for an empty code
        } else if (roll < 0.5) {
          const raw = pick([...CODES, ...CODES, undefined, null, '', 'nonsense', 'x-y-z', 7, {}]);
          const reply = it.life.enter(socket, raw);
          assert.equal(typeof reply.ok, 'boolean', `${where}: enter answered ${JSON.stringify(reply)}`);
          if (reply.ok && reply.code) {
            entered++;
            assert.equal(socket.data.code, reply.code, `${where}: said to be in ${reply.code}`);
            assert.ok(it.game.hasPlayer(it.life.roomAt(reply.code), id), `${where}: let into ${reply.code} without being in it`);
          }
          if (!reply.ok) assert.equal(typeof reply.error, 'string', where);
        } else if (roll < 0.65) {
          const room = it.life.roomAt(socket.data.code);
          if (room) it.life.leaveRoom(room, id);
        } else if (roll < 0.75) {
          const room = it.life.roomAt(pick(CODES));
          if (room && room.phase !== 'finished') {
            room.phase = room.phase === 'lobby' ? 'playing' : 'finished';
            it.life.changed(room);
          }
        } else if (roll < 0.8) {
          const room = it.life.roomAt(pick(CODES));
          const target = room?.players.find((p) => p.kind === 'human');
          if (target && room.phase !== 'finished') it.life.putOutByVote(room, target.id);
        } else if (roll < 0.9) {
          it.life.dropSocket(id, socket);
          sockets.splice(sockets.indexOf(socket), 1);
          connect(id); // they open the page again
        } else {
          connect(pick(users)); // another tab
          if (sockets.length > 12) {
            const closing = sockets.shift();
            it.life.dropSocket(closing.data.user.id, closing);
          }
        }

        assert.deepEqual(problems, [], where);
        for (const user of users) {
          const live = [...it.life.rooms.values()].filter((room) => it.game.isLive(room) && it.game.hasPlayer(room, user));
          assert.ok(live.length <= 1, `${where}: user ${user} is in ${live.map((room) => room.code).join(' and ')} at once`);
          assert.equal(it.life.liveRoomOf(user), live[0], `${where}: the game user ${user} has under way`);
        }
        for (const open of sockets) {
          const user = open.data.user.id;
          const code = open.data.code;
          const last = open.states().at(-1);
          if (code === null) assert.ok(last === undefined || last === null, `${where}: a socket at the menu was last sent ${last?.code}`);
          else {
            const room = it.life.roomAt(code);
            assert.ok(room, `${where}: a socket is looking at ${code}, which is gone`);
            assert.ok(it.game.hasPlayer(room, user), `${where}: user ${user} has a socket on ${code} without being in it`);
            assert.ok(!room.barred?.includes(user), `${where}: user ${user} was put out of ${code} and is still looking at it`);
          }
        }
        for (const room of it.life.rooms.values()) {
          assert.ok(room.players.length <= SEATS, `${where}: ${room.code} holds ${room.players.length}`);
          const slots = room.players.map((p) => p.slot);
          assert.equal(new Set(slots).size, slots.length, `${where}: ${room.code} has two members in one slot`);
        }
      }
      assert.deepEqual(it.logs, [], `seed ${seed}: something was logged`);
      assert.ok(entered > 40, `seed ${seed}: the run let people into rooms only ${entered} times`);
    } finally {
      for (const hook of hooks) await hook();
    }
  }
});
