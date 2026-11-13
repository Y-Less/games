// Seeded random whole games of Splendour played through the rules with *people* at the table: any legal move chosen at
// random (not a computer's idea of a good one), payments made a different way each time, moves nobody is allowed to
// make, people walking out in the middle of a choice, and the room saved and loaded as it goes.  After every step the
// things rules.md promises must hold: a turn is exactly one action, tokens go where the rules say and nowhere else,
// nobody ends a turn with more than ten, one noble visits when one can, the round is finished before the game ends,
// the most prestige wins, a refused move changes nothing, and nobody is sent a card that is face down to them.
//
// bot.test.js plays hundreds of computer-only games with kit.js's conservation check after every action; this is the
// other half: what a person can do that a computer player never tries.
//
// Every failure names its seed and step, so a run can be repeated: `playGame(seed)`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import * as bot from './bot.js';
import { CARD_BY_ID, NOBLE_BY_ID } from './cards.js';
import { assertViewIsClean, checkInvariants } from './kit.js';
import { seeded } from '../../shared/testkit.js';

const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const sum = (list) => list.reduce((a, b) => a + b, 0);
const GOLD = 5;
const STRANGER = 999;
const NOBLE_PRESTIGE = 3; // rules.md: "that noble visits you and is worth 3 prestige"
const TOKEN_LIMIT = 10; // rules.md: "at most 10 tokens (Gold included) at the end of your turn"
const RESERVE_LIMIT = 3; // rules.md: "at most 3 reserved cards"

/** A player's prestige, added up here from the cards and nobles they hold rather than asked of the game. */
const prestige = (player) => sum(player.bought.map((id) => CARD_BY_ID[id].points)) + NOBLE_PRESTIGE * player.nobles.length;
/** A player's discounts: one in its colour for every card they own. */
const discounts = (player) => [0, 1, 2, 3, 4].map((colour) => player.bought.filter((id) => CARD_BY_ID[id].bonus === colour).length);
/** The nobles on the table this player's cards are enough for. */
const nobleCanVisit = (room, player) => {
  const have = discounts(player);
  return room.nobles.filter((id) => Object.entries(NOBLE_BY_ID[id].requires).every(([colour, count]) => have[colour] >= count));
};

/** A lobby of two to four seats with one or more people (accounts 1, 2...) and computer players in the rest. */
function newGame(rng) {
  const seats = 2 + Math.floor(rng() * 3);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'p1', settings: { seats, target: pick(rng, [10, 10, 15, 20]) }, now: 0 });
  const people = 1 + Math.floor(rng() * seats);
  for (let id = 2; id <= people; id++) assert.equal(game.addHuman(room, id, `p${id}`).ok, true);
  assert.equal(game.fillWithBots(room, 1, seats).ok, true);
  return room;
}

/** Another way of paying for a card the player can afford: Gold in place of some of the gems, where they hold it. */
function someOtherPayment(room, seat, id, rng) {
  const { pay } = game.payment(room.players[seat], CARD_BY_ID[id]);
  const paid = [...pay];
  let spare = room.players[seat].tokens[GOLD] - paid[GOLD];
  for (let colour = 0; colour < 5; colour++) {
    while (spare > 0 && paid[colour] > 0 && rng() < 0.5) {
      paid[colour]--;
      paid[GOLD]++;
      spare--;
    }
  }
  return paid;
}

