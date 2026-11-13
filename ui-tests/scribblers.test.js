// Scribblers: three people in three browsers play a whole game of one round, so each of them draws once.
//
// What is protected here is the journey modules/scribblers/rules.md describes, as it reads on a real screen: words of
// your own are offered to the drawer; the drawer sees the word and the guessers see blanks; a stroke the drawer makes
// arrives on the other boards; a wrong guess is shown to the table, a near miss is shown but only its writer is told it
// was close, and a right guess is announced without being shown; those who have the word can talk without the others
// seeing; letters are shown as the time runs down; and the scoring is the rules' (100 to 260 for a guesser, the average
// of the guessers for the drawer, 5% more or less for every thumb, and nothing at all for a drawing nobody got).  The
// words are ones the players add in the waiting room, which is how the test knows what a near miss for them looks like.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createWorld } from './helpers.js';

const WORDS = ['house', 'zeppelin', 'windmill']; // rules.md's own example of a near miss is "hourse" for "house"
const DRAW_SECONDS = 40; // long enough to play a turn on a loaded machine, short enough to wait out once
const THUMB = 0.05; // "every thumbs up adds 5% to what the drawer scored for the turn"
const UP = 'button[aria-label="Thumbs up: 5% more for the drawer"]';
const DOWN = 'button[aria-label="Thumbs down: 5% less for the drawer"]';
const BOX = '.guess-panel input';

let world;
let host;
let second;
let third;
let people;
before(async () => {
  // Nothing is chosen for a drawer, and no drawer is given up on, however slowly the machine is going; the word stays
  // up between turns long enough to be read off three screens.
  world = await createWorld({ suite: 'scribblers', env: { SCRIBBLERS_CHOOSE_WAIT: '600000', SCRIBBLERS_AWAY_WAIT: '600000', SCRIBBLERS_BETWEEN_WAIT: '8000' } });
  host = await world.newUser('host');
  second = await world.newUser('second');
  third = await world.newUser('third');
  await host.signUp('scrib', { displayName: 'Dora' });
  await second.signUp('scrib', { displayName: 'Sam' });
  await third.signUp('scrib', { displayName: 'Tam' });
  people = [host, second, third];
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const expected = {}; // display name -> the score they should have so far
const drew = new Map(); // who has drawn -> the word they drew
const played = []; // the words drawn so far

/** Waits for something in the page to be so (and answers with what the check returned), with the wait a loaded machine needs. */
async function until(user, what, check, { args = [], timeout = 30000 } = {}) {
  try {
    const handle = await user.page.waitForFunction(check, { timeout, polling: 50 }, ...args);
    const value = await handle.jsonValue().catch(() => true);
    await handle.dispose();
    return value;
  } catch (error) {
    throw new Error(`${user.label}: timed out waiting for ${what}.  The page says:\n${(await user.text()).slice(0, 1200)}\n(${error.message})`);
  }
}
/** Everybody's score as the score bar shows it: { name: score }. */
const chips = (user) =>
  user.page.$$eval('.score-bar .chip', (els) =>
    Object.fromEntries(els.map((el) => [el.querySelector('.name').textContent.replace(/\s*\(you\)\s*$/, '').trim(), Number(el.querySelector('.points').textContent)])),
  );
/** Waits until this player's score bar shows the scores everybody should have. */
const scoresSettle = (user) =>
  until(
    user,
    `the scores ${JSON.stringify(expected)}`,
    (wanted) => {
      const shown = Object.fromEntries([...document.querySelectorAll('.score-bar .chip')].map((el) => [el.querySelector('.name').textContent.replace(/\s*\(you\)\s*$/, '').trim(), Number(el.querySelector('.points').textContent)]));
      return Object.entries(wanted).every(([name, score]) => shown[name] === score);
    },
    { args: [expected] },
  );
/** What the guesses panel says, line by line. */
const feed = (user) => user.page.$$eval('.guess-panel .line', (els) => els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()));
/** Waits for a line of the guesses panel that has all of these in it. */
const feedShows = (user, ...parts) => until(user, `a line in the guesses saying ${parts.join(' + ')}`, (...wanted) => [...document.querySelectorAll('.guess-panel .line')].some((el) => wanted.every((part) => el.textContent.includes(part))), { args: parts });
/** Types into the guesses panel and sends it. */
async function say(user, text) {
  await user.fill(BOX, text);
  await user.page.keyboard.press('Enter');
}
/** Presses a thumb and waits for it to be given (or, with `given: false`, taken back). */
async function thumb(user, selector, { given = true } = {}) {
  await user.waitForSelector(selector);
  await user.page.click(selector);
  await user.waitForSelector(`${selector}[aria-pressed="${given}"]`);
}
/** The word bar: one entry per character, null for a letter that is still hidden. */
const letters = (user) => user.page.$$eval('.word-bar .word .ch', (els) => els.map((el) => (el.classList.contains('blank') ? null : el.textContent)));
/** Is there any ink in the middle band of the board, which is where the drawer's stroke goes? */
const inked = () => {
  const canvas = document.querySelector('canvas.board');
  if (!canvas) return false;
  const data = canvas.getContext('2d').getImageData(480, 430, 640, 40).data; // the board is 1600 x 900 whatever size it is shown at
  for (let i = 0; i < data.length; i += 4) if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) return true;
  return false;
};
/** The drawer drags the pen across the middle of the board. */
async function stroke(drawer) {
  const canvas = await drawer.waitForSelector('canvas.board');
  const box = await canvas.boundingBox();
  const y = box.y + box.height / 2;
  await drawer.page.mouse.move(box.x + box.width * 0.35, y);
  await drawer.page.mouse.down();
  await drawer.page.mouse.move(box.x + box.width * 0.65, y, { steps: 10 });
  await drawer.page.mouse.up();
}
/**
 * Waits for the word to be shown over the board at the end of a turn and reads what is with it, all in one look,
 * because the server takes it away again by itself.
 */
