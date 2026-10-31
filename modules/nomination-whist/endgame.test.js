// The last chance: in the last round, with the instant win on, a player who cannot win on points has nothing to lose, because
// only nominating 7 and taking all 7 tricks can win the game. Every card's weight in the hand estimate is turned up, so the
// hand reads as very strong: if that makes the nomination 7, it is 7 (and the player then plays for every trick); if 7 is not
// allowed (a dealer may be forbidden it) the boost is dropped and the player nominates as usual.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from './game.js';
import { AIS } from './ai/index.js';
import { LAST_CHANCE_BOOST, MOST_POINTS_IN_A_ROUND, cannotWinOnPoints, lastChanceBoost } from './ai/endgame.js';
import { estimateTricks } from './ai/standard.js';
import { SIM_AIS } from './sim/ais.js';
import { playGame } from './sim/game.js';
import { mulberry32 } from './sim/rng.js';

const seeded = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
/** The context of a nomination in the last of 14 rounds, from `scores`, for seat 0. */
const last = (scores, over = {}) => ({ instantWin: true, round: 13, rounds: 14, scores, seat: 0, allowed: ALL, ...over });
const WEAK = ['2C', '3D', '4H', '5S', '7C', '8D', '9H'];
const nominating = (scores, over = {}) => ({
  hand: WEAK,
  trump: 'H',
  players: 3,
  allowed: ALL,
  instantWin: true,
  jokers: false,
  missPoints: true,
  seat: 0,
  dealer: 2,
  cards: 7,
  nominations: [null, null, null],
  round: 13,
  rounds: 14,
  scores,
  rng: seeded(1),
  ...over,
});

test('you cannot win on points when even the most a round gives leaves you behind the best of the others', () => {
  assert.equal(MOST_POINTS_IN_A_ROUND, 17);
  assert.equal(cannotWinOnPoints(last([0, 100, 90])), true);
  assert.equal(cannotWinOnPoints(last([82, 100, 90])), true, '82 + 17 = 99, still behind 100');
  assert.equal(cannotWinOnPoints(last([83, 100, 90])), false, '83 + 17 = 100 ties the leader, which shares the win: still possible');
  assert.equal(cannotWinOnPoints(last([120, 100, 90])), false, 'leading');
  assert.equal(cannotWinOnPoints(last([50, 50, 50])), false);
  assert.equal(cannotWinOnPoints(last([100, 0, 0], { seat: 1 })), true, 'the same from another seat');
});

test('it applies only in the last round, with the instant win on', () => {
  const behind = [0, 100, 90];
  assert.equal(cannotWinOnPoints(last(behind, { round: 12 })), false, 'not the last round');
  assert.equal(cannotWinOnPoints(last(behind, { round: 0 })), false, 'the first round is the other 7-card round');
  assert.equal(cannotWinOnPoints(last(behind, { instantWin: false })), false, 'the option is off');
  assert.equal(cannotWinOnPoints({ instantWin: true, seat: 0 }), false, 'no scores given: single deals have no scores');
  assert.equal(cannotWinOnPoints(last(behind, { round: 6, rounds: 7, instantWin: false })), false, 'the short game ends on a 1-card round');
});

test("the boost is added to every card's weight, and only then", () => {
  assert.equal(lastChanceBoost(last([0, 100, 90])), LAST_CHANCE_BOOST);
  assert.equal(lastChanceBoost(last([95, 100, 90])), 0);
  const plain = estimateTricks(WEAK, 'H', 3);
  assert.ok(plain < 2, `a weak hand is worth ${plain}`);
  assert.equal(estimateTricks(WEAK, 'H', 3, 0), plain);
  assert.equal(estimateTricks(WEAK, 'H', 3, LAST_CHANCE_BOOST), 7, 'with every card a whole trick heavier even this hand reads as taking all 7');
  assert.ok(estimateTricks(WEAK.slice(0, 4), 'H', 3, 0.3) > estimateTricks(WEAK.slice(0, 4), 'H', 3) + 1, 'it grows with the number of cards');
  assert.equal(estimateTricks(WEAK, 'H', 3, 5), 7, 'and never beyond the cards held');
});

const trying = [...AIS, ...SIM_AIS].filter((ai, i, all) => ai.id !== 'random' && all.findIndex((o) => o.id === ai.id) === i);

test('with nothing to lose every AI that is trying to win nominates 7, even with a weak hand, and not otherwise', () => {
  assert.ok(trying.length >= 8, 'every AI is covered');
  for (const ai of trying) {
    for (const trump of ['H', null]) {
      assert.equal(ai.nominate(nominating([0, 100, 90], { trump })), 7, `${ai.id} should go for the instant win`);
      const normal = ai.nominate(nominating([95, 100, 90], { trump }));
      assert.ok(normal <= 3, `${ai.id} nominated ${normal} with a weak hand when it could still win`);
    }
  }
});

