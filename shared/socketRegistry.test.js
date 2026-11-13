// Which sockets each account has open, and which room each is looking at (shared/socketRegistry.js).  A view shows
// who is away, and a game may wait on somebody being there, so what is protected here is that "is this person
// connected to this room?" always agrees with the sockets themselves: through several tabs, through moving between
// rooms, through being sent back to the menu, and through tabs closing in any order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from './random.js';
import { createSocketRegistry } from './socketRegistry.js';

/** A socket as the registry sees one: something with a `data` bag.  The stale code is there to be overwritten. */
const socket = (name) => ({ name, data: { code: 'left-over-from-somewhere' } });

test('a newly connected socket is looking at no room, and its account is in none', () => {
  const registry = createSocketRegistry();
  const tab = socket('tab');
  registry.add(7, tab);
  assert.equal(tab.data.code, null, 'whatever the socket said before, it starts at the menu');
  assert.deepEqual(registry.openFor(7, 'a-b-c'), []);
  assert.equal(registry.online('a-b-c')(7), false);
});

test('a socket pointed at a room is one of its account’s sockets for that room, and the account is connected to it', () => {
  const registry = createSocketRegistry();
  const tab = socket('tab');
  registry.add(7, tab);
  registry.attach(7, tab, 'a-b-c');
  assert.equal(tab.data.code, 'a-b-c');
  assert.deepEqual(registry.openFor(7, 'a-b-c'), [tab]);
  assert.equal(registry.online('a-b-c')(7), true);
  assert.equal(registry.online('a-b-c')(8), false, 'somebody else is not');
  assert.equal(registry.online('d-e-f')(7), false, 'and nor are they connected to another room');
  assert.deepEqual(registry.openFor(7, 'd-e-f'), []);
  assert.deepEqual(registry.openFor(8, 'a-b-c'), []);
});

test('one person with the game open in several tabs has every tab found, and stays connected until the last has gone', () => {
  const registry = createSocketRegistry();
  const tabs = [socket('one'), socket('two'), socket('three')];
  for (const tab of tabs) {
    registry.add(7, tab);
    registry.attach(7, tab, 'a-b-c');
  }
  assert.deepEqual(new Set(registry.openFor(7, 'a-b-c')), new Set(tabs));
  assert.equal(registry.openFor(7, 'a-b-c').length, 3);
  const online = registry.online('a-b-c');
  registry.drop(7, tabs[0]);
  assert.equal(online(7), true);
  registry.drop(7, tabs[2]);
  assert.equal(online(7), true);
  assert.deepEqual(registry.openFor(7, 'a-b-c'), [tabs[1]]);
  registry.drop(7, tabs[1]);
  assert.equal(online(7), false);
  assert.deepEqual(registry.openFor(7, 'a-b-c'), []);
});

test('tabs of one account may look at different rooms, and each room is told only about its own', () => {
  const registry = createSocketRegistry();
  const here = socket('here');
  const there = socket('there');
  const menu = socket('menu');
  for (const tab of [here, there, menu]) registry.add(7, tab);
  registry.attach(7, here, 'a-b-c');
  registry.attach(7, there, 'd-e-f');
  assert.deepEqual(registry.openFor(7, 'a-b-c'), [here]);
  assert.deepEqual(registry.openFor(7, 'd-e-f'), [there]);
  registry.drop(7, here);
  assert.equal(registry.online('a-b-c')(7), false);
  assert.equal(registry.online('d-e-f')(7), true);
});

test('pointing a socket at another room takes it out of the one it was looking at', () => {
  const registry = createSocketRegistry();
  const tab = socket('tab');
  registry.add(7, tab);
  registry.attach(7, tab, 'a-b-c');
  registry.attach(7, tab, 'd-e-f');
  assert.equal(tab.data.code, 'd-e-f');
  assert.equal(registry.online('a-b-c')(7), false);
  assert.equal(registry.online('d-e-f')(7), true);
  assert.deepEqual(registry.openFor(7, 'a-b-c'), []);
});

