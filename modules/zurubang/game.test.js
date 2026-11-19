// The rules of Zurubang with no sockets: a turn, a challenge, and a duel laid out and fought — and what each of them does
// to the score, the hands, and whose turn it is next.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';

const rng = () => seeded(7);

/** A started game between Ann (seat 0) and Bob (seat 1), with the turn given to whoever the test wants it. */
function table({ target = 30, turn = 0 } = {}) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { target }, now: 0 });
  assert.equal(game.addHuman(room, 2, 'Bob').ok, true);
  assert.equal(game.start(room, 1, seeded(3)).ok, true);
  room.turn = turn;
  room.marker = turn;
  return room;
}

/** Deals both players the hands a test wants, and leaves plenty on the stacks. */
function rig(room, mine, theirs, stacks = null) {
  room.hands = [[...mine], [...theirs]];
  if (stacks) room.stacks = stacks.map((stack) => [...stack]);
}

/** Takes a duel from an accepted challenge all the way to its result, placing hands in the order they are held. */
function fightItOut(room, r = rng()) {
  assert.equal(game.answer(room, other(room.duel.challenger), true).ok, true);
  assert.equal(game.chooseStarter(room, other(room.duel.challenger), room.duel.challenger).ok, true);
  for (let placed = 0; placed < 10; placed++) {
    const next = game.placer(room);
    assert.ok(next, 'somebody is always owed a card until all ten are down');
    assert.equal(game.place(room, next.seat, room.hands[next.seat][0]).ok, true);
  }
  while (room.phase === 'revealing') assert.equal(game.revealNext(room, r).ok, true);
}

const other = (seat) => (seat === 0 ? 1 : 0);

test('a game starts with five cards each, three stacks, and nothing in the graveyard', () => {
  const room = table();
  assert.deepEqual(
    room.hands.map((hand) => hand.length),
    [5, 5],
  );
  assert.equal(room.stacks.length, 3);
  assert.equal(room.stacks.flat().length, 95);
  assert.deepEqual(room.graveyard, []);
  assert.equal(room.phase, 'turn');
});

test('swapping one card changes that card, keeps the hand at five, and passes the turn', () => {
  const room = table({ turn: 0 });
  const thrown = room.hands[0][2];
  assert.equal(game.swapOne(room, 0, thrown, 1, rng()).ok, true);
  assert.equal(room.hands[0].length, 5);
  assert.ok(!room.hands[0].includes(thrown));
  assert.deepEqual(room.graveyard, [thrown]);
  assert.equal(room.turn, 1);
});

test('a card you are not holding is refused, and the room is left exactly as it was', () => {
  const room = table({ turn: 0 });
  const before = JSON.stringify(room);
  const outcome = game.swapOne(room, 0, 'white-01', 0, rng());
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, 'notInHand');
  assert.equal(JSON.stringify(room), before);
});

test('it is refused when it is the other player\'s turn, whatever they are holding', () => {
  const room = table({ turn: 1 });
  assert.equal(game.swapOne(room, 0, room.hands[0][0], 0, rng()).error, 'notYourTurn');
  assert.equal(game.challenge(room, 0).error, 'notYourTurn');
});

test('throwing the whole hand away gives the other player a point and a fresh hand of five', () => {
  const room = table({ turn: 0 });
  const old = [...room.hands[0]];
  assert.equal(game.swapAll(room, 0, [0, 0, 1, 1, 2], rng()).ok, true);
  assert.equal(room.hands[0].length, 5);
  assert.equal(old.some((card) => room.hands[0].includes(card)), false);
  assert.equal(room.seats[1].score, 1);
  assert.equal(room.seats[0].stats.dumped, 1);
  assert.equal(room.turn, 1);
});

test('declining a challenge is five points to the challenger, and the next turn to the one who declined', () => {
  const room = table({ turn: 0 });
  assert.equal(game.challenge(room, 0).ok, true);
  assert.equal(room.phase, 'challenged');
  assert.equal(game.answer(room, 1, false).ok, true);
  assert.equal(room.seats[0].score, 5);
  assert.equal(room.seats[0].stats.refused, 1);
  assert.equal(room.seats[1].stats.declined, 1);
  assert.equal(room.turn, 1, 'a challenge is a turn like any other, so the turn passes');
  assert.equal(room.phase, 'turn');
});