const reveal = (user, word, timeout = 30000) =>
  until(
    user,
    `the word “${word}” to be shown`,
    (title) => {
      const over = document.querySelector('.board-holder .over');
      if (over?.querySelector('.over-title')?.textContent.trim() !== title) return null;
      const rows = [...over.querySelectorAll('.points li')];
      return {
        points: Object.fromEntries(rows.filter((li) => li.querySelector('.who')).map((li) => [li.querySelector('.who').textContent.trim(), li.querySelector('strong').textContent.trim()])),
        nobody: rows.filter((li) => !li.querySelector('.who')).map((li) => li.textContent.trim()),
        page: document.body.innerText,
      };
    },
    { args: [`The word was “${word}”`], timeout },
  );
/** "+123" as a number. */
const plus = (text) => {
  assert.match(text, /^\+\d+$/, `points are shown as +n: "${text}"`);
  return Number(text.slice(1));
};

/**
 * The start of every turn: finds who is drawing, checks what each side is told, has the drawer choose the word of
 * their own that is on offer, draws a stroke, and sees it arrive.  Answers with who is who and the word.
 */
async function startTurn(n) {
  for (const user of people) await user.waitForText(`Turn ${n} of ${people.length}`);
  const roles = await Promise.all(people.map((user) => until(user, 'the words to choose from, or the news that somebody is choosing', () => (document.querySelector('.choices button') ? 'drawer' : document.body.innerText.includes('is choosing a word') ? 'guesser' : null))));
  const drawer = people[roles.indexOf('drawer')];
  const guessers = people.filter((user, i) => roles[i] === 'guesser');
  assert.equal(guessers.length, 2, `one draws and two guess: ${roles.join(', ')}`);
  assert.ok(!drew.has(drawer), `${drawer.displayName} has not drawn already: everybody draws once a round`);

  // The drawer is offered three words (the lobby's setting), one of them a word the players added; the others are told to wait.
  await drawer.waitForText('Your turn: choose a word to draw.');
  await drawer.waitForText('One is chosen for you if you wait.');
  const choices = await drawer.page.$$eval('.choices button', (els) => els.map((el) => el.textContent.trim()));
  assert.equal(choices.length, 3, `three words to choose from: ${choices.join(', ')}`);
  const word = choices.find((choice) => WORDS.includes(choice) && !played.includes(choice));
  assert.ok(word, `one of the words on offer is one the players added and nobody has drawn yet: ${choices.join(', ')}`);
  for (const user of guessers) {
    await user.waitForText(`${drawer.displayName} is choosing a word.`);
    assert.equal(await user.page.$('.choices button'), null, 'a guesser is not shown the words');
  }
  assert.ok(await drawer.clickFound((wanted) => [...document.querySelectorAll('.choices button')].find((button) => button.textContent.trim() === wanted), word));
  played.push(word);
  drew.set(drawer, word);

  // The drawer sees the word and has the tools; the guessers see a blank for every letter, and the thumbs.  The
  // blanks are looked at first, and on both screens at once, because a letter is shown before long.
  const hidden = await Promise.all(guessers.map((user) => until(user, 'the word bar', (length) => (document.querySelectorAll('.word-bar .word .ch').length === length ? [...document.querySelectorAll('.word-bar .word .ch')].map((el) => (el.classList.contains('blank') ? null : el.textContent)) : null), { args: [word.length] })));
  for (const shown of hidden) assert.deepEqual(shown, [...word].map(() => null), 'every letter is hidden from a guesser at the start');
  await drawer.waitForText(`Your turn: draw “${word}”.`);
  await drawer.waitForText('0 of 2 have it so far.');
  await drawer.waitForSelector('.toolbox');
  assert.equal(await drawer.page.$('.votes'), null, 'the drawer has no say in their own drawing');
  assert.equal(await drawer.page.$eval(BOX, (el) => el.placeholder), 'Say something');
  for (const user of guessers) {
    await user.waitForText(`${drawer.displayName} is drawing. Type what you think it is.`);
    await user.waitForText('Guess as often as you like: a wrong guess costs nothing.');
    await user.waitForText(`${word.length} letters`);
    assert.ok(!(await user.text()).includes(word), 'a guesser is not shown the word anywhere');
    assert.equal(await user.page.$('.toolbox'), null, 'a guesser has no tools');
    assert.equal((await user.page.$$('.votes button')).length, 2, 'a guesser has the two thumbs');
    assert.equal(await user.page.$eval(BOX, (el) => el.placeholder), 'Your guess');
    assert.equal(await user.page.evaluate(inked), false, 'the board starts blank');
  }
  // What the drawer draws arrives on everybody else's board.
  await stroke(drawer);
  assert.equal(await drawer.page.evaluate(inked), true, 'the drawer sees their own stroke');
  for (const user of guessers) await until(user, 'the stroke to arrive on the board', inked);
  return { drawer, guessers, word };
}