test('pointing a socket at the room it is already looking at counts it once, not twice', () => {
  const registry = createSocketRegistry();
  const tab = socket('tab');
  registry.add(7, tab);
  for (let i = 0; i < 5; i++) registry.attach(7, tab, 'a-b-c'); // every resume and every reconnect does this
  assert.deepEqual(registry.openFor(7, 'a-b-c'), [tab]);
  registry.drop(7, tab);
  assert.equal(registry.online('a-b-c')(7), false, 'one socket closing is that person gone');
});

test('the "is this person here?" predicate reads the room as it is when asked, not as it was when it was made', () => {
  const registry = createSocketRegistry();
  const online = registry.online('a-b-c'); // made before anybody is there, as a game that waits on somebody keeps it
  const tab = socket('tab');
  assert.equal(online(7), false);
  registry.add(7, tab);
  registry.attach(7, tab, 'a-b-c');
  assert.equal(online(7), true);
  registry.detach(7, 'a-b-c');
  assert.equal(online(7), false);
  registry.attach(7, tab, 'a-b-c');
  assert.equal(online(7), true);
  registry.drop(7, tab);
  assert.equal(online(7), false);
});

test('sending a person back to the menu returns the sockets that were looking at that room, and leaves their others alone', () => {
  const registry = createSocketRegistry();
  const one = socket('one');
  const two = socket('two');
  const elsewhere = socket('elsewhere');
  const other = socket('other');
  for (const tab of [one, two, elsewhere]) registry.add(7, tab);
  registry.add(8, other);
  registry.attach(7, one, 'a-b-c');
  registry.attach(7, two, 'a-b-c');
  registry.attach(7, elsewhere, 'd-e-f');
  registry.attach(8, other, 'a-b-c');
  const sent = registry.detach(7, 'a-b-c');
  assert.deepEqual(new Set(sent), new Set([one, two]));
  assert.equal(sent.length, 2);
  assert.equal(one.data.code, null);
  assert.equal(two.data.code, null);
  assert.equal(elsewhere.data.code, 'd-e-f');
  assert.equal(registry.online('a-b-c')(7), false);
  assert.equal(registry.online('a-b-c')(8), true, 'somebody else in the same room is still there');
  assert.equal(registry.online('d-e-f')(7), true);
  assert.deepEqual(registry.detach(7, 'a-b-c'), [], 'and there is nobody left to send the second time');
});

test('a socket sent back to the menu can be pointed at a room again', () => {
  const registry = createSocketRegistry();
  const tab = socket('tab');
  registry.add(7, tab);
  registry.attach(7, tab, 'a-b-c');
  registry.detach(7, 'a-b-c');
  registry.attach(7, tab, 'd-e-f');
  assert.deepEqual(registry.openFor(7, 'd-e-f'), [tab]);
  assert.equal(registry.online('d-e-f')(7), true);
});

test('a socket that disconnects still says which room it was looking at, so the room can be told', () => {
  const registry = createSocketRegistry();
  const tab = socket('tab');
  registry.add(7, tab);
  registry.attach(7, tab, 'a-b-c');
  registry.drop(7, tab);
  assert.equal(tab.data.code, 'a-b-c');
  assert.deepEqual(registry.openFor(7, 'a-b-c'), [], 'though it is no longer one of the sockets to send to');
});

test('dropping a socket twice, or one that was never added, disturbs nobody', () => {
  const registry = createSocketRegistry();
  const one = socket('one');
  const two = socket('two');
  registry.add(7, one);
  registry.add(7, two);
  registry.attach(7, one, 'a-b-c');
  registry.attach(7, two, 'a-b-c');
  registry.drop(7, one);
  registry.drop(7, one); // a disconnect reported twice must not count the second tab out as well
  assert.equal(registry.online('a-b-c')(7), true);
  assert.deepEqual(registry.openFor(7, 'a-b-c'), [two]);
  const stranger = socket('stranger');
  stranger.data.code = 'a-b-c';
  registry.drop(7, stranger);
  registry.drop(99, stranger);
  assert.equal(registry.online('a-b-c')(7), true);
});

