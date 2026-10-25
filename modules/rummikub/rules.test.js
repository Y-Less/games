import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, checkPlay, dealSize, normaliseSettings, rackValue, resolveSet, startProblem, tileOf, totalTiles } from './rules.js';
import { STD, joker, tile } from './testing.js';

const t = (c, n, copy = 0) => tile(STD, c, n, copy);
const J = (i = 0) => joker(STD, i);

test('tile ids: two copies of each colour and number, then the wildcards', () => {
  assert.equal(totalTiles(STD), 106);
  assert.deepEqual(tileOf(STD, 0), { joker: false, colour: 0, number: 1 });
  assert.deepEqual(tileOf(STD, 12), { joker: false, colour: 0, number: 13 });
  assert.deepEqual(tileOf(STD, 13), { joker: false, colour: 1, number: 1 });
  assert.deepEqual(tileOf(STD, 52), { joker: false, colour: 0, number: 1 });
  assert.equal(tileOf(STD, 104).joker, true);
  const seen = new Map();
  for (let id = 0; id < 104; id++) {
    const { colour, number } = tileOf(STD, id);
    seen.set(`${colour}/${number}`, (seen.get(`${colour}/${number}`) ?? 0) + 1);
  }
  assert.equal(seen.size, 52);
  assert.ok([...seen.values()].every((n) => n === 2));
});

test('runs: consecutive, one colour, at least three, no wrapping', () => {
  assert.equal(resolveSet(STD, [t(0, 4), t(0, 5), t(0, 6)]).kind, 'run');
  assert.equal(resolveSet(STD, [t(0, 6), t(0, 4), t(0, 5)]).ok, true, 'order does not matter');
  assert.deepEqual(resolveSet(STD, [t(0, 6), t(0, 4), t(0, 5)]).items.map((i) => i.number), [4, 5, 6]);
  assert.equal(resolveSet(STD, [t(0, 4), t(0, 5)]).ok, false, 'two tiles');
  assert.equal(resolveSet(STD, [t(0, 4), t(0, 5), t(1, 6)]).ok, false, 'mixed colours');
  assert.equal(resolveSet(STD, [t(0, 4), t(0, 5), t(0, 7)]).ok, false, 'gap');
  assert.equal(resolveSet(STD, [t(0, 12), t(0, 13), t(0, 1)]).ok, false, 'no wrapping');
  assert.equal(resolveSet(STD, [t(0, 4), t(0, 4, 1), t(0, 5)]).ok, false, 'repeated number');
  const long = Array.from({ length: 13 }, (_, i) => t(2, i + 1));
  assert.equal(resolveSet(STD, long).ok, true, 'a full run');
  assert.equal(resolveSet(STD, [...long, J()]).ok, false, 'longer than the colour has');
});

test('groups: one number, different colours, up to the colour count', () => {
  assert.equal(resolveSet(STD, [t(0, 7), t(1, 7), t(2, 7)]).kind, 'group');
  assert.equal(resolveSet(STD, [t(0, 7), t(1, 7), t(2, 7), t(3, 7)]).ok, true);
  assert.equal(resolveSet(STD, [t(0, 7), t(1, 7), t(2, 7), t(3, 7), J()]).ok, false, 'five in a four-colour game');
  assert.equal(resolveSet(STD, [t(0, 7), t(0, 7, 1), t(2, 7)]).ok, false, 'same colour twice');
  assert.equal(resolveSet(STD, [t(0, 7), t(1, 8), t(2, 7)]).ok, false);
  const eight = { ...STD, colours: 8 };
  const group = Array.from({ length: 8 }, (_, c) => tile(eight, c, 5));
  assert.equal(resolveSet(eight, group).ok, true, 'eight colours, eight tiles');
});

test('jokers: fill gaps, extend ends, stand for the missing tile of a group', () => {
  const gap = resolveSet(STD, [t(1, 3), J(), t(1, 5)]);
  assert.equal(gap.ok, true);
  assert.deepEqual(gap.items.map((i) => [i.number, i.joker]), [[3, false], [4, true], [5, false]]);
  assert.equal(gap.value, 12);
  const end = resolveSet(STD, [t(1, 3), t(1, 4), J()]);
  assert.deepEqual(end.items.map((i) => i.number), [3, 4, 5], 'a joker at the end counts at the higher end');
  assert.equal(end.value, 12);
  const top = resolveSet(STD, [t(1, 12), t(1, 13), J()]);
  assert.deepEqual(top.items.map((i) => i.number), [11, 12, 13], 'at the top it goes below');
  const group = resolveSet(STD, [t(0, 9), t(1, 9), J()]);
  assert.equal(group.kind, 'group');
  assert.equal(group.value, 27);
  assert.equal(resolveSet(STD, [t(0, 3), J(), J(1)]).ok, true, 'one tile and two jokers');
  assert.equal(resolveSet(STD, [t(0, 3), t(0, 8), J()]).ok, false, 'jokers cannot bridge a big gap');
  assert.equal(resolveSet(STD, [J(), J(1), t(0, 3)]).value, 12, 'the better reading (run 3-4-5) is used');
  assert.equal(resolveSet(STD, [J(), J(1), J(0)]).ok, false, 'no ordinary tile (and a repeated id)');
  assert.equal(resolveSet(STD, [t(0, 3), J(), J()]).ok, false, 'the same joker twice');
  assert.equal(resolveSet({ ...STD, wildcards: 0 }, [t(0, 3), t(0, 4), 104]).ok, false, 'not a tile of this game');
});