test('three people join, anybody adds words, and the host sets a short game', { timeout: 120000 }, guarded('lobby', async () => {
  await host.goto('/play/scribblers');
  await host.clickButton('Start a new game');
  await host.waitForText('Waiting for players');
  // The settings start where the rules say: three rounds, ninety seconds to draw.
  await host.waitForText('3 rounds');
  await host.waitForText('90 seconds');
  const code = await host.inviteCode();
  for (const user of [second, third]) {
    await user.goto(`/play/scribblers?${code}`);
    await user.waitForText('Waiting for the host to start.');
  }
  await host.waitForText('Players (3 of 12)');

  // "Anybody at the table can add words in the waiting room"
  for (const [i, user] of people.entries()) {
    await user.fill('input[aria-label="A word to draw"]', WORDS[i]);
    await user.clickButton('Add', { exact: true });
    await until(user, `"${WORDS[i]}" to be among the added words`, (wanted) => [...document.querySelectorAll('ul.words li')].some((li) => li.textContent.trim() === wanted), { args: [WORDS[i]] });
  }
  for (const user of people) {
    await until(user, 'all three added words', (count) => document.querySelectorAll('ul.words li').length === count, { args: [WORDS.length] });
    assert.deepEqual(await user.page.$$eval('ul.words li', (els) => els.map((el) => el.textContent.trim())), WORDS);
  }

  for (const rounds of ['2 rounds', '1 round']) {
    await host.clickButton('Fewer rounds', { exact: true });
    await host.waitForText(rounds);
  }
  for (let seconds = 80; seconds >= DRAW_SECONDS; seconds -= 10) {
    await host.clickButton('Less time to draw', { exact: true });
    await host.waitForText(`${seconds} seconds`);
  }
  await host.waitForText('3 turns in all with 3 players. Everybody draws once a round.');
  await third.waitForText(`${DRAW_SECONDS} seconds`);
  assert.equal(await third.page.$eval('button[aria-label="More rounds"]', (el) => el.disabled), true, 'somebody who is not the host cannot change the options');
  await host.clickButton('Start the game', { exact: true });
  for (const user of people) {
    await user.waitForSelector('.game-frame');
    expected[user.displayName] = 0;
  }
}));

