// What joining, leaving and being replaced must do — in both families of game, side by side.
//
// Games with numbered seats and games with a list of players have always had separate implementations of the same
// story, and the two drifted: the same ideas under different names, and a couple of real differences buried among the
// accidental ones.  These tests pin the story itself, so that merging the two implementations cannot quietly change
// it.  Each case is written against both families at once, and says plainly where they are meant to differ.
//
// The one place they genuinely do differ is what happens to somebody who leaves a game that is already over: a seated
// game leaves a marker in their seat so the final scores still name them (and the table never meets a hole), while a
// game with a list leaves them in the list untouched and tells the caller that nothing changed.  How big a room is
// used to be another, and is not any more: a room of either kind opens as big as the game allows, the host may bring
// it down, filling makes up a normal table, and starting settles it at whoever came.  What differs is only what a
// room of a given size looks like, which is shared/layout.js's business and nobody else's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeatRules, emptySeats, goneSeat } from './seats.js';
import { createRosterRules, migratePlayers } from './roster.js';

/** A seated game: a table that opens at the three the game allows, Ann hosting, with the hooks a real game provides. */
function seated({ phase = 'lobby' } = {}) {
  const log = [];
  const rules = createSeatRules({
    minPlayers: 2,
    maxPlayers: 3,
    isMidGame: (room) => !['lobby', 'finished'].includes(room.phase),
    takeOver: (room, bot, seat, rng) => {
      log.push(`takeOver:${seat}`);
      return { ...bot, ai: 'standard' };
    },
    handOver: (room, person, seat, bot) => {
      log.push(`handOver:${seat}:${bot.id}`);
      return person;
    },
    finishedSeat: goneSeat,
  });
  const room = { code: 'a-b-c', hostId: 1, phase, nextBot: 1, seats: emptySeats(3) };
  rules.addHuman(room, 1, 'Ann');
  return { rules, room, log };
}

/** A game with a list: the same three players, the same hooks, written the way that family writes them. */
function listed({ phase = 'lobby' } = {}) {
  const log = [];
  const rules = createRosterRules({
    isLive: (room) => room.phase !== 'finished',
    minPlayers: 2,
    maxPlayers: 3,
    makePlayer: (room, base) => ({ ...base, score: 0 }),
    takeOver: (room, oldId, bot) => log.push(`takeOver:${bot.slot}`),
    handOver: (room, botId, person) => log.push(`handOver:${person.slot}:${botId}`),
  });
  const room = { code: 'a-b-c', hostId: 1, phase, nextBot: 1, nextSlot: 0, players: [] };
  rules.addHuman(room, 1, 'Ann');
  return { rules, room, log };
}

/** Both families, so a case can be written once and asserted of each. */
const families = [
  ['seated', seated, (room) => room.seats.filter(Boolean), (room) => room.seats.filter((s) => s?.kind === 'human')],
  ['listed', listed, (room) => room.players, (room) => room.players.filter((p) => p.kind === 'human')],
];

