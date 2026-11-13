// How a game's places are laid out (shared/layout.js): numbered seats with holes in them, or a list of players with
// none.  Everything about joining and leaving is written once on top of these two, so what is protected here is the
// promise each family makes about a **slot**: that it is a string, that it names one place and only one, that a name
// which is not a slot touches nothing, and that changing how big a room is never puts anybody out of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterLayout, seatLayout, slotForSeat, withSlot } from './layout.js';
import { seeded } from './random.js';

const human = (id, extra = {}) => ({ kind: 'human', id, name: `User ${id}`, ...extra });
const bot = (n, extra = {}) => ({ kind: 'bot', id: `bot:${n}`, name: `Bot ${n}`, ...extra });

/** Things a client can send where a slot is expected, none of which names a place at a table of four. */
const NOT_A_SLOT = [
  undefined,
  null,
  0,
  1,
  3,
  -1,
  1.5,
  NaN,
  true,
  '',
  's',
  '1',
  'S1',
  ' s1',
  's1 ',
  's1\n',
  's-1',
  's1.5',
  's1e0',
  's４', // a full-width digit: a number to a person, not to a seat
  'seat1',
  's4', // one past the end
  's99',
  's99999999999999999999999',
  '__proto__',
  'constructor',
  'length',
  ['s1'],
  { slot: 's1' },
  { toString: () => 's1' },
];

// ---- naming a place ----

test('a seat is called by "s" and its number, and the name is a string', () => {
  assert.equal(slotForSeat(0), 's0');
  assert.equal(slotForSeat(3), 's3');
  assert.equal(slotForSeat(12), 's12');
  assert.equal(typeof slotForSeat(0), 'string', 'an account id is a small number too, so a slot must never be one');
});

test('withSlot hands out s0, s1, s2 in turn, to the member it was given', () => {
  const room = {};
  const ann = human(7);
  assert.equal(withSlot(room, ann), ann, 'the same member comes back');
  assert.equal(ann.slot, 's0');
  assert.equal(withSlot(room, human(8)).slot, 's1');
  assert.equal(withSlot(room, bot(1)).slot, 's2');
  assert.equal(room.nextSlot, 3, 'the room keeps the count, so it is saved with it');
});

test('withSlot carries on from the count a saved room came back with', () => {
  const room = { nextSlot: 5 };
  assert.equal(withSlot(room, human(1)).slot, 's5');
  assert.equal(withSlot(room, human(2)).slot, 's6');
});

// ---- numbered seats ----

test('seats: the slot of a seat is its number, whoever is or is not in it', () => {
  assert.equal(seatLayout.slotOf(human(1), 2), 's2');
  assert.equal(seatLayout.slotOf(null, 0), 's0');
});

test('seats: the list leaves the empty seats out and keeps seat order, while the capacity counts them', () => {
  const ann = human(1);
  const bob = human(2);
  const room = { seats: [null, ann, null, bob] };
  assert.deepEqual(seatLayout.list(room), [ann, bob]);
  assert.equal(seatLayout.capacity(room), 4);
  assert.equal(seatLayout.capacity({ seats: [] }), 0);
});

test('seats: a slot finds its seat and whoever is in it, and an empty seat holds nobody', () => {
  const ann = human(1);
  const room = { seats: [ann, null, bot(1), null] };
  assert.equal(seatLayout.indexOf(room, 's0'), 0);
  assert.equal(seatLayout.indexOf(room, 's3'), 3);
  assert.equal(seatLayout.at(room, 's0'), ann);
  assert.equal(seatLayout.at(room, 's2'), room.seats[2]);
  assert.equal(seatLayout.at(room, 's1'), null, 'an empty seat is a seat, with nobody in it');
  assert.equal(seatLayout.indexOf(room, 's1'), 1);
});

test('seats: anything that is not the name of a seat at this table finds no seat and nobody', () => {
  const room = { seats: [human(1), human(2), bot(1), null] };
  for (const slot of NOT_A_SLOT) {
    const what = `slot ${typeof slot === 'string' ? JSON.stringify(slot) : String(slot)}`;
    assert.equal(seatLayout.indexOf(room, slot), -1, what);
    assert.equal(seatLayout.at(room, slot), null, what);
  }
});