test('turn 1: a wrong guess, a near miss, and a right one; those who have the word talk among themselves; a thumbs up is 5% more for the drawer', { timeout: 180000 }, guarded('turn 1', async () => {
  const { drawer, guessers, word } = await startTurn(1);
  const [first, other] = guessers;

  // A wrong guess is simply shown to the table.
  await say(first, 'xylophone');
  for (const user of people) await feedShows(user, first.displayName, 'xylophone');
  // A near miss ("hourse" for "house") is shown to the table too, and its writer alone is told it was close.
  const near = `${word.slice(0, 3)}r${word.slice(3)}`;
  await say(first, near);
  await feedShows(first, first.displayName, near, 'so close!');
  for (const user of [drawer, other]) {
    await feedShows(user, first.displayName, near);
    assert.ok(!(await feed(user)).some((line) => line.includes('so close!')), `${user.displayName} is not told that somebody else was close`);
  }
  await thumb(first, UP);

  // A right guess is announced, and not shown: it would give the word away.
  await say(first, word);
  for (const user of people) await feedShows(user, `${first.displayName} has the word!`);
  await first.waitForText('You have the word. Sit tight.');
  await first.waitForText('The turn ends when everybody has it, or the time runs out.');
  assert.deepEqual(await letters(first), [...word], 'whoever has the word sees it');
  await drawer.waitForText('1 of 2 have it so far.');
  await drawer.waitForText(`${first.displayName} got the word.`); // Recent moves

  // "The drawer can talk to the people who have already guessed, and they to each other, without the ones still
  // guessing seeing it."
  await say(first, 'lovely drawing');
  await feedShows(drawer, first.displayName, 'lovely drawing');
  await say(drawer, 'thank you kindly');
  await feedShows(first, drawer.displayName, 'thank you kindly');
  await say(other, 'trombone'); // a guess of their own, so that their panel is known to be up to date
  await feedShows(other, other.displayName, 'trombone');
  const kept = await feed(other);
  assert.ok(!kept.some((line) => line.includes('lovely drawing') || line.includes('thank you kindly')), `somebody still guessing does not see the others talking: ${kept.join(' | ')}`);
  assert.ok(!(await other.text()).includes(word), 'nor the word');

  // The turn ends when everybody has the word.
  await say(other, word);
  const shown = await reveal(drawer, word);
  assert.match(shown.page, new RegExp(`The word was “${word}”\\.`), 'the Status box says what the word was');
  assert.ok(shown.page.includes('2 players got the word.'));
  // A guesser scores 100, up to 100 more for being quick, and up to 60 more for the letters still hidden.
  const quick = plus(shown.points[first.displayName]);
  const slow = plus(shown.points[other.displayName]);
  for (const points of [quick, slow]) assert.ok(points >= 100 && points <= 260, `a guesser scores from 100 to 260: ${points}`);
  assert.ok(quick >= slow, `the sooner you get it, the more you score: ${quick} then ${slow}`);
  // The drawer scores the average of the guessers, and 5% more for the one thumbs up.
  const drawn = plus(shown.points[drawer.displayName]);
  const due = ((quick + slow) / 2) * (1 + THUMB);
  assert.ok(Math.abs(drawn - due) <= 1, `the drawer scores the guessers' average and 5% more: ${drawn}, when ${due} was due`);

  expected[first.displayName] += quick;
  expected[other.displayName] += slow;
  expected[drawer.displayName] += drawn;
  for (const user of people) await scoresSettle(user);
  await host.waitForText(`The word was “${word}”.`); // Recent moves keeps it after the board has moved on
  for (const [user, points] of [[first, quick], [other, slow], [drawer, drawn]]) await host.waitForText(`${user.displayName} scores ${points}`);
}));