test('small tile sets: groups need three colours, runs need three numbers', () => {
  const two = { numbers: 6, colours: 2, wildcards: 1 };
  assert.equal(resolveSet(two, [tile(two, 0, 3), tile(two, 1, 3), joker(two)]).ok, false, 'no group with only two colours');
  assert.equal(resolveSet(two, [tile(two, 0, 3), tile(two, 0, 4), joker(two)]).ok, true);
  const short = { numbers: 2, colours: 4, wildcards: 0 };
  assert.equal(resolveSet(short, [tile(short, 0, 2), tile(short, 1, 2), tile(short, 2, 2)]).ok, true);
  assert.notEqual(startProblem({ numbers: 2, colours: 2, wildcards: 8 }, 2), null);
});

test('settings are validated and clamped', () => {
  assert.deepEqual(normaliseSettings({}).settings, DEFAULT_SETTINGS);
  const huge = normaliseSettings({ numbers: 999, colours: 99, wildcards: 99, rounds: 99, meld: 999, timer: 99999 }).settings;
  assert.deepEqual(huge, { numbers: 20, colours: 8, wildcards: 8, rounds: 10, meld: 60, timer: 300 });
  const tiny = normaliseSettings({ numbers: -5, colours: 0, wildcards: -1, rounds: 0, meld: -3, timer: 3 }).settings;
  assert.deepEqual(tiny, { numbers: 2, colours: 2, wildcards: 0, rounds: 1, meld: 0, timer: 15 });
  assert.equal(normaliseSettings({ numbers: 9.6 }).settings.numbers, 10, 'rounded');
  for (const bad of ['9', NaN, Infinity, null, true, {}, []]) assert.equal(normaliseSettings({ numbers: bad }).ok, false, String(bad));
  assert.equal(normaliseSettings({ unknown: 1 }).settings.numbers, 13);
  assert.equal(normaliseSettings({ numbers: 5 }, { ...DEFAULT_SETTINGS, colours: 6 }).settings.colours, 6, 'keeps what it is not told about');
});

test('the deal: 14 each, fewer when the pool would be smaller than a hand', () => {
  assert.equal(dealSize(STD, 6), 14);
  assert.equal(dealSize({ numbers: 10, colours: 4, wildcards: 2 }, 6), 11);
  assert.equal(startProblem(STD, 6), null);
  assert.match(startProblem({ numbers: 3, colours: 2, wildcards: 0 }, 6), /too few to deal/);
  assert.ok(startProblem({ numbers: 2, colours: 2, wildcards: 8 }, 2).includes('no run or group'));
});

test('rack values: numbers count their number, jokers 30', () => {
  assert.equal(rackValue(STD, [t(0, 5), t(1, 13), J()]), 48);
});

// ---- whole turns ----
const play = (before, rack, proposed, extra = {}) => checkPlay(STD, { before, rack, proposed, melded: false, meld: 30, ...extra });

test('first meld: rack tiles only, worth the threshold', () => {
  const rack = [t(0, 10), t(0, 11), t(0, 12), t(1, 2), t(2, 2), t(3, 2)];
  const small = play([], rack, [[t(1, 2), t(2, 2), t(3, 2)]]);
  assert.equal(small.ok, false);
  assert.match(small.error, /at least 30/);
  const big = play([], rack, [[t(0, 10), t(0, 11), t(0, 12)]]);
  assert.equal(big.ok, true);
  assert.equal(big.points, 33);
  assert.equal(play([], rack, [[t(0, 10), t(0, 11), t(0, 12)], [t(1, 2), t(2, 2), t(3, 2)]]).points, 39, 'several sets add up');
  assert.equal(play([], rack, [[t(1, 2), t(2, 2), t(3, 2)]], { meld: 6 }).ok, true, 'a custom threshold');
  assert.equal(play([], rack, [[t(1, 2), t(2, 2), t(3, 2)]], { meld: 0 }).ok, true);
});

test('first meld: jokers count as the tile they replace', () => {
  const rack = [t(0, 11), J(), t(0, 13)];
  const result = play([], rack, [[t(0, 11), J(), t(0, 13)]]);
  assert.equal(result.ok, true);
  assert.equal(result.points, 36);
});