test('seats: putting into, or emptying, a place that does not exist changes nothing', () => {
  const room = { seats: [human(1), human(2), bot(1), null] };
  const before = JSON.stringify(room);
  const keys = Object.keys(room.seats).join();
  for (const slot of NOT_A_SLOT) {
    seatLayout.put(room, slot, human(99));
    seatLayout.vacate(room, slot);
    assert.equal(JSON.stringify(room), before, `slot ${String(slot)}`);
    assert.equal(Object.keys(room.seats).join(), keys, `slot ${String(slot)} added a property to the table`);
  }
});

test('seats: the slot somebody is in is found from their id, and a stranger has none', () => {
  const room = { seats: [null, human(7), bot(1), null] };
  assert.equal(seatLayout.slotOfId(room, 7), 's1');
  assert.equal(seatLayout.slotOfId(room, 'bot:1'), 's2');
  assert.equal(seatLayout.slotOfId(room, 8), undefined);
  assert.equal(seatLayout.slotOfId(room, '7'), undefined, 'an id is matched as it is, not as text that looks like it');
});

test('seats: an empty seat never matches an id, even no id at all', { todo: 'seatLayout.slotOfId(room, undefined) answers with the first empty seat: `seat?.id` is undefined for a hole, which equals an undefined id' }, () => {
  const room = { seats: [human(7), null, null] };
  assert.equal(seatLayout.slotOfId(room, undefined), undefined);
});

test('seats: a newcomer is sat in the first empty seat and told which, and a full table has no seat to give', () => {
  const room = { seats: [human(1), null, human(2), null] };
  const cat = human(3);
  assert.equal(seatLayout.adopt(room, cat), cat, 'a seated member needs nothing before it sits');
  assert.equal(cat.slot, undefined, 'its slot is wherever it ends up sitting, so nothing is written on it');
  assert.equal(seatLayout.place(room, cat), 's1');
  assert.equal(room.seats[1], cat);
  assert.equal(seatLayout.place(room, human(4)), 's3');
  const full = [...room.seats];
  assert.equal(seatLayout.place(room, human(5)), null);
  assert.deepEqual(room.seats, full, 'and nobody was moved to make room');
});

test('seats: put replaces whoever was in a seat, and vacate leaves a hole that keeps its number', () => {
  const ann = human(1);
  const bob = human(2);
  const cat = human(3);
  const room = { seats: [ann, bob, cat] };
  const stand = bot(1);
  seatLayout.put(room, 's1', stand);
  assert.deepEqual(room.seats, [ann, stand, cat]);
  seatLayout.vacate(room, 's0');
  assert.deepEqual(room.seats, [null, stand, cat], 'everybody else is still where they were');
  assert.equal(seatLayout.slotOfId(room, 3), 's2');
  assert.equal(seatLayout.capacity(room), 3);
});

test('seats: the computer players are named by the seats they are in', () => {
  const room = { seats: [bot(1), human(1), null, bot(2)] };
  assert.deepEqual(seatLayout.bots(room), ['s0', 's3']);
  assert.deepEqual(seatLayout.bots({ seats: [human(1), null] }), []);
});

test('seats: a computer player replacing somebody starts the seat afresh', () => {
  const leaving = human(1, { score: 40, colour: 'red' });
  const stand = bot(1);
  assert.equal(seatLayout.replacement({ seats: [leaving] }, leaving, stand), stand);
  assert.equal(stand.score, undefined, 'nothing of the leaver is carried over');
});

test('seats: growing the table adds empty seats, and the people at it keep their order', () => {
  const ann = human(1);
  const bob = human(2);
  const room = { seats: [ann, bob, null] };
  seatLayout.resize(room, 5);
  assert.equal(seatLayout.capacity(room), 5);
  assert.deepEqual(seatLayout.list(room), [ann, bob]);
  assert.equal(room.seats.filter((seat) => seat === null).length, 3, 'an empty seat is a null, which is what `place` looks for');
  assert.equal(seatLayout.place(room, human(3)) !== null, true);
});

test('seats: shrinking the table takes empty seats away and never puts anybody out', () => {
  const ann = human(1);
  const bob = human(2);
  const cat = bot(1);
  const room = { seats: [ann, null, bob, null, cat, null] };
  seatLayout.resize(room, 4);
  assert.equal(seatLayout.capacity(room), 4);
  assert.deepEqual(seatLayout.list(room), [ann, bob, cat]);
  // The rules refuse a size smaller than the room holds; if one arrives anyway, the people stay.
  seatLayout.resize(room, 1);
  assert.deepEqual(seatLayout.list(room), [ann, bob, cat]);
  seatLayout.resize(room, 0);
  assert.deepEqual(seatLayout.list(room), [ann, bob, cat]);
});