for (const [family, make, members, people] of families) {
  test(`${family}: a newcomer joins, joining twice is harmless, and a full game turns them away`, () => {
    const { rules, room } = make();
    assert.equal(rules.addHuman(room, 2, 'Bob').ok, true);
    assert.equal(members(room).length, 2);
    assert.equal(rules.addHuman(room, 2, 'Bob').ok, true, 'joining twice keeps the place they have');
    assert.equal(members(room).length, 2, 'and does not make a second one');
    assert.equal(rules.addHuman(room, 3, 'Cy').ok, true);
    assert.equal(rules.addHuman(room, 4, 'Dee').error, 'gameFull');
  });

  test(`${family}: names are made unique, whatever their capitals`, () => {
    const { rules, room } = make();
    rules.addHuman(room, 2, 'ann');
    assert.deepEqual(members(room).map((m) => m.name), ['Ann', 'ann (2)']);
  });

  test(`${family}: somebody removed from the game cannot come back on the invitation`, () => {
    const { rules, room } = make();
    rules.addHuman(room, 2, 'Bob');
    assert.equal(rules.kick(room, 1, members(room)[1].slot ?? 's1', () => 0.5, 0).ok, true);
    assert.equal(rules.addHuman(room, 2, 'Bob').error, 'removedFromGame');
  });

  test(`${family}: leaving the lobby frees the place`, () => {
    const { rules, room } = make();
    rules.addHuman(room, 2, 'Bob');
    const out = rules.removeHuman(room, 2, () => 0.5, 0);
    assert.equal(out.ok, true);
    assert.equal(out.replaced ?? false, false, 'nobody stood in: the game has not started');
    assert.equal(people(room).length, 1);
    assert.equal(members(room).some((m) => m.kind === 'bot'), false);
  });

  test(`${family}: leaving a game under way hands the place to a computer player, which remembers whose it is`, () => {
    const { rules, room, log } = make();
    rules.addHuman(room, 2, 'Bob');
    room.phase = 'playing';
    const out = rules.removeHuman(room, 2, () => 0.5, 0);
    assert.equal(out.ok, true);
    assert.equal(out.replaced, true);
    const stand = members(room).find((m) => m.kind === 'bot');
    assert.ok(stand, 'a computer player is in the place');
    assert.equal(stand.stoodInFor, 2, 'and it knows whose place it is keeping');
    assert.equal(members(room).length, 2, 'the game is the same size, so no turn is lost');
    assert.equal(log.filter((line) => line.startsWith('takeOver')).length, 1, 'the game was told once');
  });

  test(`${family}: the person whose place is being kept gets it back, with everything in it`, () => {
    const { rules, room, log } = make();
    rules.addHuman(room, 2, 'Bob');
    room.phase = 'playing';
    rules.removeHuman(room, 2, () => 0.5, 0);
    const back = rules.addHuman(room, 2, 'Bob');
    assert.equal(back.ok, true);
    assert.ok(back.tookOver, 'it says which computer player stepped aside');
    const theirs = people(room).find((p) => p.id === 2);
    assert.ok(theirs, 'they are a person again');
    assert.equal(theirs.stoodInFor, undefined, 'and nobody is standing in for them any more');
    assert.equal(theirs.ai, undefined, 'the AI that was playing the place stops there');
    assert.equal(log.filter((line) => line.startsWith('handOver')).length, 1, 'the game was told once');
  });

  test(`${family}: a newcomer to a game under way takes a computer player's place, not a person's`, () => {
    const { rules, room } = make();
    rules.addHuman(room, 2, 'Bob');
    rules.addBot(room, 1);
    room.phase = 'playing';
    const joined = rules.addHuman(room, 5, 'Eve');
    assert.equal(joined.ok, true);
    assert.equal(people(room).length, 3);
    assert.equal(members(room).filter((m) => m.kind === 'bot').length, 0);
    assert.equal(rules.addHuman(room, 6, 'Fay').error, 'gameFull', 'and once every place holds a person, that is full');
  });

  test(`${family}: the host passes to somebody else when the host leaves, and the last one out empties the room`, () => {
    const { rules, room } = make();
    rules.addHuman(room, 2, 'Bob');
    assert.equal(rules.removeHuman(room, 1, () => 0.5, 0).ok, true);
    assert.equal(room.hostId, 2, 'the next person is the host now');
    assert.equal(rules.removeHuman(room, 2, () => 0.5, 0).empty, true, 'and the room has nobody left in it');
  });

  test(`${family}: only the host removes somebody, and never themselves`, () => {
    const { rules, room } = make();
    rules.addHuman(room, 2, 'Bob');
    const bobSlot = members(room)[1].slot ?? 's1';
    assert.equal(rules.kick(room, 2, bobSlot, () => 0.5, 0).ok, false, 'a guest cannot');
    assert.equal(rules.kick(room, 1, members(room)[0].slot ?? 's0', () => 0.5, 0).ok, false, 'nor the host themselves');
    assert.equal(rules.kick(room, 1, bobSlot, () => 0.5, 0).ok, true);
  });

  test(`${family}: nobody is removed once the game is over`, () => {
    const { rules, room } = make();
    rules.addHuman(room, 2, 'Bob');
    room.phase = 'finished';
    assert.equal(rules.kick(room, 1, members(room)[1].slot ?? 's1', () => 0.5, 0).ok, false);
  });

  test(`${family}: computer players are added, filled and removed in the lobby only`, () => {
    const { rules, room } = make();
    assert.equal(rules.addBot(room, 2).ok, false, 'only the host');
    assert.equal(rules.addBot(room, 1).ok, true);
    const bot = members(room).find((m) => m.kind === 'bot');
    assert.match(bot.id, /^bot:\d+$/);
    assert.equal(rules.removeBot(room, 2, bot.slot ?? 's1').ok, false, 'only the host');
    assert.equal(rules.removeBot(room, 1, bot.slot ?? 's1').ok, true);
    assert.equal(rules.fillWithBots(room, 1).ok, true);
    assert.equal(new Set(members(room).map((m) => m.name)).size, members(room).length, 'with names nobody else has');
    room.phase = 'playing';
    assert.equal(rules.addBot(room, 1).ok, false, 'not once the game has started');
    assert.equal(rules.removeBot(room, 1, members(room)[1].slot ?? 's1').ok, false);
  });

  test(`${family}: a room opens as big as the game allows, so nobody who could join before is turned away`, () => {
    const { rules, room } = make();
    assert.equal(rules.sizeOf(room), 3);
    assert.equal(rules.addHuman(room, 2, 'Bob').ok, true);
    assert.equal(rules.addHuman(room, 3, 'Cy').ok, true, 'up to the most the game holds, with nothing to set first');
  });

  test(`${family}: the host may cap the room to keep people out, within the limits and never below those here`, () => {
    const { rules, room } = make();
    rules.addHuman(room, 2, 'Bob');
    assert.equal(rules.setSize(room, 2, 3).ok, false, 'only the host');
    assert.equal(rules.setSize(room, 1, 1).error, 'playersRange', 'and only within what the game allows');
    assert.equal(rules.setSize(room, 1, 9).error, 'playersRange');
    assert.equal(rules.setSize(room, 1, 'x').error, 'playersRange');
    assert.equal(rules.setSize(room, 1, 2).ok, true);
    assert.equal(rules.sizeOf(room), 2);
    assert.equal(rules.addHuman(room, 3, 'Cy').error, 'gameFull', 'a room capped at two is full with two');
    assert.equal(rules.setSize(room, 1, 3).ok, true, 'until the host makes room again');
    assert.equal(rules.addHuman(room, 3, 'Cy').ok, true);
    assert.equal(rules.setSize(room, 1, 2).error, 'removeBeforeFewerPlayers', 'and capping below those here is refused');
  });

  test(`${family}: starting settles the size, so a place kept open has to be a computer player holding it`, () => {
    const { rules, room } = make();
    rules.addHuman(room, 2, 'Bob');
    assert.equal(rules.sizeOf(room), 3, 'until then it is as big as the game allows');
    rules.lockSize(room);
    room.phase = 'playing';
    assert.equal(rules.sizeOf(room), 2, 'now it is exactly the people who are playing');
    assert.equal(members(room).length, 2, 'and there is nowhere left that nobody is in');
    assert.equal(rules.setSize(room, 1, 3).ok, false, 'and the host cannot reopen it');
  });

  test(`${family}: filling with computer players makes up a normal table, not as many as the game could hold`, () => {
    // The quick start: most of these are played by about four, whatever the most they allow is.  Somebody who wants
    // more adds them one at a time with the button that is already there.
    const { rules, room } = make();
    assert.equal(rules.fillWithBots(room, 1).ok, true);
    assert.equal(members(room).length, 3, 'a normal table, or the most this small game holds');
  });
}