test('first meld: the table cannot be touched', () => {
  const before = [[t(1, 5), t(2, 5), t(3, 5)]];
  const rack = [t(0, 5), t(0, 10), t(0, 11), t(0, 12), t(1, 9)];
  assert.equal(play(before, rack, [...before, [t(0, 10), t(0, 11), t(0, 12)]]).ok, true, 'new set beside the old one');
  const extend = play(before, rack, [[t(1, 5), t(2, 5), t(3, 5), t(0, 5)], [t(0, 10), t(0, 11), t(0, 12)]]);
  assert.equal(extend.ok, false);
  assert.match(extend.error, /first meld/);
  const split = play(before, rack, [[t(1, 5), t(2, 5)], [t(3, 5), t(0, 5), t(0, 10)]]);
  assert.equal(split.ok, false);
  assert.equal(play(before, rack, [[t(0, 10), t(0, 11), t(0, 12)], before[0]]).ok, true, 'the table in any order');
  assert.equal(play(before, rack, [[t(0, 10), t(0, 11), t(0, 12)], [t(3, 5), t(2, 5), t(1, 5)]]).ok, true, 'the same set in another order');
});

test('after the first meld: free rearrangement, conserving every tile', () => {
  const before = [[t(0, 3), t(0, 4), t(0, 5), t(0, 6)], [t(1, 6), t(2, 6), t(3, 6)]];
  const rack = [t(0, 6, 1), t(0, 7), t(1, 9)];
  const opts = { melded: true };
  const extended = play(before, rack, [[t(0, 3), t(0, 4), t(0, 5), t(0, 6), t(0, 7)], before[1]], opts);
  assert.equal(extended.ok, true);
  assert.deepEqual(extended.added, [t(0, 7)]);
  assert.equal(play(before, rack, [before[0], before[1], [t(0, 6, 1), t(0, 7), t(1, 9)]], opts).ok, false, 'an invalid new set');
  assert.equal(play(before, rack, [[t(0, 3), t(0, 4), t(0, 5)], [t(0, 6), t(0, 6, 1), t(0, 7)], before[1]], opts).ok, false, 'two 6s of one colour in a run');
  const regroup = play(before, rack, [[t(0, 3), t(0, 4), t(0, 5)], [t(0, 6, 1), t(1, 6), t(2, 6), t(3, 6)], [t(0, 6)]], opts);
  assert.equal(regroup.ok, false, 'a leftover single tile is not a set');
  const swap = play(before, rack, [[t(0, 3), t(0, 4), t(0, 5)], [t(0, 6), t(0, 7), t(0, 6, 1)]], opts);
  assert.equal(swap.ok, false);
  const real = play(before, rack, [[t(0, 3), t(0, 4), t(0, 5)], [t(0, 6), t(1, 6), t(2, 6), t(3, 6)], [t(0, 6, 1), t(0, 7), t(0, 8)]], opts);
  assert.equal(real.ok, false, 'there is no 8 in the rack');
});

test('a rearrangement that really works: borrow a tile from a run for a group', () => {
  const before = [[t(0, 3), t(0, 4), t(0, 5), t(0, 6)]];
  const rack = [t(1, 6), t(2, 6)];
  const opts = { melded: true };
  const ok = play(before, rack, [[t(0, 3), t(0, 4), t(0, 5)], [t(0, 6), t(1, 6), t(2, 6)]], opts);
  assert.equal(ok.ok, true);
  assert.deepEqual([...ok.added].sort(), [t(1, 6), t(2, 6)].sort());
  assert.equal(ok.sets.flat().length, 6);
});

test('a play must keep every table tile, use only rack tiles, add something, and repeat nothing', () => {
  const before = [[t(0, 3), t(0, 4), t(0, 5)]];
  const rack = [t(1, 3), t(2, 3), t(3, 3)];
  const opts = { melded: true };
  assert.match(play(before, rack, [[t(1, 3), t(2, 3), t(3, 3)]], opts).error, /missing/);
  assert.match(play(before, rack, [before[0], [t(1, 3), t(2, 3), t(3, 3, 1)]], opts).error, /own rack/);
  assert.match(play(before, rack, [before[0]], opts).error, /not added/);
  assert.match(play(before, rack, [before[0], [t(1, 3), t(2, 3), t(3, 3)], [t(1, 3), t(2, 3), t(3, 3)]], opts).error, /twice/);
  assert.equal(play(before, rack, [before[0], [t(1, 3), t(2, 3), t(3, 3)]], opts).ok, true);
  for (const bad of [null, 'x', 5, {}, [null], [[null]], [['a']], [[1.5, 2, 3]], [[-1, 2, 3]], [[999, 2, 3]], [[1, 2, 3], 'x']]) {
    assert.equal(play(before, rack, bad, opts).ok, false, JSON.stringify(bad));
  }
});

test('replacing a joker: take the joker from a set, put the tile there, use the joker elsewhere', () => {
  const before = [[t(0, 4), J(), t(0, 6)]];
  const rack = [t(0, 5), t(1, 9), t(2, 9)];
  const opts = { melded: true };
  const ok = play(before, rack, [[t(0, 4), t(0, 5), t(0, 6)], [t(1, 9), t(2, 9), J()]], opts);
  assert.equal(ok.ok, true);
  assert.deepEqual([...ok.added].sort(), [t(0, 5), t(1, 9), t(2, 9)].sort());
  const kept = play(before, rack, [[t(0, 4), t(0, 5), t(0, 6)]], opts);
  assert.equal(kept.ok, false, 'the joker may not leave the table');
});