test('accounts are kept apart: one person leaving does not take another out of the room', () => {
  const registry = createSocketRegistry();
  const ann = socket('ann');
  const bob = socket('bob');
  registry.add(7, ann);
  registry.add(8, bob);
  registry.attach(7, ann, 'a-b-c');
  registry.attach(8, bob, 'a-b-c');
  registry.drop(7, ann);
  const online = registry.online('a-b-c');
  assert.equal(online(7), false);
  assert.equal(online(8), true);
  assert.deepEqual(registry.openFor(8, 'a-b-c'), [bob]);
});

test('two registries share nothing, so one game’s rooms are not another’s', () => {
  const hearts = createSocketRegistry();
  const whist = createSocketRegistry();
  const tab = socket('tab');
  hearts.add(7, tab);
  hearts.attach(7, tab, 'a-b-c');
  assert.equal(whist.online('a-b-c')(7), false);
  assert.deepEqual(whist.openFor(7, 'a-b-c'), []);
});

test('fuzz: who is connected to which room always agrees with the sockets, whatever order things happen in', () => {
  // The index of rooms is kept beside the sockets for speed, so the thing to catch is the two drifting apart: a count
  // left behind by a tab that moved, or taken off twice.  The model is the sockets themselves and nothing cleverer.
  const users = [1, 2, 3];
  const codes = ['a-b-c', 'd-e-f', 'g-h-i'];
  for (const seed of [21, 22, 23, 0xfeed]) {
    const rng = seeded(seed);
    const pick = (list) => list[Math.floor(rng() * list.length)];
    const registry = createSocketRegistry();
    const open = []; // { user, tab, code } for every socket that is connected, as the test believes it to be
    const kept = Object.fromEntries(codes.map((code) => [code, registry.online(code)])); // predicates made at the start
    let made = 0;
    for (let step = 0; step < 1500; step++) {
      const where = `seed ${seed}, step ${step}`;
      const roll = rng();
      if (roll < 0.25 && open.length < 12) {
        const entry = { user: pick(users), tab: socket(`tab${++made}`), code: null };
        registry.add(entry.user, entry.tab);
        open.push(entry);
      } else if (roll < 0.6 && open.length) {
        const entry = pick(open);
        entry.code = pick(codes);
        registry.attach(entry.user, entry.tab, entry.code);
      } else if (roll < 0.75) {
        const user = pick(users);
        const code = pick(codes);
        const leaving = open.filter((entry) => entry.user === user && entry.code === code);
        const sent = registry.detach(user, code);
        assert.deepEqual(new Set(sent), new Set(leaving.map((entry) => entry.tab)), `${where}: who was sent back to the menu`);
        assert.equal(sent.length, leaving.length, where);
        for (const entry of leaving) entry.code = null;
      } else if (open.length) {
        const [entry] = open.splice(Math.floor(rng() * open.length), 1);
        registry.drop(entry.user, entry.tab);
        if (rng() < 0.2) registry.drop(entry.user, entry.tab); // reported twice
      }
      for (const entry of open) assert.equal(entry.tab.data.code, entry.code, `${where}: ${entry.tab.name} says it is looking at ${entry.tab.data.code}`);
      for (const user of users) {
        for (const code of codes) {
          const expected = open.filter((entry) => entry.user === user && entry.code === code).map((entry) => entry.tab);
          const found = registry.openFor(user, code);
          assert.equal(found.length, expected.length, `${where}: user ${user} has ${found.length} socket(s) on ${code}, not ${expected.length}`);
          assert.deepEqual(new Set(found), new Set(expected), `${where}: user ${user}'s sockets on ${code}`);
          assert.equal(registry.online(code)(user), expected.length > 0, `${where}: whether user ${user} is connected to ${code}`);
          assert.equal(kept[code](user), expected.length > 0, `${where}: the same, asked of a predicate made at the start`);
        }
      }
    }
  }
});
