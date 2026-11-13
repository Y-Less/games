// What Splendour counts about each player (tally.js) for the statistics and the achievements: each counter on its own,
// the counters against the list module.json promises the site, and the ones that depend on *how* a card was bought
// (for nothing, or out of a card reserved unseen) taken through the rules.  An achievement is earned from these numbers
// and nothing else, so a counter that drifts hands out (or withholds) achievements without any rule being broken.
//
// game.test.js already takes tokenReturns, nobleChoices, level3Bought, and pipped through the rules; those are not
// repeated here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as game from './game.js';
import { CARDS, CARD_BY_ID, NOBLE_BY_ID } from './cards.js';
import { started } from './kit.js';
import { STAT_KEYS, TOP_LEVEL, newTally, tallyBuy, tallyNoble, tallyNobleChoice, tallyReserve, tallyReturn, tallyTurn } from './tally.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'module.json'), 'utf8'));
const sum = (list) => list.reduce((a, b) => a + b, 0);
/** The counters that are not zero, so a test can say everything that was counted and nothing else was. */
const counted = (tally) => Object.fromEntries(Object.entries(tally).filter(([, value]) => value !== 0));

/** Gives a seat exact tokens, taking them out of (or putting them back in) the supply so that none are made or lost. */
function setTokens(room, seat, tokens) {
  for (let c = 0; c < 6; c++) {
    room.supply[c] += room.players[seat].tokens[c] - tokens[c];
    room.players[seat].tokens[c] = tokens[c];
  }
}
/** Gives a seat `count` bought cards of a colour, worth nothing, out of the piles: the discounts and nothing else. */
function giveBonuses(room, seat, colour, count) {
  const plain = CARDS.filter((card) => card.bonus === colour && card.points === 0 && room.decks[card.level].includes(card.id)).slice(0, count);
  assert.equal(plain.length, count, 'enough plain cards in the piles to hand out');
  for (const card of plain) {
    room.decks[card.level].splice(room.decks[card.level].indexOf(card.id), 1);
    room.players[seat].bought.push(card.id);
    room.players[seat].tally.cardsBought++;
  }
}

test('a fresh tally has every counter, at zero', () => {
  const tally = newTally();
  assert.deepEqual(Object.keys(tally).sort(), [...STAT_KEYS].sort());
  assert.deepEqual(counted(tally), {});
});

test('a card bought is counted, and a level 3 card on its own as well', () => {
  const tally = newTally();
  tallyBuy(tally, { level: 1 });
  tallyBuy(tally, { level: 2 });
  assert.deepEqual(counted(tally), { cardsBought: 2 });
  tallyBuy(tally, { level: 3 });
  assert.deepEqual(counted(tally), { cardsBought: 3, level3Bought: 1 });
  assert.equal(TOP_LEVEL, 3, 'there are three levels of development card (rules.md)');
});

test('a card that cost no tokens, and one bought out of a blind reserve, are each counted as that too', () => {
  const tally = newTally();
  tallyBuy(tally, { level: 1 }, { free: true });
  assert.deepEqual(counted(tally), { cardsBought: 1, freeCards: 1 });
  tallyBuy(tally, { level: 2 }, { blind: true });
  assert.deepEqual(counted(tally), { cardsBought: 2, freeCards: 1, blindBuys: 1 });
  tallyBuy(tally, { level: 3 }, { free: true, blind: true });
  assert.deepEqual(counted(tally), { cardsBought: 3, level3Bought: 1, freeCards: 2, blindBuys: 2 });
  tallyBuy(tally, { level: 1 }, { free: false, blind: false });
  assert.deepEqual(counted(tally), { cardsBought: 4, level3Bought: 1, freeCards: 2, blindBuys: 2 });
});

test('a reserve, a noble, a turn, a choice of nobles, and a return of tokens are each counted once, on their own counter', () => {
  const tally = newTally();
  tallyReserve(tally);
  assert.deepEqual(counted(tally), { reservedCards: 1 });
  tallyNoble(tally);
  assert.deepEqual(counted(tally), { reservedCards: 1, noblesVisited: 1 });
  tallyTurn(tally);
  tallyTurn(tally);
  assert.deepEqual(counted(tally), { reservedCards: 1, noblesVisited: 1, turnsTaken: 2 });
  tallyNobleChoice(tally);
  tallyReturn(tally);
  assert.deepEqual(counted(tally), { reservedCards: 1, noblesVisited: 1, turnsTaken: 2, nobleChoices: 1, tokenReturns: 1 });
});