test('seats: settling makes the table exactly as big as the people at it, in the same order', () => {
  const ann = human(1);
  const cat = bot(1);
  const room = { seats: [null, ann, null, cat, null] };
  seatLayout.settle(room);
  assert.deepEqual(room.seats, [ann, cat]);
  assert.equal(seatLayout.capacity(room), 2);
  seatLayout.settle(room);
  assert.deepEqual(room.seats, [ann, cat], 'settling a settled table changes nothing');
});

// ---- a list of players ----

test('listed: the slot is the key the player was given, wherever they are in the list', () => {
  assert.equal(rosterLayout.slotOf({ slot: 's4' }, 0), 's4');
  assert.equal(rosterLayout.slotOf(null), undefined);
  assert.equal(rosterLayout.slotOf(undefined), undefined);
});

test('listed: the list is the players, and the room holds what the host settled on, or the whole game until then', () => {
  const room = { players: [human(1), human(2)] };
  assert.equal(rosterLayout.list(room), room.players);
  assert.equal(rosterLayout.capacity(room, 8), 8);
  rosterLayout.resize(room, 5);
  assert.equal(rosterLayout.capacity(room, 8), 5);
  assert.equal(room.players.length, 2, 'there are no seats to add or take away');
  assert.equal(rosterLayout.capacity({ players: [], size: 'lots' }, 6), 6, 'a size that is not a whole number is no size');
  assert.equal(rosterLayout.capacity({ players: [], size: 2.5 }, 6), 6);
});

test('listed: settling makes the room exactly as big as the players in it', () => {
  const room = { players: [human(1), human(2), bot(1)], size: 8 };
  rosterLayout.settle(room);
  assert.equal(rosterLayout.capacity(room, 8), 3);
  assert.equal(room.players.length, 3);
});

test('listed: a newcomer is given a slot as it is made, goes on the end, and is found by slot and by id', () => {
  const room = { players: [] };
  const ann = rosterLayout.adopt(room, human(7));
  assert.equal(ann.slot, 's0');
  assert.equal(rosterLayout.place(room, ann), 's0');
  const bob = rosterLayout.adopt(room, human(8));
  assert.equal(rosterLayout.place(room, bob), 's1');
  assert.deepEqual(room.players, [ann, bob]);
  assert.equal(rosterLayout.at(room, 's1'), bob);
  assert.equal(rosterLayout.indexOf(room, 's1'), 1);
  assert.equal(rosterLayout.slotOfId(room, 7), 's0');
  assert.equal(rosterLayout.slotOfId(room, 9), undefined);
  assert.equal(rosterLayout.at(room, 's9'), null);
  assert.equal(rosterLayout.indexOf(room, 's9'), -1);
});

test('listed: a slot is not a place in the list, so the number 1 is not "s1" and an account id finds nobody', () => {
  const room = { players: [] };
  for (const id of [1, 0, 2]) rosterLayout.place(room, rosterLayout.adopt(room, human(id)));
  for (const slot of [0, 1, 2, '0', '1', 'S1', '__proto__', 'length', null, ['s1'], { slot: 's1' }]) {
    assert.equal(rosterLayout.at(room, slot), null, `slot ${String(slot)}`);
    assert.equal(rosterLayout.indexOf(room, slot), -1, `slot ${String(slot)}`);
  }
});

test('listed: emptying a slot closes the gap, and the slot is never handed out again', () => {
  const room = { players: [] };
  const [ann, bob, cat] = [human(1), human(2), human(3)].map((member) => rosterLayout.adopt(room, member));
  for (const member of [ann, bob, cat]) rosterLayout.place(room, member);
  rosterLayout.vacate(room, 's1');
  assert.deepEqual(room.players, [ann, cat], 'there are no holes, so everybody after it moves up');
  assert.equal(cat.slot, 's2', 'and keeps the slot they had, which is what the scoreboard calls them by');
  assert.equal(rosterLayout.at(room, 's1'), null);
  const dan = rosterLayout.adopt(room, human(4));
  assert.equal(dan.slot, 's3', 'a slot somebody has held is not given to somebody else');
  rosterLayout.vacate(room, 's1'); // already gone
  rosterLayout.vacate(room, 'nobody');
  assert.deepEqual(room.players, [ann, cat]);
});

