// The computer players: the registry, what each of them is good and bad at, how a room remembers which one a seat
// plays with, and that none of them is ever told the word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiById, describeAI, pickAI } from '../../shared/ai.js';
import { seeded } from '../../shared/random.js';
import { AIS } from './ai/index.js';
import { oneOf, wordsOfLength, wordsThatFit } from './ai/fit.js';
import * as game from './game.js';

const NOW = 1_000_000;
const WORDS = ['house', 'horse', 'mouse', 'hound', 'cat', 'housing', 'pac-man', 'mad hair'];

/** Hints as the view sends them: a word with some of its letters shown. */
const hintsFor = (word, shown = []) =>
  [...word].map((ch, at) => ({ ch: shown.includes(at) || [' ', '-'].includes(ch) ? ch : null, fixed: [' ', '-'].includes(ch), shown: shown.includes(at) }));

/** A context as game.js builds one, with whatever a test wants to change. */
const context = (over = {}) => ({ choices: ['house', 'cat', 'elephant'], hints: hintsFor('house'), words: WORDS, tried: [], seen: [], rng: seeded(1), ...over });

test('every AI is registered properly and can be looked up', () => {
  assert.ok(AIS.length >= 3, 'a range of them, as a game should offer');
  assert.equal(AIS[0].id, 'standard', 'the fallback comes first');
  for (const ai of AIS) {
    assert.match(ai.id, /^[a-z]+$/);
    assert.ok(ai.name && ai.description, ai.id);
    assert.equal(typeof ai.chooseWord, 'function', ai.id);
    assert.equal(typeof ai.guess, 'function', ai.id);
  }
  assert.equal(aiById(AIS, 'gone').id, 'standard', 'an unknown saved id falls back to the first AI');
  assert.deepEqual(Object.keys(describeAI(AIS[0])).sort(), ['description', 'id', 'name'], 'only the public part is shown');
  const picked = new Set(Array.from({ length: 400 }, (_, n) => pickAI(AIS, seeded(n + 1)).id));
  assert.ok(picked.size > 1, 'the random pick is not always the same one');
  for (const id of picked) assert.ok(AIS.some((ai) => ai.id === id));
});

test('every AI chooses one of the words it is offered and guesses a word', () => {
  for (const ai of AIS) {
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = context({ rng: seeded(seed) });
      const n = ai.chooseWord(ctx);
      assert.ok(Number.isInteger(n) && n >= 0 && n < ctx.choices.length, `${ai.id} chose ${n}`);
      const guess = ai.guess(ctx);
      assert.ok(typeof guess === 'string' && guess, `${ai.id} guessed ${guess}`);
      assert.ok(ctx.words.includes(guess), `${ai.id} guessed a word that is not in the list`);
    }
  }
});

test('each AI has its own idea of a guess', () => {
  const hints = hintsFor('house', [0, 2]); // h_us_
  const guesses = (id, over = {}) => {
    const ai = aiById(AIS, id);
    return new Set(Array.from({ length: 40 }, (_, seed) => ai.guess(context({ hints, rng: seeded(seed + 1), ...over }))));
  };
  for (const guess of guesses('standard')) assert.ok(wordsThatFit(hints, WORDS).includes(guess), `standard guessed ${guess}, which the letters rule out`);
  for (const guess of guesses('sharp')) assert.ok(wordsThatFit(hints, WORDS).includes(guess), `sharp guessed ${guess}, which the letters rule out`);
  const hopeful = guesses('hopeful');
  assert.ok([...hopeful].some((guess) => !wordsThatFit(hints, WORDS).includes(guess)), 'hopeful does not look at the letters shown');
  for (const guess of hopeful) assert.equal([...guess].length, 5, 'but it does count them');
  const random = guesses('random');
  assert.ok([...random].some((guess) => [...guess].length !== 5), 'random does not even count them');
});

test('sharp draws the shortest word it is offered and skips what the table has tried', () => {
  const sharp = aiById(AIS, 'sharp');
  assert.equal(sharp.chooseWord(context({ choices: ['elephant', 'cat', 'house'] })), 1, 'the shortest');
  assert.equal(sharp.chooseWord(context({ choices: ['cat', 'dog'] })), 0, 'the first of two as short as each other');
  const hints = hintsFor('house');
  const fitting = wordsThatFit(hints, WORDS);
  const left = sharp.guess(context({ hints, seen: fitting.slice(1), tried: [] }));
  assert.equal(left, fitting[0], 'the one nobody has tried');
});

