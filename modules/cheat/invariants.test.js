// Seeded random whole games of Cheat played through the rules: people who tell the truth, lie, call, and believe at
// random, computer players using their own judgement, moves nobody is allowed to make, and people walking out and
// sitting back down in the middle.  After every step the things rules.md promises must hold: the whole pack is in the
// hands and the pile and nowhere else, the rank to claim runs Ace to King and round again, whoever is wrong about a call
// picks up the whole pile, nobody wins while their last play can still be caught, a refused move changes nothing, and
// nobody is sent a card they may not see.
//
// game.test.js stages each rule once; this is the same rules meeting each other in every order a seed can find.
// Every failure names its seed and step, so a run can be repeated: `playGame(seed)`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import * as bot from './bot.js';
import { rankOf } from '../../shared/cards.js';
import { assertNoLeaks } from '../../shared/leaks.js';
import { seeded } from '../../shared/testkit.js';

// A card as it is written in a view: the rank then the suit letter, as shared/cards.js makes them.
const CARD = /\b(?:10|[2-9JQKA])[CDHS]\b/g;
const RANKS_IN_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']; // rules.md: Aces, then 2s, up to Kings
const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const sorted = (cards) => [...cards].sort();
const STRANGER = 999;

/** A lobby of three to seven seats with one or more people (accounts 1, 2...) and computer players in the rest. */
function newGame(rng) {
  const seats = 3 + Math.floor(rng() * 5);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'p1', settings: { seats }, now: 0 });
  const people = 1 + Math.floor(rng() * seats);
  for (let id = 2; id <= people; id++) assert.equal(game.addHuman(room, id, `p${id}`).ok, true);
  assert.equal(game.fillWithBots(room, 1, seats).ok, true);
  return room;
}

/** Everything that must be true of a room whatever has just happened. */
function checkRoom(room, pack) {
  const n = room.seats.length;
  assert.deepEqual(sorted([...room.hands.flat(), ...room.pile]), pack, 'the whole pack is in the hands and the pile, each card once');
  assert.ok(['playing', 'check', 'finished'].includes(room.phase), `a phase the game has: ${room.phase}`);
  if (room.last) {
    assert.ok(room.last.count >= 1 && room.last.count <= 4, 'a play is one to four cards');
    assert.equal(room.last.cards.length, room.last.count);
    assert.deepEqual(room.pile.slice(-room.last.count), room.last.cards, 'the last play is the top of the pile');
    assert.equal(room.last.lie, room.last.cards.some((card) => rankOf(card) !== room.last.rank), 'a play is a lie exactly when a card is not of the rank claimed');
  }
  if (room.phase === 'playing') {
    assert.ok(Number.isInteger(room.turn) && room.turn >= 0 && room.turn < n, 'somebody is to play');
    assert.ok(room.hands.every((hand) => hand.length > 0), 'nobody is out of cards while the game is still being played');
  }
  if (room.phase === 'check') {
    assert.ok(room.last, 'the final check is about a play');
    assert.equal(room.hands[room.last.seat].length, 0, 'the final check is for somebody who has played their last card');
  }
  if (room.phase === 'finished') {
    assert.equal(room.hands[room.winner].length, 0, 'the winner got rid of every card');
    assert.equal(room.hands.filter((hand) => hand.length === 0).length, 1, 'and nobody else did');
  }
  for (const [seat, tally] of room.tally.entries()) {
    assert.equal(tally.callsMade, tally.callsCorrect + tally.badCalls, `seat ${seat}: every call was right or wrong`);
    const standing = room.last?.lie && room.last.seat === seat ? 1 : 0;
    assert.equal(tally.liesTold, tally.liesCaught + tally.liesGotAway + standing, `seat ${seat}: every lie was caught, got away, or can still be called`);
  }
  assert.ok(room.seats.some(game.isHuman), 'a person is still at the table');
  assert.ok(game.isHuman(room.seats[game.seatOf(room, room.hostId)]), 'and one of them is the host');
}