test('turn 2: nobody gets it, so letters are shown as the time runs down and nobody scores, whatever the thumbs say', { timeout: 240000 }, guarded('turn 2', async () => {
  const { drawer, guessers, word } = await startTurn(2);
  const [first, other] = guessers;
  const before = { ...expected };

  // One thumb each: pressing the other one changes your mind, and pressing the one you gave takes it back.
  await thumb(first, UP);
  await thumb(other, UP);
  await thumb(other, DOWN);
  await other.waitForSelector(`${UP}[aria-pressed="false"]`);
  await thumb(other, DOWN, { given: false });
  await thumb(other, UP);
  await say(first, 'xylophone'); // guessing costs nothing

  // "As the time runs down, letters of the word are shown": a letter of the word, in its own place.
  await until(first, 'a letter of the word to be shown', () => document.querySelectorAll('.word-bar .word .ch:not(.blank)').length > 0, { timeout: (DRAW_SECONDS + 30) * 1000 });
  const hinted = await letters(first);
  if (hinted.some((ch) => ch === null)) {
    // Still being drawn: only some of it is shown.  (On a machine so slow that the turn has already ended, all of it is.)
    hinted.forEach((ch, i) => ch === null || assert.equal(ch, word[i], `the letter shown in place ${i + 1} is the word's own`));
  }

  // The time runs out: the word is shown, and a drawing nobody got is worth nothing, praise and all.
  const shown = await reveal(other, word, (DRAW_SECONDS + 30) * 1000);
  assert.deepEqual(shown.points, {}, 'nobody scored');
  assert.deepEqual(shown.nobody, ['Nobody scored.']);
  assert.ok(shown.page.includes('Nobody got the word.'));
  for (const user of people) await user.waitForText(`The word was “${word}”.`); // Recent moves
  await drawer.waitForText('Nobody got the word.');
  for (const user of people) assert.deepEqual(await chips(user), before, 'the scores did not move');
}));

test('turn 3: everybody gets it, and a thumbs down is 5% less for the drawer', { timeout: 180000 }, guarded('turn 3', async () => {
  const { drawer, guessers, word } = await startTurn(3);
  const [first, other] = guessers;
  await thumb(other, DOWN);
  await say(first, word);
  await feedShows(other, `${first.displayName} has the word!`);
  await say(other, word);

  const shown = await reveal(first, word);
  assert.ok(shown.page.includes('2 players got the word.'));
  const quick = plus(shown.points[first.displayName]);
  const slow = plus(shown.points[other.displayName]);
  for (const points of [quick, slow]) assert.ok(points >= 100 && points <= 260, `a guesser scores from 100 to 260: ${points}`);
  const drawn = plus(shown.points[drawer.displayName]);
  const due = ((quick + slow) / 2) * (1 - THUMB);
  assert.ok(Math.abs(drawn - due) <= 1, `the drawer scores the guessers' average less 5%: ${drawn}, when ${due} was due`);
  expected[first.displayName] += quick;
  expected[other.displayName] += slow;
  expected[drawer.displayName] += drawn;
}));

test('the game ends when everybody has drawn: the final scores, the winner, and the words each of them drew', { timeout: 120000 }, guarded('finish', async () => {
  assert.equal(drew.size, people.length, 'everybody drew once');
  const most = Math.max(...Object.values(expected));
  const leaders = Object.keys(expected).filter((name) => expected[name] === most);
  for (const user of people) {
    await until(user, 'the Final scores pop-up', () => document.querySelector('.modal-backdrop [role="dialog"] h2')?.textContent?.trim() === 'Final scores');
    assert.deepEqual(await chips(user), expected, 'the final scores are the three turns added up');
    await user.waitForText('Game over');
    await user.waitForText('The scores are final.');
    // The one with the most points wins (and if two of them happen to be level, both do).
    const banner = await user.page.$eval('.modal-backdrop .winner', (el) => el.textContent.trim());
    if (leaders.length === 1) {
      assert.equal(banner, leaders[0] === user.displayName ? `${leaders[0]} (you) wins!` : `${leaders[0]} wins!`);
      await user.waitForText(`${leaders[0]} wins with ${most} points.`);
    } else {
      for (const name of leaders) assert.ok(banner.includes(name), `"${banner}" names ${name}`);
      await user.waitForText(`win with ${most} points.`);
    }
  }

  // The round is in the table once, with the word each of them drew.
  assert.deepEqual(await host.page.$$eval('.modal .score-table tbody th', (els) => els.map((el) => el.textContent.trim())), ['Round 1 of 1']);
  const notes = await host.page.$$eval('.modal .score-table tbody .note', (els) => els.map((el) => el.textContent.trim()));
  assert.deepEqual([...notes].sort(), [...drew.values()].map((word) => `drew “${word}”`).sort());
  await host.clickButton('Close', { exact: true, scope: '.modal-backdrop' });
  await host.waitForSelector('.modal-backdrop', { hidden: true });
}));

test('the words that were added are kept for later games, in the site\'s data folder', () => {
  const file = path.join(world.dataDir, 'modules', 'scribblers', 'added-words.json');
  assert.ok(fs.existsSync(file), `${file} was written`);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).words, WORDS);
});

test('nothing in the pages went wrong along the way', () => {
  assert.deepEqual(world.pageErrors, []);
});