test('a tally saved before a counter existed still counts (a missing counter reads as zero)', () => {
  const old = { cardsBought: 2 };
  tallyBuy(old, { level: 3 }, { free: true, blind: true });
  tallyReturn(old);
  assert.deepEqual(old, { cardsBought: 3, level3Bought: 1, freeCards: 1, blindBuys: 1, tokenReturns: 1 });
});

test('module.json lists exactly the statistics the game records, and every achievement is earned from one of them', () => {
  const listed = manifest.stats.map((stat) => stat.key);
  assert.equal(new Set(listed).size, listed.length, 'no statistic is listed twice');
  const room = started(2);
  room.phase = 'finished';
  room.winners = [0];
  const [row] = game.statsPlayers(room);
  assert.deepEqual(Object.keys(row.extras).sort(), [...listed].sort(), 'what is recorded for a person is what module.json says there is');
  for (const achievement of manifest.achievements) {
    if (achievement.stat !== undefined) assert.ok(listed.includes(achievement.stat), `the achievement "${achievement.key}" counts ${achievement.stat}, which is recorded`);
  }
});

test('through the rules: a card the discounts pay for entirely is a free card, and one paid for with tokens is not', () => {
  const room = started(2);
  // A card on the table that costs gems of one colour only, and enough discounts in that colour to cover all of it.
  const card = room.board[1].map((id) => CARD_BY_ID[id]).find((c) => c.cost.filter(Boolean).length === 1) ?? CARD_BY_ID[room.board[1][0]];
  card.cost.forEach((cost, colour) => giveBonuses(room, 0, colour, cost));
  setTokens(room, 0, [0, 0, 0, 0, 0, 0]);
  const bought = room.players[0].tally.cardsBought;
  assert.equal(game.buyCard(room, 0, card.id).ok, true);
  assert.deepEqual([room.players[0].tally.cardsBought - bought, room.players[0].tally.freeCards], [1, 1]);

  // The other player buys one honestly: tokens change hands, so it is not free.
  const other = CARD_BY_ID[room.board[1].find(Boolean)];
  setTokens(room, 1, [...other.cost, 0]);
  assert.equal(game.buyCard(room, 1, other.id).ok, true);
  assert.equal(sum(other.cost) > 0, true, 'no card is free to begin with');
  assert.deepEqual([room.players[1].tally.cardsBought, room.players[1].tally.freeCards], [1, 0]);
});

test('through the rules: buying a card reserved unseen from a pile is a blind buy; one reserved from the table is not', () => {
  const room = started(2);
  assert.equal(game.reserveCard(room, 0, { level: 1 }).ok, true, 'the top of the pile, unseen');
  const faceUp = room.board[1][0];
  assert.equal(game.reserveCard(room, 1, { card: faceUp }).ok, true, 'a card everybody could see');
  assert.deepEqual([room.players[0].tally.reservedCards, room.players[1].tally.reservedCards], [1, 1]);
  for (const seat of [0, 1]) {
    const id = room.players[seat].reserved[0].card;
    setTokens(room, seat, [...CARD_BY_ID[id].cost, 0]);
    assert.equal(game.buyCard(room, seat, id).ok, true);
  }
  assert.deepEqual([room.players[0].tally.blindBuys, room.players[0].tally.cardsBought], [1, 1]);
  assert.deepEqual([room.players[1].tally.blindBuys, room.players[1].tally.cardsBought], [0, 1]);
});

test('through the rules: the most nobles in one game is recorded as the number who visited, and each is counted', () => {
  const room = started(2);
  const noble = NOBLE_BY_ID[room.nobles[0]];
  for (const [colour, count] of Object.entries(noble.requires)) giveBonuses(room, 0, Number(colour), count);
  const visiting = game.qualifyingNobles(room, 0);
  assert.ok(visiting.includes(noble.id), 'the bonuses are enough for that noble');
  // Any turn will do: a noble visits at the end of it (rules.md, "Nobles").
  assert.equal(game.takeGems(room, 0, [0, 1, 2]).ok, true);
  if (room.pending?.type === 'noble') assert.equal(game.chooseNoble(room, 0, noble.id).ok, true);
  assert.equal(room.players[0].nobles.length, 1, 'only one noble can visit each turn');
  assert.equal(room.players[0].tally.noblesVisited, 1);
  room.phase = 'finished';
  room.winners = [0];
  const [row] = game.statsPlayers(room);
  assert.equal(row.extras.noblesVisited, 1);
  assert.equal(row.extras.mostNobles, 1, 'module.json: "Most nobles to visit you in one game"');
  assert.equal(manifest.stats.find((stat) => stat.key === 'mostNobles').agg, 'max', 'kept as the most in any one game, not added up');
});