test('listed: put replaces whoever holds a slot where they stand, and does nothing for a slot nobody holds', () => {
  const room = { players: [] };
  const [ann, bob] = [human(1), human(2)].map((member) => rosterLayout.adopt(room, member));
  rosterLayout.place(room, ann);
  rosterLayout.place(room, bob);
  const stand = { ...ann, kind: 'bot', id: 'bot:1' };
  rosterLayout.put(room, 's0', stand);
  assert.deepEqual(room.players, [stand, bob]);
  rosterLayout.put(room, 's7', human(9));
  assert.deepEqual(room.players, [stand, bob]);
});

test('listed: the computer players are named by their own slots', () => {
  const room = { players: [] };
  for (const member of [bot(1), human(1), bot(2)]) rosterLayout.place(room, rosterLayout.adopt(room, member));
  assert.deepEqual(rosterLayout.bots(room), ['s0', 's2']);
});

test('listed: a computer player replacing somebody takes the place as it stands, and only who is sitting there changes', () => {
  const leaving = human(7, { slot: 's2', score: 40, colour: 'red' });
  const frozen = JSON.stringify(leaving);
  const stand = rosterLayout.replacement({ players: [leaving] }, leaving, bot(1, { score: 0 }));
  assert.deepEqual(stand, { kind: 'bot', id: 'bot:1', name: 'Bot 1', slot: 's2', score: 40, colour: 'red' });
  assert.equal(JSON.stringify(leaving), frozen, 'the leaver is not changed: the new member is built from them');
});

// ---- both families, at random ----

/** A slot to aim at: usually one that might exist, sometimes one that cannot. */
const someSlot = (rng) => (rng() < 0.2 ? NOT_A_SLOT[Math.floor(rng() * NOT_A_SLOT.length)] : `s${Math.floor(rng() * 9)}`);

test('fuzz: a table of seats never loses or doubles anybody except by being asked to, and every slot names one seat', () => {
  for (const seed of [1, 2, 3, 0xbeef]) {
    const rng = seeded(seed);
    const room = { seats: [null, null, null, null] };
    let made = 0;
    for (let step = 0; step < 600; step++) {
      const where = `seed ${seed}, step ${step}`;
      const before = seatLayout.list(room);
      const size = room.seats.length;
      const roll = rng();
      let expected = before; // who should be at the table afterwards, in order
      if (roll < 0.3) {
        const member = rng() < 0.5 ? human(++made) : bot(++made);
        const slot = seatLayout.place(room, seatLayout.adopt(room, member));
        if (before.length === size) assert.equal(slot, null, `${where}: a full table took somebody`);
        else {
          assert.equal(seatLayout.at(room, slot), member, `${where}: the newcomer is not where they were told`);
          expected = room.seats.filter(Boolean);
          assert.deepEqual([...expected].sort((a, b) => String(a.id).localeCompare(String(b.id))), [...before, member].sort((a, b) => String(a.id).localeCompare(String(b.id))), `${where}: sitting down changed who is here`);
        }
        assert.equal(room.seats.length, size, `${where}: sitting down changed the size of the table`);
      } else if (roll < 0.5) {
        const slot = someSlot(rng);
        const gone = seatLayout.at(room, slot);
        seatLayout.vacate(room, slot);
        expected = before.filter((member) => member !== gone);
        assert.equal(room.seats.length, size, `${where}: emptying a seat changed the size of the table`);
        assert.equal(seatLayout.at(room, slot), null, where);
      } else if (roll < 0.65) {
        const slot = someSlot(rng);
        const index = seatLayout.indexOf(room, slot);
        const old = seatLayout.at(room, slot);
        const member = bot(++made);
        seatLayout.put(room, slot, member);
        if (index === -1) assert.ok(!seatLayout.list(room).includes(member), `${where}: put made a place for ${String(slot)}`);
        else {
          assert.equal(room.seats[index], member, where);
          expected = room.seats.filter(Boolean);
          assert.equal(expected.length, before.length + (old ? 0 : 1), where);
        }
        assert.equal(room.seats.length, size, `${where}: put changed the size of the table`);
      } else if (roll < 0.9) {
        const to = Math.floor(rng() * 9);
        seatLayout.resize(room, to);
        assert.equal(seatLayout.capacity(room), Math.max(to, before.length), `${where}: resized to ${to} with ${before.length} seated`);
      } else {
        seatLayout.settle(room);
        assert.equal(seatLayout.capacity(room), before.length, `${where}: settled`);
      }
      const after = seatLayout.list(room);
      assert.deepEqual(after, expected, `${where}: the people at the table, in order`);
      assert.equal(new Set(after).size, after.length, `${where}: somebody is in two seats`);
      assert.ok(room.seats.every((seat) => seat === null || (seat && typeof seat === 'object')), `${where}: a seat holds something that is neither a member nor empty`);
      // Every seat has exactly one name, and the name leads back to it.
      for (const [index, seat] of room.seats.entries()) {
        const slot = seatLayout.slotOf(seat, index);
        assert.equal(seatLayout.indexOf(room, slot), index, where);
        assert.equal(seatLayout.at(room, slot), seat, where);
        if (seat) assert.equal(seatLayout.slotOfId(room, seat.id), slot, where);
      }
      assert.deepEqual(seatLayout.bots(room).map((slot) => seatLayout.at(room, slot)), after.filter((member) => member.kind === 'bot'), `${where}: the computer players`);
    }
  }
});

