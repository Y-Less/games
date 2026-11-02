// The rules of Cheat: the deal, the rank that is claimed each turn, playing and calling, the final check and the end of the game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../../shared/testkit.js';
import * as g from './game.js';

/** A started game with one person (account 1) in seat 0 and computers elsewhere. */
function started(n = 4, seed = 1) {
  const room = g.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: n } });
  assert.equal(g.fillWithBots(room, 1).ok, true);
  assert.equal(g.start(room, 1, seeded(seed)).ok, true);
  return room;
}
/** Sets the hands (one array per seat), the turn and the number of plays so far, for a chosen position. */
function stage(room, hands, { turn = 0, plays = 0, pile = [] } = {}) {
  room.hands = hands.map((h) => [...h]);
  room.turn = turn;
  room.plays = plays;
  room.pile = [...pile];
  room.last = null;
  room.lastCall = null;
  room.decided = [];
  room.phase = 'playing';
}
const sorted = (cards) => [...cards].sort();

test('the rank to claim runs from the Ace to the King and round again', () => {
  assert.equal(g.SEQUENCE.length, 13);
  assert.deepEqual([0, 1, 2, 12, 13, 14].map(g.rankFor), ['A', '2', '3', 'K', 'A', '2']);
});

test('the pack is dealt out whole: one pack up to five players, two for six or seven', () => {
  for (const n of [3, 4, 5, 6, 7]) {
    const room = started(n, n);
    const decks = n >= 6 ? 2 : 1;
    assert.equal(g.decksFor(n), decks);
    assert.equal(room.hands.flat().length, 52 * decks);
    const sizes = room.hands.map((h) => h.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${n} players: hands differ by at most one`);
    assert.equal(sorted(room.hands.flat()).join(), sorted(g.deckFor(n)).join());
  }
});

test('the holder of the Ace of Spades starts', () => {
  for (let seed = 1; seed < 12; seed++) {
    const room = started(5, seed);
    assert.ok(room.hands[room.turn].includes('AS'));
    assert.equal(room.phase, 'playing');
  }
});

test('settings: the host picks 3 to 7 seats, and not fewer than are filled', () => {
  const room = g.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  assert.equal(room.seats.length, g.DEFAULT_SEATS);
  assert.deepEqual(g.setSettings(room, 2, { seats: 5 }), { ok: false, error: 'hostOnly' }, 'only the host');
  assert.deepEqual(g.setSettings(room, 1, { seats: 2 }), { ok: false, error: 'playersRange', params: { min: 3, max: 7 } });
  assert.equal(g.setSettings(room, 1, { seats: 8 }).error, 'playersRange');
  assert.equal(g.setSettings(room, 1, { seats: 5.5 }).error, 'playersRange');
  assert.equal(g.setSettings(room, 1, { seats: 7 }).ok, true);
  assert.equal(room.seats.length, 7);
  g.fillWithBots(room, 1);
  assert.deepEqual(g.setSettings(room, 1, { seats: 3 }), { ok: false, error: 'removePlayerFirst' }, 'someone would lose their seat');
  assert.throws(() => g.createRoom({ now: 0, code: 'x', hostId: 1, hostName: 'Ann', settings: { seats: 2 } }));
});

test('starting needs every seat filled and only the host may start', () => {
  const room = g.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  assert.deepEqual(g.start(room, 1, Math.random), { ok: false, error: 'allSeatsNeedPlayers', params: { seats: 4 } }, 'empty seats');
  g.fillWithBots(room, 1);
  assert.deepEqual(g.start(room, 2, Math.random), { ok: false, error: 'hostOnly' });
  assert.equal(g.start(room, 1, Math.random).ok, true);
  assert.deepEqual(g.start(room, 1, Math.random), { ok: false, error: 'settingsBeforeStart' }, 'already started');
});

test('an honest play: the cards go to the pile, the turn passes on and the next rank is claimed', () => {
  const room = started();
  stage(room, [['AS', 'AH', '5C'], ['2C', '9D'], ['3C', '4D'], ['6C', '7D']]);
  const out = g.playCards(room, 0, ['AS', 'AH']);
  assert.equal(out.ok, true);
  assert.deepEqual(room.pile, ['AS', 'AH']);
  assert.deepEqual(room.hands[0], ['5C']);
  assert.deepEqual(room.last, { seat: 0, count: 2, rank: 'A', cards: ['AS', 'AH'], lie: false });
  assert.equal(room.turn, 1);
  assert.equal(g.rankFor(room.plays), '2');
  assert.equal(room.tally[0].liesTold, 0);
});

test('a lie is recorded and a play that is not allowed changes nothing', () => {
  const room = started();
  stage(room, [['AS', 'AH', '5C'], ['2C', '9D'], ['3C', '4D'], ['6C', '7D']]);
  const before = JSON.stringify(room);
  for (const [seat, cards, error] of [[1, ['2C'], 'notYourTurn'], [0, [], 'playBetween'], [0, ['AS', 'AH', '5C', '5C', '5D'], 'playBetween'], [0, ['KS'], 'playFromHand'], [0, ['AS', 'AS'], 'playFromHand'], [0, 'AS', 'playBetween'], [0, [null], 'playFromHand'], [0, ['AS', 'AS', 'AH'], 'playFromHand']]) {
    const refused = g.playCards(room, seat, cards);
    assert.equal(refused.ok, false, JSON.stringify(cards));
    assert.equal(refused.error, error, JSON.stringify(cards));
  }
  assert.deepEqual(g.playCards(room, 0, []).params, { max: g.MAX_PLAY }, 'the refusal says how many cards a play may hold');
  assert.equal(JSON.stringify(room), before);
  assert.equal(g.playCards(room, 0, ['5C']).ok, true);
  assert.equal(room.last.lie, true);
  assert.equal(room.tally[0].liesTold, 1);
});

test('calling a lie: the liar picks up the whole pile', () => {
  const room = started();
  stage(room, [['5C', '5D', '8S'], ['2C', '9D'], ['3C', '4D'], ['6C', '7D']], { pile: ['KS', 'KD'] });
  g.playCards(room, 0, ['5C']);
  const out = g.callCheat(room, 2);
  assert.deepEqual(out, { ok: true, lie: true });
  assert.deepEqual(sorted(room.hands[0]), sorted(['5D', '8S', '5C', 'KS', 'KD']));
  assert.deepEqual(room.pile, []);
  assert.equal(room.last, null);
  assert.equal(room.lastCall.picker, 0);
  assert.equal(room.lastCall.pileSize, 3);
  assert.deepEqual(room.lastCall.cards, ['5C']);
  assert.equal(room.turn, 1, 'play goes on with the next player');
  assert.deepEqual([room.tally[0].liesCaught, room.tally[2].callsMade, room.tally[2].callsCorrect], [1, 1, 1]);
});

test('calling a true play: the caller picks up the pile', () => {
  const room = started();
  stage(room, [['AS', '8S'], ['2C', '9D'], ['3C', '4D'], ['6C', '7D']], { pile: ['KS'] });
  g.playCards(room, 0, ['AS']);
  assert.deepEqual(g.callCheat(room, 1), { ok: true, lie: false });
  assert.deepEqual(sorted(room.hands[1]), sorted(['2C', '9D', 'AS', 'KS']));
  assert.equal(room.lastCall.picker, 1);
  assert.deepEqual([room.tally[1].callsMade, room.tally[1].callsCorrect, room.tally[0].liesCaught], [1, 0, 0]);
});

test('only the last play can be called, and not by its player', () => {
  const room = started();
  stage(room, [['AS', '8S'], ['2C', '9D'], ['3C', '4D'], ['6C', '7D']]);
  assert.deepEqual(g.callCheat(room, 1), { ok: false, error: 'nothingToCall' }, 'nothing to call yet');
  g.playCards(room, 0, ['AS']);
  assert.deepEqual(g.callCheat(room, 0), { ok: false, error: 'callOwnPlay' }, 'your own play');
  assert.deepEqual(g.callCheat(room, 9), { ok: false, error: 'notInGame' });
  g.playCards(room, 1, ['2C']);
  assert.equal(room.last.seat, 1, 'the earlier play can no longer be called');
});

test('going out: the last play can still be caught, otherwise the player wins', () => {
  // Caught lying: they pick the pile up and the game goes on.
  let room = started();
  stage(room, [['5C'], ['2C', '9D'], ['3C', '4D'], ['6C', '7D']], { pile: ['KS'] });
  g.playCards(room, 0, ['5C']);
  assert.equal(room.phase, 'check');
  assert.equal(room.turn, null);
  assert.deepEqual(g.playCards(room, 1, ['2C']), { ok: false, error: 'notPlaying' }, 'nobody plays during the final check');
  assert.equal(g.callCheat(room, 3).ok, true);
  assert.equal(room.phase, 'playing');
  assert.deepEqual(sorted(room.hands[0]), ['5C', 'KS']);
  assert.equal(room.turn, 1);

  // Called wrongly: the player who went out wins (and the caller takes the pile).
  room = started();
  stage(room, [['AS'], ['2C', '9D'], ['3C', '4D'], ['6C', '7D']], { pile: ['KS'] });
  g.playCards(room, 0, ['AS']);
  g.callCheat(room, 2);
  assert.equal(room.phase, 'finished');
  assert.equal(room.winner, 0);
  assert.equal(room.hands[2].length, 4);

  // Believed by everyone: they win.
  room = started(3);
  stage(room, [['5C'], ['2C'], ['3C']]);
  g.playCards(room, 0, ['5C']);
  assert.deepEqual(g.accept(room, 0), { ok: false, error: 'acceptOwnPlay' }, 'you cannot accept your own play');
  assert.equal(g.accept(room, 1).ok, true);
  assert.equal(room.phase, 'check', 'one more to accept');
  assert.equal(g.accept(room, 1).ok, true, 'accepting twice is harmless');
  assert.equal(room.phase, 'check');
  g.accept(room, 2);
  assert.equal(room.phase, 'finished');
  assert.equal(room.winner, 0);
  assert.deepEqual(room.cardsLeft, [0, 1, 1]);
});

test('accepting is only for the final check', () => {
  const room = started();
  stage(room, [['AS', '8S'], ['2C'], ['3C'], ['6C']]);
  g.playCards(room, 0, ['AS']);
  assert.deepEqual(g.accept(room, 1), { ok: false, error: 'nothingToAccept' });
});

test('the statistics: one entry per person, with the outcome, the place and the tally as extras', () => {
  const room = started(3);
  stage(room, [['5C'], ['2C', '3C'], ['3D']]);
  g.playCards(room, 0, ['5C']);
  g.accept(room, 1);
  g.accept(room, 2);
  const [mine, ...rest] = g.statsPlayers(room);
  assert.deepEqual([mine.userId, mine.outcome, mine.placement, mine.score], [1, 'win', 1, 0]);
  assert.equal(mine.extras.liesTold, 1);
  assert.equal(rest.length, 0, 'computer players are not recorded');
});

test('leaving mid-game hands the seat to a computer player; the room is empty when no person is left', () => {
  const room = started();
  assert.equal(g.addHuman(room, 5, 'Bob').ok, false, 'the game has started');
  assert.equal(g.seatOf(room, 5), -1);
  assert.equal(g.removeHuman(room, 99, Math.random).ok, false);
  const out = g.removeHuman(room, 1, Math.random);
  assert.equal(out.ok && out.empty, true, 'the only person has left');
});

test('play again returns to the lobby with the same seats', () => {
  const room = started(3);
  assert.deepEqual(g.playAgain(room, 1), { ok: false, error: 'notOver' }, 'not until the game is over');
  stage(room, [['5C'], ['2C'], ['3C']]);
  g.playCards(room, 0, ['5C']);
  g.accept(room, 1);
  g.accept(room, 2);
  assert.deepEqual(g.playAgain(room, 2), { ok: false, error: 'hostOnly' });
  assert.equal(g.playAgain(room, 1).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.seats.filter(Boolean).length, 3);
  assert.equal(room.winner, null);
});

test('what a player is sent: their own hand, never the others, the pile only as a count', () => {
  const room = started(4, 7);
  const view = g.viewFor(room, 1);
  assert.deepEqual(view.hand, room.hands[0]);
  const text = JSON.stringify(view);
  for (const card of room.hands[1]) if (!room.hands[0].includes(card)) assert.ok(!text.includes(`"${card}"`), `${card} stays hidden`);
  g.playCards(room, room.turn, [room.hands[room.turn][0]]);
  const after = g.viewFor(room, 1);
  assert.equal(typeof after.pile, 'number');
  assert.equal(after.last.cards, undefined, 'the cards of the last play are not sent');
  assert.equal(after.last.lie, undefined);
});

test('the tally counts brazen lies, bad calls, and lies that nobody called before the next play', () => {
  const room = started();
  stage(room, [['5C', '5D', '8S', '9S', 'KH'], ['2C', '2D', '9D'], ['3C', '4D'], ['6C', '7D']]);
  g.playCards(room, 0, ['5C', '5D', '8S', '9S']); // four cards claimed as aces: brazen
  assert.deepEqual([room.tally[0].liesTold, room.tally[0].brazenLies, room.tally[0].liesGotAway], [1, 1, 0]);
  g.playCards(room, 1, ['2C', '2D']); // the next play stands: nobody called the lie
  assert.equal(room.tally[0].liesGotAway, 1);
  assert.equal(room.tally[1].brazenLies, 0, 'two cards, and true');
  g.callCheat(room, 3); // the 2s were true
  assert.deepEqual([room.tally[3].callsMade, room.tally[3].badCalls, room.tally[3].callsCorrect], [1, 1, 0]);
  assert.equal(room.tally[0].liesGotAway, 1, 'a lie that was called did not get away');
});

test('going out with a lie that is believed is a clean getaway; winning without lying is an honest win', () => {
  const liar = started(3);
  stage(liar, [['5C'], ['2C', '3C'], ['3D']]);
  g.playCards(liar, 0, ['5C']);
  g.accept(liar, 1);
  g.accept(liar, 2);
  const [won] = g.statsPlayers(liar);
  assert.deepEqual([won.extras.cleanGetaways, won.extras.liesGotAway, won.extras.honestWins], [1, 1, 0]);

  const honest = started(3);
  stage(honest, [['AS'], ['2C', '3C'], ['3D']]);
  g.playCards(honest, 0, ['AS']);
  g.accept(honest, 1);
  g.accept(honest, 2);
  const [truthful] = g.statsPlayers(honest);
  assert.deepEqual([truthful.extras.cleanGetaways, truthful.extras.honestWins], [0, 1]);
  assert.equal(g.viewFor(honest, 1).seats[0].stats.honestWins, undefined, 'the table only shows the four public counters');
});

test('picking up the pile that completes a suit is counted, once, and only when the suit was not already whole', () => {
  const clubs = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].map((rank) => `${rank}C`);
  const room = started();
  stage(room, [['AH', '8S'], [...clubs.filter((c) => c !== 'KC'), 'KD'], ['3H', '4D'], ['6H', '7D']], { pile: ['KC', '9H'] });
  g.playCards(room, 0, ['AH']);
  g.callCheat(room, 1); // wrong: the ace was true, so seat 1 picks up the pile, with the King of Clubs
  assert.equal(room.tally[1].fullSuits, 1);
  assert.equal(g.statsPlayers(room).length, 1);
  stage(room, [['AH', '8S'], room.hands[1], ['3H', '4D'], ['6H', '7D']], { turn: 0, pile: ['5H'] });
  g.playCards(room, 0, ['AH']);
  g.callCheat(room, 1);
  assert.equal(room.tally[1].fullSuits, 1, 'they already held the whole suit');
});

test('a person who leaves a finished game stays on the table as gone, so the views of the others still make sense', () => {
  const room = started();
  room.seats[1] = { kind: 'human', id: 2, name: 'Bob' };
  stage(room, [['AS'], ['2C', '9D'], ['3C', '4D'], ['6C', '7D']], { pile: ['KS'] });
  g.playCards(room, 0, ['AS']);
  g.callCheat(room, 2);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(g.removeHuman(room, 1, seeded(1), 0), { ok: true, empty: false, seat: 0, replaced: false });
  assert.equal(room.phase, 'finished', 'the game stays finished');
  assert.deepEqual(room.seats[0], { kind: 'gone', name: 'Ann' });
  assert.equal(room.hostId, 2, 'the host passes on');
  const view = g.viewFor(room, 2, { online: () => true });
  assert.equal(view.seats[0].name, 'Ann', 'the final standings still name them');
  assert.equal(view.seats[0].online, false, 'but they are away');
  assert.equal(view.scoreboard.players[0].away, true);
  assert.equal(view.scoreboard.players.length, room.seats.length, 'no seat is missing from the scoreboard');
  assert.equal(g.playAgain(room, 2).ok, true);
  assert.equal(room.seats[0], null, 'their seat is free for the next game');
});

test("a computer player's decision about the final play keeps its key while people accept it, so its timer is not restarted", () => {
  const room = started();
  room.seats[2] = { kind: 'human', id: 2, name: 'Bob' };
  stage(room, [['5C'], ['2C', '9D'], ['3C', '4D'], ['6C', '7D']], { pile: ['KS'] });
  g.playCards(room, 0, ['5C']);
  assert.equal(room.phase, 'check');
  const before = g.pendingAction(room);
  assert.deepEqual([before.type, before.seat], ['decide', 1]);
  assert.equal(g.accept(room, 2).ok, true);
  assert.equal(g.pendingAction(room).key, before.key, 'Bob accepting changes nothing for the deciding computer');
});