/** Every view of the room: a hand reaches its owner and nobody else, and the pile is only ever a count. */
function checkViews(room) {
  const before = JSON.stringify(room);
  for (const id of [...room.seats.filter(game.isHuman).map((seat) => seat.id), STRANGER]) {
    const view = game.viewFor(room, id);
    const me = game.seatOf(room, id);
    assert.deepEqual(view.hand, me === -1 ? [] : room.hands[me], 'a person is sent their own hand, and a stranger none');
    assert.equal(view.pile, room.pile.length, 'the pile is a count');
    view.seats.forEach((seat, i) => assert.equal(seat.cards, room.hands[i].length, 'a seat shows how many cards it holds'));
    // The only cards anybody is told about are their own and the ones turned over by a call (rules.md: "the cards just
    // played are turned over").
    assertNoLeaks(view, { allowed: [...view.hand, ...(view.lastCall?.cards ?? [])], pattern: CARD, who: me === -1 ? 'a stranger' : `seat ${me}` });
    if (view.last) {
      assert.deepEqual([view.last.seat, view.last.count, view.last.rank], [room.last.seat, room.last.count, room.last.rank], 'everyone sees who played, how many, and the rank claimed');
      assert.ok(!('lie' in view.last) && !('cards' in view.last), 'but not which cards, nor whether it was a lie: that is the game');
    }
    if (['playing', 'check'].includes(room.phase)) assert.equal(view.rank, RANKS_IN_ORDER[room.plays % 13], 'the rank to claim');
    assert.equal(view.canPlay, room.phase === 'playing' && me !== -1 && room.turn === me, 'only the player whose turn it is may play');
  }
  assert.equal(JSON.stringify(room), before, 'looking at a room does not change it');
}

/** Moves that must be refused, and must leave the room exactly as it was. */
function tryIllegalMoves(room, rng) {
  const n = room.seats.length;
  const snapshot = JSON.stringify(room);
  const refused = (result, what) => {
    assert.equal(result.ok, false, `${what} must be refused`);
    assert.equal(typeof result.error, 'string', `${what}: a refusal carries a code`);
    assert.equal(JSON.stringify(room), snapshot, `${what}: a refused move changed the room`);
  };
  const turn = room.turn;
  if (room.phase === 'playing') {
    const hand = room.hands[turn];
    const other = (turn + 1 + Math.floor(rng() * (n - 1))) % n;
    refused(game.playCards(room, other, [room.hands[other][0]]), 'playing out of turn');
    const notHeld = room.hands[other].find((card) => !hand.includes(card)) ?? 'ZZ';
    for (const cards of [undefined, null, 'AS', {}, [], [notHeld], ['ZZ'], [null], [hand[0], notHeld], Array(5).fill(hand[0]), [...hand, ...hand].slice(0, 5)]) {
      refused(game.playCards(room, turn, cards), `playing ${JSON.stringify(cards)}`);
    }
    // The same card twice needs two of it, which only happens with two packs.
    if (hand.filter((card) => card === hand[0]).length === 1) refused(game.playCards(room, turn, [hand[0], hand[0]]), 'playing one card twice');
    refused(game.accept(room, other), 'believing a play that is not a last card');
  } else {
    for (let seat = 0; seat < n; seat++) refused(game.playCards(room, seat, room.hands[seat].slice(0, 1)), 'playing during the final check');
  }
  if (room.last) {
    refused(game.callCheat(room, room.last.seat), 'calling your own play');
    if (room.phase === 'check') refused(game.accept(room, room.last.seat), 'believing your own play');
  } else {
    for (let seat = 0; seat < n; seat++) refused(game.callCheat(room, seat), 'calling when there is no play to call');
  }
  for (const seat of [-1, n, 1.5, null, undefined, '0']) {
    if (room.last) refused(game.callCheat(room, seat), `a call from seat ${String(seat)}`);
    if (room.phase === 'check') refused(game.accept(room, seat), `an accept from seat ${String(seat)}`);
  }
  refused(game.start(room, room.hostId, rng), 'starting a game that has started');
  refused(game.setSettings(room, room.hostId, { seats: 5 }), 'changing the settings mid-game');
  refused(game.playAgain(room, room.hostId), 'playing again before the game is over');
}