test('an AI that has nothing left to try still says something', () => {
  for (const ai of AIS) {
    const guess = ai.guess(context({ hints: hintsFor('house'), tried: WORDS, seen: WORDS }));
    assert.ok(typeof guess === 'string' && guess, `${ai.id} gave up`);
  }
});

test('the helpers behind them match only what the hints allow', () => {
  assert.deepEqual(wordsThatFit(hintsFor('house'), WORDS).sort(), ['horse', 'hound', 'house', 'mouse']);
  assert.deepEqual(wordsThatFit(hintsFor('house', [0, 2, 3]), WORDS), ['house'], 'h_us_ leaves one');
  assert.deepEqual(wordsThatFit(hintsFor('pac-man'), WORDS), ['pac-man'], 'the hyphen is matched too');
  assert.deepEqual(wordsThatFit(hintsFor('mad hair'), WORDS), ['mad hair'], 'and the space');
  assert.deepEqual(wordsThatFit([], WORDS), [], 'no hints, no idea');
  assert.deepEqual(wordsOfLength(hintsFor('cat'), WORDS), ['cat']);
  assert.equal(oneOf([], seeded(1)), null);
});

// ---- the rules driving them ----

/** A room of `humans` people and `bots` computer players, started, with the clock and random source used to get there. */
function table(humans = 1, bots = 2, settings = { rounds: 1, drawTime: 30 }) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings, now: NOW, chooseMs: 1000, betweenMs: 500 });
  for (let id = 2; id <= humans; id++) assert.equal(game.addHuman(room, id, `Player ${id}`).ok, true);
  for (let n = 0; n < bots; n++) assert.equal(game.addBot(room, 1).ok, true);
  const rng = seeded(31);
  assert.equal(game.start(room, 1, rng, NOW).ok, true);
  return { room, rng };
}

test('every computer player is given an AI at the start, and the view says which', () => {
  const { room } = table(1, 3);
  const bots = room.players.filter((p) => p.kind === 'bot');
  assert.equal(bots.length, 3);
  for (const bot of bots) assert.ok(AIS.some((ai) => ai.id === bot.ai), `${bot.name} has no AI`);
  const view = game.viewFor(room, 1, { now: NOW });
  for (const player of view.players) {
    if (!player.bot) assert.equal(player.ai, null, 'a person has no AI');
    else assert.deepEqual(Object.keys(player.ai).sort(), ['description', 'id', 'name']);
  }
});

test('a computer player drawing chooses a word, and its own view then shows it', () => {
  const { room, rng } = table(1, 2);
  // Make a computer player the drawer, whoever the order picked.
  room.drawer = room.players.find((p) => p.kind === 'bot').id;
  const action = game.pendingBotAction(room);
  assert.deepEqual(action, { type: 'word', id: room.drawer });
  assert.equal(game.runBotAction(room, rng, NOW, action), true);
  assert.equal(room.phase, 'drawing');
  assert.ok(room.word, 'it chose something');
  assert.equal(game.canDraw(room, room.drawer), true, 'and may now draw it');
  assert.equal(game.pendingBotAction(room)?.type, 'guess', 'the others get on with guessing');
});

test('a computer player guessing is never told the word, and guesses something of the right shape', () => {
  const { room, rng } = table(1, 2);
  room.drawer = 1; // the person draws
  room.choices = ['house'];
  assert.equal(game.chooseWord(room, 1, 0, NOW).ok, true);
  const bot = room.players.find((p) => p.kind === 'bot');
  const context = game.aiContext(room, bot.id, rng);
  assert.equal(context.hints.length, 5, 'it is told how many letters the word has');
  assert.ok(context.hints.every((hint) => hint.ch === null), 'and none of them');
  assert.deepEqual(context.choices, [], 'the words on offer were the drawer’s business');
  assert.equal(game.viewFor(room, bot.id, { now: NOW }).word, null, 'and its own view does not hold the word either');
  assert.ok(context.words.length > 4000, 'it guesses from the list the game itself draws from');

  assert.equal(game.runBotAction(room, rng, NOW, { type: 'guess', id: bot.id }), true);
  const said = room.feed.filter((line) => line.id === bot.id);
  assert.equal(said.length, 1);
  assert.equal([...said[0].text].length, 5, 'a word of the right length');
});