/** Moves that must be refused, and must leave the room exactly as it was. */
function tryIllegalMoves(room, rng) {
  const n = room.seats.length;
  const seat = room.turn;
  const player = room.players[seat];
  const other = (seat + 1 + Math.floor(rng() * (n - 1))) % n;
  const snapshot = JSON.stringify(room);
  const refused = (result, what) => {
    assert.equal(result.ok, false, `${what} must be refused`);
    assert.equal(typeof result.error, 'string', `${what}: a refusal carries a code`);
    assert.equal(JSON.stringify(room), snapshot, `${what}: a refused move changed the room`);
  };
  const onTable = [1, 2, 3].flatMap((level) => room.board[level]).filter(Boolean);
  const anyMove = [
    () => game.takeGems(room, other, [0, 1, 2]),
    () => game.takeTwo(room, other, 0),
    () => game.reserveCard(room, other, { level: 1 }),
    () => game.buyCard(room, other, onTable[0]),
    () => game.passTurn(room, other),
    () => game.returnTokens(room, other, [1, 0, 0, 0, 0, 0]),
    () => game.chooseNoble(room, other, room.nobles[0]),
  ];
  for (const move of anyMove) refused(move(), 'a move out of turn');

  if (room.pending) {
    // In the middle of a choice, the choice is the only thing left of the turn.
    refused(game.takeGems(room, seat, [0, 1, 2]), 'taking gems with a choice pending');
    refused(game.takeTwo(room, seat, 0), 'taking two with a choice pending');
    refused(game.reserveCard(room, seat, { level: 1 }), 'reserving with a choice pending');
    refused(game.buyCard(room, seat, onTable[0]), 'buying with a choice pending');
    refused(game.passTurn(room, seat), 'passing with a choice pending');
    if (room.pending.type === 'return') {
      const count = room.pending.count;
      const held = player.tokens.findIndex((t) => t > 0);
      const give = (colour, amount) => [0, 1, 2, 3, 4, 5].map((c) => (c === colour ? amount : 0));
      refused(game.returnTokens(room, seat, give(held, count + 1)), 'returning more than the excess');
      refused(game.returnTokens(room, seat, give(held, count - 1)), 'returning less than the excess');
      const none = player.tokens.findIndex((t) => t === 0);
      if (none !== -1) refused(game.returnTokens(room, seat, give(none, count)), 'returning tokens that are not held');
      for (const bad of [undefined, null, 'x', [], [count], give(held, -count), give(held, 0.5), { 0: count }]) refused(game.returnTokens(room, seat, bad), `returning ${JSON.stringify(bad)}`);
      refused(game.chooseNoble(room, seat, room.nobles[0]), 'choosing a noble when there are tokens to return');
    } else {
      const notOffered = Object.keys(NOBLE_BY_ID).find((id) => !room.pending.options.includes(id));
      for (const bad of [notOffered, undefined, null, 'n99', 3, {}]) refused(game.chooseNoble(room, seat, bad), `choosing the noble ${String(bad)}`);
      refused(game.returnTokens(room, seat, [1, 0, 0, 0, 0, 0]), 'returning tokens when there is a noble to choose');
    }
    return;
  }

  const open = [0, 1, 2, 3, 4].filter((colour) => room.supply[colour] > 0);
  const empty = [0, 1, 2, 3, 4].filter((colour) => room.supply[colour] === 0);
  for (const colours of [undefined, null, 'x', [], [0, 0, 1], [0, 1, 2, 3], [0, 1, GOLD], [0, 1, -1], [0, 1, 1.5], ['0', '1', '2']]) refused(game.takeGems(room, seat, colours), `taking ${JSON.stringify(colours)}`);
  if (open.length >= 3) {
    refused(game.takeGems(room, seat, open.slice(0, 2)), 'taking two different gems when three colours are left');
    refused(game.takeGems(room, seat, open.slice(0, 1)), 'taking one gem when three colours are left');
  }
  if (empty.length && open.length >= 2) refused(game.takeGems(room, seat, [empty[0], open[0], open[1]]), 'taking a gem of a colour that has run out');
  for (let colour = 0; colour < 5; colour++) if (room.supply[colour] < 4) refused(game.takeTwo(room, seat, colour), 'taking two of a colour with fewer than four left');
  for (const colour of [GOLD, -1, 1.5, '0', null, undefined]) refused(game.takeTwo(room, seat, colour), `taking two of colour ${String(colour)}`);

  const inPile = [1, 2, 3].flatMap((level) => room.decks[level]);
  const theirs = room.players[other].reserved.map((r) => r.card);
  for (const hidden of [inPile[0], theirs[0], 'c00', 'zz', 7, null].filter((id) => id !== undefined)) {
    refused(game.buyCard(room, seat, hidden), `buying ${String(hidden)}, which is not on the table or in this player's reserve`);
    if (typeof hidden === 'string') refused(game.reserveCard(room, seat, { card: hidden }), `reserving ${hidden}, which is not on the table`);
  }
  for (const level of [0, 4, 1.5, '1', null, undefined]) refused(game.reserveCard(room, seat, { level }), `reserving from pile ${String(level)}`);
  for (const level of [1, 2, 3]) if (!room.decks[level].length) refused(game.reserveCard(room, seat, { level }), 'reserving from an empty pile');
  if (player.reserved.length >= RESERVE_LIMIT) {
    refused(game.reserveCard(room, seat, { card: onTable[0] }), 'reserving a fourth card');
    refused(game.reserveCard(room, seat, { level: 1 }), 'reserving a fourth card, blind');
  }
  const mine = [...onTable, ...player.reserved.map((r) => r.card)];
  for (const id of mine) {
    const quote = game.payment(player, CARD_BY_ID[id]);
    if (!quote) {
      refused(game.buyCard(room, seat, id), 'buying a card the player cannot afford');
      continue;
    }
    // A card they can afford, paid for wrongly: too much, too little, or with tokens they do not hold.
    const over = [...quote.pay];
    over[GOLD]++;
    refused(game.buyCard(room, seat, id, over), 'paying a Gold too many');
    const paidIn = quote.pay.findIndex((t) => t > 0);
    if (paidIn !== -1) {
      const under = [...quote.pay];
      under[paidIn]--;
      refused(game.buyCard(room, seat, id, under), 'paying a token too few');
    }
    for (const bad of ['x', [], [1, 1], { 0: 1 }, quote.pay.map((t) => -t - 1), quote.pay.map((t) => t + 0.5)]) refused(game.buyCard(room, seat, id, bad), `paying ${JSON.stringify(bad)}`);
  }
  if (game.legalMoves(room, seat).length) refused(game.passTurn(room, seat), 'passing when there is something to do');
  refused(game.returnTokens(room, seat, [0, 0, 0, 0, 0, 0]), 'returning tokens when not over the limit');
  refused(game.chooseNoble(room, seat, room.nobles[0]), 'choosing a noble when none is waiting');
  refused(game.start(room, room.hostId, rng), 'starting a game that has started');
  refused(game.setSettings(room, room.hostId, { target: 10 }), 'changing the settings mid-game');
  refused(game.playAgain(room, room.hostId), 'playing again before the game is over');
}

