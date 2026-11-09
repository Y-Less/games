// Building Dixnt rooms for the rules tests.  A person's id in a room IS their account id, so the people a test asks
// for are accounts 1, 2, 3 ... in the order it names them, and the first of them is the host.
// Depends on: ./game.js only.
import assert from 'node:assert/strict';
import { createRules } from './game.js';

/** The ids of `n` made-up cards, 1 upwards. */
export const cards = (n) => Array.from({ length: n }, (_, i) => i + 1);
/** `count` card ids from `start` upwards. */
export const range = (start, count) => Array.from({ length: count }, (_, i) => start + i);

/** A repeatable random source, so a test can replay a whole game. */
export function seededRng(seed = 1) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/**
 * A room of the named people (the first is the host, account 1), with whatever settings the test asks for.
 *
 * @param {string[]} names  the people, in join order: the first is account 1, the next account 2, and so on
 * @param {object} [options]
 * @param {number} [options.cardCount]   how many cards exist, as one category (ignored when `categories` is given)
 * @param {object[]} [options.categories]  the categories the cards come in
 * @param {string[]} [options.hints]     the chooser's suggestions
 * @param {number} [options.handSize]    cards in a hand
 * @param {number} [options.roundsEach]  how many times each player chooses the word
 * @param {string} [options.judging]     the play style
 * @param {number} [options.bots]        computer players the host adds before the game starts
 * @param {number} [options.seed]        the seed for the random source (ignored when `rng` is given)
 * @param {() => number} [options.rng]   the random source itself
 * @param {boolean} [options.start]      start the game as well
 * @param {string} [options.code]        the invite code
 * @returns {{ game: object, room: object, rng: () => number, players: object[] }} `players` is the room's live list
 * Side effects: none outside the new room.
 */
export function makeRoom(names, { cardCount = 100, categories = null, hints = [], handSize, roundsEach, judging, bots = 0, seed = 7, rng = seededRng(seed), start = false, code = 'test-game-here' } = {}) {
  const game = createRules(categories ? { getCategories: () => categories, hints } : { getCardIds: () => cards(cardCount), hints });
  const room = game.createRoom({ code, hostId: 1, hostName: names[0], now: 0 });
  // A host sizes the game for the people they are expecting, which is what a test is doing when it names them.
  room.size = Math.max(room.size, names.length + bots);
  names.slice(1).forEach((name, i) => assert.equal(game.addHuman(room, i + 2, name).ok, true, `${name} joins`));
  for (let i = 0; i < bots; i++) assert.equal(game.addBot(room, 1).ok, true, 'a computer player joins');
  const settings = {};
  if (handSize !== undefined) settings.handSize = handSize;
  if (roundsEach !== undefined) settings.roundsEach = roundsEach;
  if (judging !== undefined) settings.judging = judging;
  const set = game.setSettings(room, 1, settings);
  assert.equal(set.ok, true, `the settings are accepted (${set.error})`);
  if (start) {
    const begun = game.start(room, 1, rng);
    assert.equal(begun.ok, true, `the game starts (${begun.error})`);
  }
  return { game, room, rng, players: room.players };
}