/**
 * Plays one seeded game, checking everything after every step.
 * @param {number} seed
 * @returns {{ room: object, steps: number, finished: boolean, seen: Record<string, number> }}
 */
function playGame(seed) {
  const rng = seeded(seed);
  let room = newGame(rng);
  let step = 0;
  let nextId = 50; // accounts that turn up after the start
  const seen = { lies: 0, caught: 0, wrongCalls: 0, left: 0, joined: 0, finalCaught: 0 };
  try {
    assert.equal(game.start(room, 1, rng).ok, true);
    const n = room.seats.length;
    const pack = sorted(game.deckFor(n));
    assert.equal(pack.length, n >= 6 ? 104 : 52, 'one pack, or two for six or seven players');
    const sizes = room.hands.map((hand) => hand.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, 'the whole pack is dealt out, so some may have one card more');
    assert.ok(room.hands[room.turn].includes('AS'), 'the player holding the Ace of Spades goes first');
    assert.equal(room.plays, 0);

    /** A play by `seat`: the cards go face down on the pile, and the turn passes on unless that was their last card. */
    const play = (seat, cards, act) => {
      const before = { hand: [...room.hands[seat]], pile: [...room.pile], plays: room.plays, others: room.hands.map((hand) => [...hand]) };
      const claimed = RANKS_IN_ORDER[room.plays % 13];
      act();
      const played = room.pile.slice(before.pile.length);
      if (cards) assert.deepEqual(played, cards);
      assert.ok(played.length >= 1 && played.length <= 4, 'one to four cards');
      assert.deepEqual(room.pile.slice(0, before.pile.length), before.pile, 'the pile under them is untouched');
      assert.deepEqual(sorted([...room.hands[seat], ...played]), sorted(before.hand), 'the cards came from the player\'s own hand');
      room.hands.forEach((hand, i) => i !== seat && assert.deepEqual(hand, before.others[i], 'nobody else\'s hand changes'));
      assert.equal(room.plays, before.plays + 1);
      assert.deepEqual({ seat: room.last.seat, count: room.last.count, rank: room.last.rank }, { seat, count: played.length, rank: claimed }, 'the play that can be called is this one, at the rank of the turn');
      if (room.last.lie) seen.lies++;
      if (room.hands[seat].length === 0) assert.equal(room.phase, 'check', 'playing a last card is not winning yet: the others may still call it');
      else assert.deepEqual([room.phase, room.turn], ['playing', (seat + 1) % n], 'the turn passes clockwise');
    };

    /**
     * A call by `caller` on the last play: whoever is wrong picks up the whole pile.  A computer player decides for
     * itself whether to call (`mayNot`), and when it lets the play stand no card moves.
     */
    const call = (caller, act, { mayNot = false } = {}) => {
      const { seat: accused, cards, rank } = room.last;
      const lie = cards.some((card) => rankOf(card) !== rank);
      const before = { hands: room.hands.map((hand) => [...hand]), pile: [...room.pile], phase: room.phase, turn: room.turn, plays: room.plays };
      const result = act();
      if (mayNot && !room.lastCall) {
        assert.deepEqual(room.hands, before.hands, 'letting a play stand moves no cards');
        assert.deepEqual(room.pile, before.pile);
        if (room.phase === 'finished') assert.deepEqual([before.phase, room.winner], ['check', accused], 'everybody believed the last card: its player wins');
        else assert.deepEqual([room.phase, room.turn], [before.phase, before.turn], 'and the game is where it was');
        return;
      }
      if (result) assert.deepEqual([result.ok, result.lie], [true, lie], 'the caller is told whether it was a lie');
      const picker = lie ? accused : caller;
      assert.deepEqual(room.pile, [], 'the whole pile is picked up');
      room.hands.forEach((hand, i) => assert.deepEqual(sorted(hand), sorted(i === picker ? [...before.hands[i], ...before.pile] : before.hands[i]), i === picker ? 'by whoever was wrong' : 'and by nobody else'));
      assert.equal(room.last, null, 'a play can be called once');
      assert.deepEqual([room.lastCall.caller, room.lastCall.accused, room.lastCall.lie, room.lastCall.picker], [caller, accused, lie, picker], 'the table is told what the call turned up');
      assert.deepEqual(room.lastCall.cards, cards, 'the cards just played are turned over');
      assert.equal(room.plays, before.plays, 'the next rank is the next rank, whoever picked up');
      if (lie) seen.caught++;
      else seen.wrongCalls++;
      if (before.phase === 'playing') assert.deepEqual([room.phase, room.turn], ['playing', before.turn], 'play carries on with the next player');
      else if (lie) {
        assert.deepEqual([room.phase, room.turn], ['playing', (accused + 1) % n], 'a last card caught out: the game goes on with the next player');
        seen.finalCaught++;
      } else assert.deepEqual([room.phase, room.winner], ['finished', accused], 'called on a true last play: they win');
    };

    while (room.phase !== 'finished' && step < 1500) {
      step++;
      const people = room.seats.flatMap((seat, i) => (game.isHuman(seat) ? [i] : []));
      const pending = bot.pendingAction(room);
      const roll = rng();

      if (roll < 0.008 && people.length > 1) {
        // Somebody walks out: a computer player takes the seat, hand and all.
        const seat = pick(rng, people);
        const hand = [...room.hands[seat]];
        const result = game.removeHuman(room, room.seats[seat].id, rng);
        assert.deepEqual([result.ok, result.empty, result.replaced], [true, false, true]);
        assert.equal(game.isBot(room.seats[seat]), true, 'a computer player took the seat');
        assert.deepEqual(room.hands[seat], hand, 'and the hand');
        seen.left++;
      } else if (roll < 0.016 && room.seats.some(game.isBot)) {
        // Somebody arrives late: they take a computer player's seat, hand and all.
        const hands = JSON.stringify(room.hands);
        const result = game.addHuman(room, nextId, `late${nextId}`);
        assert.equal(result.ok, true, result.error);
        assert.equal(room.seats[result.seat].id, nextId++);
        assert.equal(JSON.stringify(room.hands), hands, 'no card moved');
        seen.joined++;
      } else if (pending && (rng() < 0.6 || !people.length)) {
        const act = () => {
          const done = bot.runPending(room, rng);
          assert.deepEqual([done.type, done.seat], [pending.type, pending.seat]);
        };
        if (pending.type === 'play') play(pending.seat, null, act);
        else call(pending.seat, act, { mayNot: true }); // it calls or lets the play stand, which is its own business
      } else if (people.length) {
        if (rng() < 0.3) tryIllegalMoves(room, rng);
        // Who may still answer the last play: anybody but its player and, in the final check, those yet to answer it.
        const owes = (seat) => game.viewFor(room, room.seats[seat].id).mustRespond;
        const callers = people.filter((seat) => room.last && seat !== room.last.seat && (room.phase !== 'check' || owes(seat)));
        if (room.phase === 'check' && callers.length) {
          // A person answers the last card: mostly "I believe you", sometimes "Cheat!".
          const seat = pick(rng, callers);
          const out = room.last.seat;
          if (rng() < 0.3) call(seat, () => game.callCheat(room, seat));
          else {
            const hands = JSON.stringify(room.hands);
            assert.equal(game.accept(room, seat).ok, true);
            assert.equal(JSON.stringify(room.hands), hands, 'believing a play moves no cards');
            if (room.phase === 'finished') assert.equal(room.winner, out, 'everybody believed the last card: its player wins');
            else assert.equal(room.phase, 'check', 'still waiting for the others');
          }
        } else if (room.phase === 'playing' && callers.length && rng() < 0.25) {
          const seat = pick(rng, callers);
          call(seat, () => game.callCheat(room, seat));
        } else if (room.phase === 'playing' && game.isHuman(room.seats[room.turn])) {
          // A person plays: every card of the rank they hold (up to four) when they feel honest, anything otherwise.
          const seat = room.turn;
          const hand = room.hands[seat];
          const rank = RANKS_IN_ORDER[room.plays % 13];
          const honest = hand.filter((card) => rankOf(card) === rank).slice(0, 4);
          const cards = honest.length && rng() < 0.7 ? honest : [...hand].sort(() => rng() - 0.5).slice(0, 1 + Math.floor(rng() * Math.min(4, hand.length)));
          play(seat, cards, () => assert.equal(game.playCards(room, seat, cards).ok, true));
        } else continue; // nothing for a person to do just now: a computer player goes next time round
      } else continue;

      checkRoom(room, pack);
      if (step % 5 === 0) checkViews(room);
      if (step % 29 === 0) {
        // The room is saved as JSON; what comes back must be the same room, and the game carries on from the copy.
        const loaded = JSON.parse(JSON.stringify(room));
        assert.deepEqual(loaded, room, 'a saved room loads as it was');
        room = loaded;
      }
    }

    if (room.phase === 'finished') {
      checkViews(room);
      const rows = game.statsPlayers(room);
      const people = room.seats.flatMap((seat, i) => (game.isHuman(seat) ? [i] : []));
      assert.deepEqual(rows.map((row) => row.userId), people.map((i) => room.seats[i].id), 'the statistics have a row for each person, and none for a computer player');
      rows.forEach((row, at) => {
        const seat = people[at];
        const left = room.hands[seat].length;
        assert.equal(row.outcome, seat === room.winner ? 'win' : 'loss', 'the first to get rid of every card wins');
        assert.equal(row.score, left, 'the score is the cards left');
        assert.equal(row.placement, 1 + room.hands.filter((hand) => hand.length < left).length, 'fewer cards left is a better place');
        assert.deepEqual(Object.keys(row.extras).sort(), [...game.STAT_KEYS, 'honestWins'].sort());
        assert.equal(row.extras.honestWins, seat === room.winner && room.tally[seat].liesTold === 0 ? 1 : 0, 'an honest win is a win without a single lie');
      });
    }
  } catch (error) {
    error.message = `seed ${seed}, step ${step}: ${error.message}`;
    throw error;
  }
  return { room, steps: step, finished: room.phase === 'finished', seen };
}