test('fuzz: in a list of players a slot is held by one member at a time, travels with the place, and is never reused', () => {
  for (const seed of [4, 5, 6, 0xcafe]) {
    const rng = seeded(seed);
    const room = { players: [] };
    const everHeld = new Set();
    let made = 0;
    for (let step = 0; step < 600; step++) {
      const where = `seed ${seed}, step ${step}`;
      const before = [...room.players];
      const roll = rng();
      if (roll < 0.35) {
        const member = rosterLayout.adopt(room, rng() < 0.5 ? human(++made) : bot(++made));
        assert.ok(!everHeld.has(member.slot), `${where}: ${member.slot} was handed out twice`);
        everHeld.add(member.slot);
        assert.equal(rosterLayout.place(room, member), member.slot, where);
        assert.deepEqual(room.players, [...before, member], `${where}: a newcomer goes on the end`);
      } else if (roll < 0.55) {
        const slot = someSlot(rng);
        const gone = rosterLayout.at(room, slot);
        rosterLayout.vacate(room, slot);
        assert.deepEqual(room.players, before.filter((member) => member !== gone), `${where}: vacating ${String(slot)}`);
      } else if (roll < 0.75) {
        const slot = someSlot(rng);
        const leaving = rosterLayout.at(room, slot);
        if (leaving) {
          const stand = rosterLayout.replacement(room, leaving, bot(++made));
          assert.equal(stand.slot, leaving.slot, `${where}: the slot travels with the place`);
          rosterLayout.put(room, slot, stand);
          assert.deepEqual(room.players, before.map((member) => (member === leaving ? stand : member)), where);
        } else {
          rosterLayout.put(room, slot, bot(++made));
          assert.deepEqual(room.players, before, `${where}: put made a place for ${String(slot)}`);
        }
      } else if (roll < 0.9) {
        const to = Math.floor(rng() * 9);
        rosterLayout.resize(room, to);
        assert.equal(rosterLayout.capacity(room, 8), to, where);
        assert.deepEqual(room.players, before, `${where}: resizing moved somebody`);
      } else {
        rosterLayout.settle(room);
        assert.equal(rosterLayout.capacity(room, 8), before.length, where);
        assert.deepEqual(room.players, before, `${where}: settling moved somebody`);
      }
      const slots = room.players.map((member, index) => rosterLayout.slotOf(member, index));
      assert.equal(new Set(slots).size, slots.length, `${where}: two members hold one slot: ${slots.join()}`);
      for (const [index, member] of room.players.entries()) {
        assert.equal(typeof member.slot, 'string', where);
        assert.equal(rosterLayout.indexOf(room, member.slot), index, where);
        assert.equal(rosterLayout.at(room, member.slot), member, where);
        assert.equal(rosterLayout.slotOfId(room, member.id), member.slot, where);
      }
      assert.deepEqual(rosterLayout.bots(room), room.players.filter((member) => member.kind === 'bot').map((member) => member.slot), `${where}: the computer players`);
    }
  }
});