/**
 * Plays one seeded game to the end, checking everything after every step.
 * @param {number} seed
 * @returns {{ room: object, steps: number, seen: Record<string, number> }}
 */
function playGame(seed) {
  const rng = seeded(seed);
  let room = newGame(rng);
  let step = 0;
  const seen = { returns: 0, nobles: 0, choices: 0, golds: 0, left: 0, leftMidChoice: 0, blind: 0 };
  try {
    assert.equal(game.start(room, 1, rng).ok, true);
    const n = room.seats.length;
    const target = room.settings.target;
    const perColour = { 2: 4, 3: 5, 4: 7 }[n]; // rules.md: "4 tokens with two players, 5 with three, and 7 with four"
    assert.deepEqual(room.supply, [perColour, perColour, perColour, perColour, perColour, 5], 'the supply for this many players, and always 5 Gold');
    assert.equal(room.nobles.length, n + 1, 'one more noble than there are players');
    for (const level of [1, 2, 3]) assert.equal(room.board[level].filter(Boolean).length, 4, 'four cards of each level face up');
    assert.deepEqual([room.turn, room.round], [0, 1]);
    checkInvariants(room, 'the deal');

    /** One whole turn by `seat` (the action, then any tokens to return, then any noble to choose), made by `act`. */
    const takeTurn = (seat, act) => {
      const player = room.players[seat];
      const before = { nobles: player.nobles.length, bought: player.bought.length, reserved: player.reserved.length, tokens: [...player.tokens], supply: [...room.supply], round: room.round, others: JSON.stringify(room.players.filter((_, i) => i !== seat)) };
      act(player, before);
      assert.equal(room.pending, null, 'a turn that is over leaves no choice behind');
      assert.ok(sum(player.tokens) <= TOKEN_LIMIT, `nobody ends a turn with more than ten tokens (seat ${seat} has ${sum(player.tokens)})`);
      assert.equal(JSON.stringify(room.players.filter((_, i) => i !== seat)), before.others, 'a turn changes nobody else\'s tokens or cards');
      const visited = player.nobles.length - before.nobles;
      assert.ok(visited === 0 || visited === 1, 'only one noble can visit each turn');
      if (visited === 0) assert.deepEqual(nobleCanVisit(room, player), [], 'a noble the player has the cards for visits at the end of the turn');
      const grew = (player.bought.length - before.bought) + (player.reserved.length - before.reserved);
      assert.ok(player.bought.length - before.bought <= 1 && grew <= 1, 'a turn is exactly one action: at most one card bought or reserved');
      seen.nobles += visited;
      if (room.phase === 'finished') return assert.equal(seat, n - 1, 'the round is finished before the game ends, so everybody has had the same number of turns');
      if (seat < n - 1) assert.deepEqual([room.turn, room.round], [seat + 1, before.round], 'the turn passes to the next seat');
      else assert.deepEqual([room.turn, room.round], [0, before.round + 1], 'after the last seat a new round begins with the first');
    };

    /** A person's action: any legal move at all, with a lean towards buying so that games get somewhere. */
    const personAction = (seat, player, before) => {
      const moves = game.legalMoves(room, seat);
      if (!moves.length) return assert.equal(game.passTurn(room, seat).ok, true, 'with nothing at all to do, you pass');
      const buys = moves.filter((move) => move.type === 'buy');
      const move = buys.length && rng() < 0.8 ? pick(rng, buys) : pick(rng, moves);
      const goldLeft = room.supply[GOLD];
      if (move.type === 'buy') {
        const card = CARD_BY_ID[move.card];
        const wasBlind = player.reserved.find((r) => r.card === move.card)?.blind === true;
        const need = card.cost.map((cost, colour) => Math.max(0, cost - discounts(player)[colour]));
        const pay = rng() < 0.5 ? someOtherPayment(room, seat, move.card, rng) : undefined;
        assert.equal(game.buyCard(room, seat, move.card, pay).ok, true);
        const paid = before.tokens.map((held, colour) => held - player.tokens[colour]);
        assert.ok(paid.every((t) => t >= 0), 'buying only ever costs tokens');
        assert.equal(sum(paid), sum(need), 'the price is the cost less a discount of one for every card owned in that colour');
        for (let colour = 0; colour < 5; colour++) assert.ok(paid[colour] <= need[colour], 'no colour is overpaid');
        assert.equal(paid[GOLD], sum(need) - sum(paid.slice(0, 5)), 'Gold pays for exactly the gems that are short');
        if (pay) assert.deepEqual(paid, pay, 'the player chose how to pay');
        assert.deepEqual(room.supply, before.supply.map((held, colour) => held + paid[colour]), 'paid tokens go back to the supply');
        assert.ok(player.bought.includes(move.card), 'the card is theirs');
        if (paid[GOLD]) seen.golds++;
        if (wasBlind) seen.blind++;
      } else if (move.type === 'take') {
        assert.equal(game.takeGems(room, seat, move.colours).ok, true);
        assert.equal(new Set(move.colours).size, move.colours.length, 'different colours');
        const open = before.supply.slice(0, 5).filter((held) => held > 0).length;
        if (open >= 3) assert.equal(move.colours.length, 3, 'three gems while three colours are left');
        else assert.ok(move.colours.length >= 1 && move.colours.length <= open, 'fewer only when fewer colours are left');
        for (let colour = 0; colour < 6; colour++) {
          const took = move.colours.includes(colour) ? 1 : 0;
          assert.deepEqual([player.tokens[colour], room.supply[colour]], [before.tokens[colour] + took, before.supply[colour] - took], 'one of each colour taken, from the supply');
        }
      } else if (move.type === 'takeTwo') {
        assert.ok(before.supply[move.colour] >= 4, 'two of a colour only when at least four are in the supply');
        assert.equal(game.takeTwo(room, seat, move.colour).ok, true);
        assert.deepEqual([player.tokens[move.colour], room.supply[move.colour]], [before.tokens[move.colour] + 2, before.supply[move.colour] - 2]);
      } else {
        assert.ok(before.reserved < RESERVE_LIMIT, 'at most three reserved cards');
        const top = move.level ? room.decks[move.level].at(-1) : null;
        assert.equal(game.reserveCard(room, seat, move.card !== undefined ? { card: move.card } : { level: move.level }).ok, true);
        assert.equal(player.reserved.at(-1).card, move.card ?? top, 'the card named, or the top of the pile');
        assert.equal(player.tokens[GOLD], before.tokens[GOLD] + (goldLeft > 0 ? 1 : 0), 'a Gold comes with it if any is left');
        assert.equal(room.supply[GOLD], goldLeft - (goldLeft > 0 ? 1 : 0));
      }
      if (move.type === 'buy' || (move.type === 'reserve' && move.card !== undefined)) {
        const level = CARD_BY_ID[move.card].level;
        if (room.decks[level].length) assert.ok(room.board[level].every(Boolean), 'the gap in the table is filled from that pile');
      }
    };

    /** Whatever is left of a person's turn after the action: tokens to put back, then a noble to choose. */
    const personChoices = (seat, player) => {
      if (room.pending?.type === 'return') {
        const count = room.pending.count;
        assert.equal(count, sum(player.tokens) - TOKEN_LIMIT, 'exactly the tokens over ten are to be returned');
        if (rng() < 0.5) tryIllegalMoves(room, rng);
        const give = [0, 0, 0, 0, 0, 0];
        const have = [...player.tokens];
        for (let k = 0; k < count; k++) {
          const colour = pick(rng, [0, 1, 2, 3, 4, 5].filter((c) => have[c] > 0));
          have[colour]--;
          give[colour]++;
        }
        const supply = [...room.supply];
        assert.equal(game.returnTokens(room, seat, give).ok, true, 'tokens of the player\'s own choice');
        assert.deepEqual(player.tokens, have);
        assert.deepEqual(room.supply, supply.map((held, colour) => held + give[colour]), 'they go back to the supply');
        seen.returns++;
      }
      if (room.pending?.type === 'noble') {
        assert.ok(room.pending.options.length > 1, 'a choice is between several');
        assert.deepEqual([...room.pending.options].sort(), nobleCanVisit(room, player).sort(), 'the choice is between the nobles the player has the cards for');
        if (rng() < 0.5) tryIllegalMoves(room, rng);
        const chosen = pick(rng, room.pending.options);
        assert.equal(game.chooseNoble(room, seat, chosen).ok, true);
        assert.equal(player.nobles.at(-1), chosen);
        seen.choices++;
      }
    };

    while (room.phase === 'playing') {
      step++;
      assert.ok(step < 2000, 'the game must end');
      const seat = room.turn;
      const people = room.seats.flatMap((s, i) => (game.isHuman(s) ? [i] : []));
      if (room.turn === 0 && !room.pending) {
        assert.ok(room.players.every((player) => prestige(player) < target), 'nobody starts a round already at the target: the game ended with the round they reached it in');
        assert.ok(room.round <= game.MAX_ROUNDS, 'a game that has dragged on for 100 rounds ends');
      }

      if (rng() < 0.01 && people.length > 1) {
        // Somebody walks out between turns: a computer player takes the seat with everything in it.
        const leaving = pick(rng, people);
        const held = JSON.stringify(room.players[leaving]);
        const result = game.removeHuman(room, room.seats[leaving].id, rng);
        assert.deepEqual([result.ok, result.empty, result.replaced], [true, false, true]);
        assert.equal(game.isBot(room.seats[leaving]), true, 'a computer player took the seat');
        assert.equal(JSON.stringify(room.players[leaving]), held, 'with its tokens, cards, and nobles');
        assert.ok(game.isHuman(room.seats[game.seatOf(room, room.hostId)]), 'the host is still a person');
        seen.left++;
      } else if (game.isBot(room.seats[seat])) {
        assert.deepEqual(bot.pendingAction(room), { type: 'turn', seat });
        takeTurn(seat, () => assert.deepEqual(bot.runPending(room, rng), { type: 'turn', seat }));
      } else {
        assert.equal(bot.pendingAction(room), null, 'the computer players wait for a person');
        if (rng() < 0.3) tryIllegalMoves(room, rng);
        takeTurn(seat, (player, before) => {
          personAction(seat, player, before);
          if (room.pending && people.length > 1 && rng() < 0.5) {
            // They walk out with the choice still to make: the computer player that takes the seat finishes the turn.
            assert.equal(game.removeHuman(room, room.seats[seat].id, rng).ok, true);
            assert.deepEqual(bot.pendingAction(room), { type: 'turn', seat }, 'the choice is the computer player\'s to make now');
            bot.runPending(room, rng);
            seen.leftMidChoice++;
          } else personChoices(seat, player);
        });
      }

      checkInvariants(room, 'after the step');
      if (step % 5 === 0) for (const id of [...room.seats.filter(game.isHuman).map((s) => s.id), STRANGER]) assertViewIsClean(room, id, game.seatOf(room, id), 'a view');
      if (step % 23 === 0) {
        // The room is saved as JSON; what comes back must be the same room, and the game carries on from the copy.
        const loaded = JSON.parse(JSON.stringify(room));
        assert.deepEqual(loaded, room, 'a saved room loads as it was');
        room = loaded;
      }
    }

    // The end: the round was finished, the most prestige wins, fewer cards breaks a tie, and a level tie is shared.
    const turns = room.players.map((player) => player.tally.turnsTaken);
    assert.ok(turns.every((t) => t === turns[0]), `everybody has had the same number of turns (${turns})`);
    const best = Math.max(...room.players.map(prestige));
    const leaders = room.players.flatMap((player, i) => (prestige(player) === best ? [i] : []));
    const fewest = Math.min(...leaders.map((i) => room.players[i].bought.length));
    assert.deepEqual([...room.winners].sort(), leaders.filter((i) => room.players[i].bought.length === fewest), 'the most prestige wins, and fewer cards bought breaks a tie');
    if (room.endReason === 'target') assert.ok(best >= target, 'somebody reached the target');
    else assert.ok(best < target, 'nobody reached the target: the game ran out of moves or of rounds');
    const rows = game.statsPlayers(room);
    const people = room.seats.flatMap((s, i) => (game.isHuman(s) ? [i] : []));
    assert.deepEqual(rows.map((row) => row.userId), people.map((i) => room.seats[i].id), 'the statistics have a row for each person still seated, and none for a computer player');
    rows.forEach((row, at) => {
      const seat = people[at];
      assert.equal(row.outcome, room.winners.includes(seat) ? 'win' : 'loss');
      assert.equal(row.score, prestige(room.players[seat]), 'the score is the prestige');
      assert.equal(row.placement === 1, room.winners.includes(seat), 'first place is the winners\'');
    });
    seen[room.endReason] = 1;
  } catch (error) {
    error.message = `seed ${seed}, step ${step}: ${error.message}`;
    throw error;
  }
  return { room, steps: step, seen };
}

test('random games with people in them: every step keeps to one action a turn, the token and noble rules, and the ending the rules describe', () => {
  const GAMES = 60;
  let steps = 0;
  const totals = {};
  const tables = new Set();
  for (let seed = 1; seed <= GAMES; seed++) {
    const result = playGame(seed);
    steps += result.steps;
    tables.add(result.room.seats.length);
    for (const [key, value] of Object.entries(result.seen)) totals[key] = (totals[key] ?? 0) + value;
  }
  // The run has to have gone where the checks are, or passing means nothing.
  assert.deepEqual([...tables].sort(), [2, 3, 4], 'every size of table was played');
  for (const key of ['returns', 'nobles', 'golds', 'left', 'blind', 'target']) assert.ok(totals[key] > 0, `the games included ${key}`);
  console.log(`  ${GAMES} games, ${steps} steps: ${JSON.stringify(totals)}`);
});

test('a game is the same game every time for a seed: the rules use only the random numbers they are given', () => {
  for (const seed of [5, 31]) assert.equal(JSON.stringify(playGame(seed).room), JSON.stringify(playGame(seed).room), `seed ${seed}`);
});