test('only the challenged player may answer a challenge, or say who places first', () => {
  const room = table({ turn: 0 });
  game.challenge(room, 0);
  assert.equal(game.answer(room, 0, true).error, 'notYourChallenge');
  assert.equal(game.answer(room, 1, true).ok, true);
  assert.equal(game.chooseStarter(room, 0, 0).error, 'notYourChallenge');
  assert.equal(game.chooseStarter(room, 1, 0).ok, true);
});

test('the cards go down one, two, two, two, two, one — so the last card is the second player\'s, and forced', () => {
  const room = table({ turn: 0 });
  game.challenge(room, 0);
  game.answer(room, 1, true);
  game.chooseStarter(room, 1, 0); // Ann starts
  const order = [];
  for (let placed = 0; placed < 10; placed++) {
    const next = game.placer(room);
    order.push(next.seat);
    assert.equal(game.place(room, next.seat, room.hands[next.seat][0]).ok, true);
  }
  assert.deepEqual(order, [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
  assert.equal(game.placer(room), null);
  assert.equal(room.phase, 'revealing');
  assert.deepEqual(
    room.hands.map((hand) => hand.length),
    [0, 0],
    'every card is on the battlefield until the duel is closed',
  );
});

test('each side fills its own positions in order, from the stacks outwards', () => {
  const room = table({ turn: 0 });
  game.challenge(room, 0);
  game.answer(room, 1, true);
  game.chooseStarter(room, 1, 0);
  const wanted = [...room.hands[0]];
  for (let placed = 0; placed < 10; placed++) {
    const next = game.placer(room);
    game.place(room, next.seat, room.hands[next.seat][0]);
  }
  assert.deepEqual(room.duel.placed[0], wanted);
});

test('a card has to be placed by whoever is owed one, and only out of their own hand', () => {
  const room = table({ turn: 0 });
  game.challenge(room, 0);
  game.answer(room, 1, true);
  game.chooseStarter(room, 1, 0);
  assert.equal(game.place(room, 1, room.hands[1][0]).error, 'notYourTurnToPlace');
  assert.equal(game.place(room, 0, room.hands[1][0]).error, 'notInHand');
});

test('the winner of a duel banks every point of it, and the loser nothing at all', () => {
  const room = table({ turn: 0 });
  // Ann holds five Dragons' worth of power against Bob's five weakest cards, so there is no doubt about it.
  rig(room, ['white-22', 'white-21', 'white-19', 'blue-20', 'green-16'], ['white-03', 'black-02', 'red-03', 'blue-02', 'green-02']);
  game.challenge(room, 0);
  fightItOut(room);
  assert.equal(room.phase, 'duelOver');
  const result = room.duel.result;
  assert.equal(result.winner, 0);
  assert.ok(result.banked > 0);
  assert.equal(room.seats[0].score, result.banked + result.bonus);
  assert.equal(room.seats[1].score, 0);
  assert.equal(room.seats[0].stats.duelsWon, 1);
  assert.equal(room.seats[1].stats.duelsFought, 1, 'both of them fought it');
});

test('the duel is closed by both players, the cards come back, and the challenged player has the next turn', () => {
  const room = table({ turn: 0 });
  rig(room, ['white-22', 'white-21', 'white-19', 'blue-20', 'green-16'], ['white-03', 'black-02', 'red-03', 'blue-02', 'green-02']);
  game.challenge(room, 0);
  fightItOut(room);
  assert.equal(game.ready(room, 0, rng()).ok, true);
  assert.equal(room.phase, 'duelOver', 'one of them is not both of them');
  assert.equal(game.ready(room, 1, rng()).ok, true);
  assert.equal(room.phase, 'turn');
  assert.equal(room.turn, 1, 'the player who was challenged takes the next turn');
  assert.deepEqual(
    room.hands.map((hand) => hand.length),
    [5, 5],
  );
  assert.equal(room.duel, null);
});

test('a rainbow hand is worth two more points, and five of a kind four', () => {
  const room = table({ turn: 0 });
  // Five different backs against five of the same, both judged the moment the duel starts.
  rig(room, ['white-22', 'green-16', 'red-21', 'black-21', 'blue-20'], ['white-03', 'white-06', 'white-07', 'white-08', 'white-09']);
  game.challenge(room, 0);
  game.answer(room, 1, true);
  game.chooseStarter(room, 1, 0);
  assert.deepEqual(room.duel.special, ['rainbow', 'fiveOfAKind']);
  for (let placed = 0; placed < 10; placed++) {
    const next = game.placer(room);
    game.place(room, next.seat, room.hands[next.seat][0]);
  }
  while (room.phase === 'revealing') game.revealNext(room, rng());
  const result = room.duel.result;
  assert.equal(result.bonus, result.winner === 0 ? 2 : 4);
  assert.equal(room.seats[result.winner].stats[result.winner === 0 ? 'rainbowWins' : 'fiveOfAKindWins'], 1);
});

test('a level duel goes to sudden death, which both players pick in secret', () => {
  const room = table({ turn: 0 });
  // The same five cards on both sides: every fight is a draw, so the duel is level at five each.
  rig(room, ['white-06', 'white-07', 'white-08', 'green-17', 'green-19'], ['white-07', 'white-06', 'white-08', 'green-17', 'green-19']);
  game.challenge(room, 0);
  game.answer(room, 1, true);
  game.chooseStarter(room, 1, 0);
  for (let placed = 0; placed < 10; placed++) {
    const next = game.placer(room);
    game.place(room, next.seat, room.hands[next.seat][0]);
  }
  while (room.phase === 'revealing') game.revealNext(room, rng());
  assert.equal(room.phase, 'sudden');
  assert.deepEqual(room.duel.points, [5, 5]);
  assert.equal(game.suddenPick(room, 0, 0, rng()).ok, true);
  assert.equal(game.suddenPick(room, 0, 1, rng()).error, 'alreadyPicked');
  assert.equal(room.phase, 'sudden', 'nothing happens until the other fist opens');
  assert.equal(game.suddenPick(room, 1, 3, rng()).ok, true);
  assert.ok(['sudden', 'duelOver'].includes(room.phase));
});

test('a pick has to be one of the five positions, and not one already out of the sudden death', () => {
  const room = table({ turn: 0 });
  rig(room, ['white-06', 'white-07', 'white-08', 'green-17', 'green-19'], ['white-07', 'white-06', 'white-08', 'green-17', 'green-19']);
  game.challenge(room, 0);
  game.answer(room, 1, true);
  game.chooseStarter(room, 1, 0);
  for (let placed = 0; placed < 10; placed++) game.place(room, game.placer(room).seat, room.hands[game.placer(room).seat][0]);
  while (room.phase === 'revealing') game.revealNext(room, rng());
  assert.equal(game.suddenPick(room, 0, 9, rng()).error, 'pickAPosition');
  assert.equal(game.suddenPick(room, 0, 'nonsense', rng()).error, 'pickAPosition');
});

test('reaching the target ends the game, whichever way the points came', () => {
  const room = table({ target: 20, turn: 0 });
  room.seats[0].score = 16;
  game.challenge(room, 0);
  game.answer(room, 1, false); // five for a decline takes Ann to 21
  assert.equal(room.phase, 'finished');
  assert.equal(room.winner, 0);
  assert.equal(room.seats[0].score, 21);
});

test('the scoreboard keeps a row for every way a point was scored', () => {
  const room = table({ turn: 0 });
  game.swapAll(room, 0, [], rng());
  game.challenge(room, 1);
  game.answer(room, 0, false);
  assert.equal(room.history.length, 2);
  assert.deepEqual(room.history[0].deltas, { 1: 1 });
  assert.deepEqual(room.history[1].deltas, { 1: 5 });
});

test('a view shows you your own hand, and the other player nothing but your backs', () => {
  const room = table({ turn: 0 });
  const ann = game.viewFor(room, 1);
  const bob = game.viewFor(room, 2);
  assert.deepEqual(ann.hand, room.hands[0]);
  assert.equal(ann.theirHand.length, 5);
  assert.equal(ann.theirHand.every((card) => card.id === undefined && typeof card.back === 'string'), true);
  assert.deepEqual(bob.hand, room.hands[1]);
  assert.equal(ann.stacks.reduce((a, b) => a + b, 0), 95, 'the stacks are counted, never listed');
  assert.equal(typeof ann.graveyard, 'number');
});

test('a card on the battlefield is the other player\'s secret until it has fought', () => {
  const room = table({ turn: 0 });
  game.challenge(room, 0);
  game.answer(room, 1, true);
  game.chooseStarter(room, 1, 0);
  for (let placed = 0; placed < 10; placed++) {
    const next = game.placer(room);
    game.place(room, next.seat, room.hands[next.seat][0]);
  }
  const before = game.viewFor(room, 1);
  assert.equal(before.duel.placed[0].every((card) => card.id), true, 'you know what you put down');
  assert.equal(before.duel.placed[1].every((card) => card.id === undefined), true, 'and nothing of theirs');
  game.revealNext(room, rng());
  const after = game.viewFor(room, 1);
  assert.ok(after.duel.placed[1][0].id, 'until the pair has been turned over');
  assert.equal(after.duel.placed[1][1].id, undefined, 'and no further than that');
});

test('what a hand of backs is worth is judged on the backs alone', () => {
  assert.equal(game.specialHand(['white-01', 'green-01', 'red-01', 'black-01', 'blue-01']), 'rainbow');
  assert.equal(game.specialHand(['white-01', 'white-02', 'white-03', 'white-04', 'white-05']), 'fiveOfAKind');
  assert.equal(game.specialHand(['white-01', 'white-02', 'red-01', 'black-01', 'blue-01']), null);
  assert.equal(game.specialHand(['white-01']), null, 'and never on a hand that is not five');
});

test('play again puts the same two back in the lobby with the scores cleared and the slots kept', () => {
  const room = table({ target: 20, turn: 0 });
  room.seats[0].score = 16;
  game.challenge(room, 0);
  game.answer(room, 1, false);
  assert.equal(game.playAgain(room, 2).error, 'hostOnly');
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(
    room.seats.map((seat) => seat.score),
    [0, 0],
  );
  assert.equal(room.history.length, 0);
  assert.equal(room.gameSeq, 1, 'the game just played keeps its scoreboard under its own number');
});

test('a game that is not over cannot be played again, and a lobby is not a game that is over', () => {
  const room = table();
  assert.equal(game.playAgain(room, 1).error, 'notOver');
});

test('the settings are the host\'s, and only in the lobby', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: {}, now: 0 });
  assert.equal(room.target, 30);
  assert.equal(game.setSettings(room, 1, { target: 50 }).ok, true);
  assert.equal(room.target, 50);
  assert.equal(game.setSettings(room, 1, { target: 7 }).error, 'badTarget');
  assert.equal(room.target, 50, 'a setting that is refused changes nothing');
  assert.equal(game.setSettings(room, 2, { target: 20 }).error, 'hostOnly');
});

test('a game needs two players, and at least one of them has to be a person', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: {}, now: 0 });
  assert.equal(game.start(room, 1, seeded(1)).error, 'minPlayers');
  assert.equal(game.addBot(room, 1).ok, true);
  assert.equal(game.start(room, 1, seeded(1)).ok, true);
  assert.equal(room.phase, 'turn');
});

test('every computer player is given an AI when the game starts, and it is kept on the seat', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: {}, now: 0 });
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(5));
  assert.equal(typeof room.seats[1].ai, 'string');
  assert.equal(room.seats[0].ai, undefined, 'and a person is given none');
});

test('a room saved without the newer fields is brought up to date rather than breaking', () => {
  const room = table();
  delete room.history;
  delete room.duelNo;
  delete room.marker;
  room.log = [{ text: 'an old line that was never a message' }];
  game.migrate(room);
  assert.deepEqual(room.history, []);
  assert.equal(room.duelNo, 0);
  assert.deepEqual(room.log, []);
});