test('a dealer who may not nominate 7 nominates as usual, not the next best number', () => {
  const allowed = ALL.filter((n) => n !== 7);
  for (const ai of trying) {
    const stuck = ai.nominate(nominating([0, 100, 90], { allowed }));
    assert.ok(stuck <= 3, `${ai.id} nominated ${stuck}: a 6 can no more win the game than a 0`);
  }
});

test('Random stays random: it does not know about the last chance', () => {
  const picks = new Set();
  const rng = seeded(4);
  for (let i = 0; i < 200; i++) picks.add(AIS.find((a) => a.id === 'random').nominate({ allowed: ALL, rng, ...last([0, 100, 90]) }));
  assert.ok(picks.size > 4);
});

/** A started game for Ann (user 1, seat 0) with computer players, brought to the last round with the given scores. */
function lastRoundFor(scores, { seats = 3, seed = 5, settings = {} } = {}) {
  const rng = seeded(seed);
  const room = g.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats, ...settings } });
  assert.ok(g.fillWithBots(room, 1).ok);
  assert.ok(g.start(room, 1, rng).ok);
  room.roundIndex = room.settings.length === 'short' ? 6 : 13;
  room.dealer = seats - 1; // so that Ann nominates first
  room.scores = scores;
  g.dealRound(room, rng);
  return room;
}

test('a person who cannot win on points is not told to go for 7, and is suggested what the table says for their hand', () => {
  const cannot = lastRoundFor([0, 100, 90]);
  cannot.hands[0] = [...WEAK];
  const view = g.viewFor(cannot, 1);
  assert.equal('lastChance' in view, false, 'nothing is said about it');
  assert.ok(view.suggestion <= 3, `the ordinary suggestion for a weak hand (${view.suggestion}), never 7`);
  const canWin = lastRoundFor([90, 100, 90]);
  canWin.hands[0] = [...WEAK];
  assert.equal(g.viewFor(canWin, 1).suggestion, view.suggestion, 'the same as for a player who can still win');
  assert.ok(g.nominate(cannot, 0, view.suggestion).ok);
});

test('7 is still suggested when it is a real bid: a hand that can take all seven tricks', () => {
  const room = lastRoundFor([0, 100, 90]);
  room.hands[0] = ['AS', 'KS', 'QS', 'JS', '10S', '9S', '8S'];
  assert.equal(g.viewFor(room, 1).suggestion, 7);
});

test('computer players in the last round nominate 7 when they cannot win on points, whatever their hands', () => {
  let high = 0;
  let behind = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const room = lastRoundFor([100, 0, 0], { seed });
    const rng = seeded(seed);
    let guard = 0;
    while (room.phase === 'nominating' && guard++ < 10) {
      const seat = room.turn;
      const number = g.botNominate(room, seat, rng);
      if (seat !== 0 && room.seats[seat].ai !== 'random') {
        behind++;
        if (number === 7) high++;
      }
      assert.ok(g.nominate(room, seat, number).ok);
    }
  }
  assert.equal(high, behind, `${high} of ${behind} nominated 7`);
  assert.ok(behind > 30, `${behind} computer nominations were checked (Random ignores the last chance by design)`);
});

test('in whole simulated games, every AI that cannot win on points nominates 7 when it may, and not otherwise', () => {
  const rng = mulberry32(17);
  const ais = SIM_AIS.filter((ai) => ai.id !== 'random' && !ai.id.endsWith('-sharp') && ai.id !== 'sharp');
  let situations = 0;
  let sevens = 0;
  let forbidden = 0;
  for (let game = 0; game < 400; game++) {
    const lineup = Array.from({ length: 3 + (game % 5) }, (_, i) => ais[(game + i) % ais.length]);
    playGame({ ais: lineup, instantWin: true }, rng, (event) => {
      if (event.type !== 'nominate' || !cannotWinOnPoints(event.context)) return;
      situations++;
      if (event.context.allowed.includes(7)) {
        assert.equal(event.nomination, 7, `${lineup[event.seat].id} had nothing to lose`);
        sevens++;
      } else {
        forbidden++; // 7 is not allowed: the boost is dropped and the AI nominates as usual
      }
    });
  }
  assert.ok(situations > 50, `the situation comes up (${situations})`);
  assert.ok(sevens > 40, `most of them could nominate 7 (${sevens} of ${situations}, ${forbidden} forbidden it)`);
});

test('with hints turned off nobody is suggested a nomination, and a room saved before the option has them on', () => {
  const off = lastRoundFor([90, 100, 90], { settings: { hints: false } });
  assert.equal(g.viewFor(off, 1).suggestion, null);
  const on = lastRoundFor([90, 100, 90]);
  assert.notEqual(g.viewFor(on, 1).suggestion, null);
  delete on.settings.hints;
  assert.notEqual(g.viewFor(on, 1).suggestion, null, 'an old room has hints');
  assert.equal(g.normaliseSettings({ hints: 'no' }).ok, false);
});