// The real differences, written out rather than glossed over.

test('listed: a room saved before the host could choose keeps the game it had', () => {
  // A game that was played had as many players as are in its list; a lobby had room for as many as the game allows,
  // and must keep it, or somebody who could have joined yesterday is turned away today.
  const played = { phase: 'finished', players: [{ kind: 'human', id: 1, name: 'Ann', slot: 's0' }, { kind: 'bot', id: 'bot:1', name: 'Ada', slot: 's1' }] };
  migratePlayers(played, undefined, { maxPlayers: 6 });
  assert.equal(played.size, 2, 'the number it was played with');
  const waiting = { phase: 'lobby', players: [{ kind: 'human', id: 1, name: 'Ann', slot: 's0' }] };
  migratePlayers(waiting, undefined, { maxPlayers: 6 });
  assert.equal(waiting.size, 6, 'the whole game it had room for');
  const chosen = { phase: 'lobby', size: 3, players: [] };
  migratePlayers(chosen, undefined, { maxPlayers: 6 });
  assert.equal(chosen.size, 3, 'and a room that already says is left alone');
});

test('seated: leaving a finished game leaves a marker, so the final scores still name them', () => {
  const { rules, room } = seated();
  rules.addHuman(room, 2, 'Bob');
  room.phase = 'finished';
  const out = rules.removeHuman(room, 2, () => 0.5, 0);
  assert.equal(out.ok, true);
  assert.equal(out.changed ?? true, true, 'the table has changed, so everybody is told');
  assert.deepEqual(room.seats[1], { kind: 'gone', name: 'Bob' });
  assert.equal(room.seats.length, 3, 'and the table never has a hole in it');
});

test('listed: leaving a finished game leaves them where they are, and nothing is sent', () => {
  const { rules, room } = listed();
  rules.addHuman(room, 2, 'Bob');
  room.phase = 'finished';
  const out = rules.removeHuman(room, 2, () => 0.5, 0);
  assert.equal(out.ok, true);
  assert.equal(out.changed, false, 'nothing happened, so the room is neither saved nor sent');
  assert.deepEqual(room.players.map((p) => p.name), ['Ann', 'Bob'], 'they stay on the final standings');
});