test('the computer players take it in turns to guess', () => {
  const { room, rng } = table(1, 3);
  room.drawer = 1;
  room.choices = ['house'];
  assert.equal(game.chooseWord(room, 1, 0, NOW).ok, true);
  const bots = room.players.filter((p) => p.kind === 'bot').map((p) => p.id);
  const order = [];
  for (let n = 0; n < 9; n++) {
    const action = game.pendingBotAction(room);
    assert.equal(action.type, 'guess');
    order.push(action.id);
    assert.equal(game.runBotAction(room, rng, NOW + n * 4000, action), true);
  }
  for (const id of bots) assert.equal(order.filter((who) => who === id).length, 3, 'each of them had three guesses');
});

test('a computer player that guesses the word scores like anybody else', () => {
  const { room, rng } = table(1, 1);
  room.drawer = 1;
  room.choices = ['house'];
  assert.equal(game.chooseWord(room, 1, 0, NOW).ok, true);
  const bot = room.players.find((p) => p.kind === 'bot');
  assert.equal(game.guess(room, bot.id, 'house', NOW).quality, 'exact');
  assert.ok(bot.score > 0);
  assert.equal(room.phase, 'between', 'everybody has it, so the turn is over');
  assert.equal(game.pendingBotAction(room), null, 'and the computer players have nothing to do');
});

test('a broken AI does not stop the game', () => {
  const { room, rng } = table(1, 1);
  const bot = room.players.find((p) => p.kind === 'bot');
  bot.ai = 'standard';
  const broken = AIS[0];
  const chooseWord = broken.chooseWord;
  const guess = broken.guess;
  try {
    broken.chooseWord = () => {
      throw new Error('no');
    };
    broken.guess = () => {
      throw new Error('no');
    };
    room.drawer = bot.id;
    assert.equal(game.runBotAction(room, rng, NOW, { type: 'word', id: bot.id }), true, 'a word is chosen anyway');
    assert.ok(room.word);
    room.drawer = 1;
    assert.equal(game.runBotAction(room, rng, NOW, { type: 'guess', id: bot.id }), true, 'and a guess is made anyway');
  } finally {
    broken.chooseWord = chooseWord;
    broken.guess = guess;
  }
});

test('a saved room keeps which AI each computer player uses, and one saved before AIs still plays', () => {
  const { room } = table(1, 2);
  const saved = JSON.parse(JSON.stringify(room));
  const back = game.migrate(saved, () => 'Someone');
  const bots = back.players.filter((p) => p.kind === 'bot');
  for (const [n, bot] of bots.entries()) assert.equal(bot.ai, room.players.filter((p) => p.kind === 'bot')[n].ai);
  for (const bot of bots) delete bot.ai; // a room saved before this existed
  const rng = seeded(5);
  back.drawer = bots[0].id;
  back.phase = 'choosing';
  assert.equal(game.runBotAction(back, rng, NOW, { type: 'word', id: bots[0].id }), true, 'it falls back to the first AI');
});

test('a whole game plays itself with nobody but computer players acting', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings: { rounds: 2, drawTime: 30 }, now: NOW, chooseMs: 1000, betweenMs: 500 });
  for (let n = 0; n < 3; n++) assert.equal(game.addBot(room, 1).ok, true);
  const rng = seeded(41);
  let now = NOW;
  assert.equal(game.start(room, 1, rng, now).ok, true);
  // The same order the server works in: whichever is due soonest, the clock or a computer player's move.
  for (let step = 0; step < 4000 && room.phase !== 'finished'; step++) {
    now += 1500;
    if (room.deadline !== null && now >= room.deadline) {
      assert.equal(game.timeUp(room, rng, now, String).ok, true, `the clock in ${room.phase}`);
      continue;
    }
    const action = game.pendingBotAction(room);
    if (action) {
      assert.equal(game.runBotAction(room, rng, now, action), true, `${action.type} by ${action.id}`);
      continue;
    }
    if (room.phase === 'scores') assert.equal(game.forceNextRound(room, rng, now).ok, true);
  }
  assert.equal(room.phase, 'finished');
  assert.equal(room.history.length, 2, 'both rounds were scored');
  // The host is an account sitting at the table doing nothing; the three computer players are not accounts at all.
  assert.deepEqual(game.statsPlayers(room).map((row) => row.userId), [1], 'only the account is recorded');
  assert.ok(room.players.filter((p) => p.kind === 'bot').some((p) => p.wordsDrawn > 0), 'the computer players did the drawing');
});