test('random games with people in them: every step keeps the pack whole, the calls honest, and every view free of other people\'s cards', () => {
  const GAMES = 150;
  let finished = 0;
  let steps = 0;
  const totals = {};
  const tables = new Set();
  for (let seed = 1; seed <= GAMES; seed++) {
    const result = playGame(seed);
    if (result.finished) finished++;
    steps += result.steps;
    tables.add(result.room.seats.length);
    for (const [key, value] of Object.entries(result.seen)) totals[key] = (totals[key] ?? 0) + value;
  }
  // The run has to have gone where the checks are, or passing means nothing.
  assert.deepEqual([...tables].sort(), [3, 4, 5, 6, 7], 'every size of table was played, with one pack and with two');
  for (const key of ['lies', 'caught', 'wrongCalls', 'left', 'joined', 'finalCaught']) assert.ok(totals[key] > 0, `the games included ${key}`);
  assert.ok(finished > GAMES / 4, `a fair number of the games were played to the end (${finished} of ${GAMES})`);
  console.log(`  ${GAMES} games (${finished} finished), ${steps} steps: ${JSON.stringify(totals)}`);
});

test('a game is the same game every time for a seed: the rules use only the random numbers they are given', () => {
  for (const seed of [4, 23, 77]) assert.equal(JSON.stringify(playGame(seed).room), JSON.stringify(playGame(seed).room), `seed ${seed}`);
});

test('the rank to claim belongs to the turn: Aces, then 2s, up to Kings, and round again', () => {
  // The checks above compare against this list, so it is pinned to the rule (rules.md, "Playing") and to the game.
  assert.deepEqual(game.SEQUENCE, RANKS_IN_ORDER);
  assert.deepEqual([0, 1, 12, 13, 25, 26].map(game.rankFor), ['A', '2', 'K', 'A', 'K', 'A']);
});
