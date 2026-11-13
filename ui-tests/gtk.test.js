// GTK (Getting To Know): three people in three browsers play a whole game, one round of three turns with two questions
// a turn, and then one person plays a whole game against two computer players.
//
// What is protected here is the journey modules/gtk/rules.md describes, as it reads on a real screen: the subject is
// asked about "your" and everybody else about them by name; the answers go up with no names on them and your own
// cannot be picked; a made-up answer that comes to the same thing as the true one is shown as one answer and its
// writer does not pick; and the points are the ones the rules give (2 for spotting the truth, 1 for everybody you
// fool, 1 for writing the truth by accident, and nothing for the subject).  Everything the three people write and pick
// is decided here, so every score on the way is worked out from the rules and not read back off the screen.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive } from './helpers.js';

// rules.md, Scoring.
const SPOTTED = 2;
const FOOLED = 1;
const WROTE_THE_TRUTH = 1;
const QUESTIONS = 2; // "how many questions each turn asks (1 to 4, normally 2)"
const LONGEST = 180; // "how long everybody gets to answer and to pick (15 to 180 seconds, normally 60)"

// What is written and picked in each of the three turns.  `a` is the player after the subject in the order people
// joined and `b` the one after that; `picks` says what each of them picks for each question ('truth', or whose made-up
// answer), with null for somebody who has nothing to pick.
const TURNS = [
  // Question 1: a spots the truth and b falls for a's.  Question 2: b spots the truth and a falls for b's.
  { truth: ['Heron', 'Tuesday'], a: ['Marmalade', 'Granite'], b: ['Velvet', 'Compass'], picks: [{ a: 'truth', b: 'a' }, { a: 'b', b: 'truth' }] },
  // Question 1: b's made-up answer is the subject's own but for the capitals, the punctuation, and the plural "s", so it
  // is one answer and b does not pick.  Question 2: each falls for the other's, and nobody spots the truth.
  { truth: ['Red Pandas', 'Lantern'], a: ['Thimble', 'Saffron'], b: ['red panda!', 'Pebble'], picks: [{ a: 'truth', b: null }, { a: 'b', b: 'a' }] },
  // Question 1: both spot the truth.  Question 2: a spots it and b falls for a's.
  { truth: ['Walnut', 'Harbour'], a: ['Cobweb', 'Ribbon'], b: ['Anchor', 'Juniper'], picks: [{ a: 'truth', b: 'truth' }, { a: 'truth', b: 'a' }] },
];
const MATCHED = { turn: 1, question: 0 }; // where b writes the truth by accident

let world;
let host;
let second;
let third;
let solo;
let people; // in the order they joined
before(async () => {
  // The reveal waits for everybody to close the scores; the server is told to wait far longer than the test runs, so
  // that it never moves on by itself while a loaded machine is still reading the screen.
  world = await createWorld({ suite: 'gtk', env: { GTK_BOT_DELAY: '0-5', GTK_NEXT_WAIT: '900000' } });
  host = await world.newUser('host');
  second = await world.newUser('second');
  third = await world.newUser('third');
  solo = await world.newUser('solo');
  // Names that are in none of the questions, so that a question with a name in it can only be about that player.
  await host.signUp('gtk', { displayName: 'Zadie' });
  await second.signUp('gtk', { displayName: 'Quillon' });
  await third.signUp('gtk', { displayName: 'Brannoch' });
  await solo.signUp('gtk', { displayName: 'Solveig' });
  people = [host, second, third];
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const expected = {}; // display name -> the score the rules give them so far
const asked = []; // every question put to a subject, to see that none comes twice
const subjects = []; // who each turn was about, in order
let whoHadToPick = null; // the "Who has picked" names on the question where b had written the truth

/** Waits for something in the page to be so, with the wait a loaded machine needs. */
const until = (user, what, check, ...args) =>
  user.page.waitForFunction(check, { timeout: 30000, polling: 50 }, ...args).catch(async (error) => {
    throw new Error(`${user.label}: timed out waiting for ${what}.  The page says:\n${(await user.text()).slice(0, 1200)}\n(${error.message})`);
  });
/** Everybody's score as the score bar shows it: { name: score }. */
const chips = (user) =>
  user.page.$$eval('.score-bar .chip', (els) =>
    Object.fromEntries(els.map((el) => [el.querySelector('.name').textContent.replace(/\s*\(you\)\s*$/, '').trim(), Number(el.querySelector('.points').textContent)])),
  );
/** The questions as this player reads them while writing. */
const prompts = (user) => user.page.$$eval('.write-form .question', (els) => els.map((el) => el.textContent.trim()));
/** The answers on the table while picking: what each says, whether it can be pressed, and whether it is marked as yours. */
const cards = (user) =>
  user.page.$$eval('.answers-box .cards > li', (els) =>
    els.map((li) => {
      const button = li.querySelector('button.card.pick');
      if (button) return { text: button.textContent.trim(), pickable: true, yours: false };
      const card = li.querySelector('.card');
      return { text: card.querySelector('.answer-text').textContent.trim(), pickable: false, yours: card.classList.contains('yours') && Boolean(card.querySelector('.tag')) };
    }),
  );
/** The reveal in the scores pop-up: each answer with the line saying who wrote it and the line saying who chose it. */
const entries = (user) =>
  user.page.$$eval('.modal-backdrop .reveal .entry', (els) =>
    els.map((el) => {
      const [text, wrote, chose] = [...el.querySelectorAll('span')].map((span) => span.textContent.trim());
      return { text, wrote, chose };
    }),
  );
/** Types one answer into each box and sends them. */
async function write(user, answers) {
  for (const [n, answer] of answers.entries()) await user.fill(`.write-form label:nth-of-type(${n + 1}) input`, answer);
  await user.clickButton(QUESTIONS === 1 ? 'Send your answer' : 'Send all your answers', { exact: true });
}
/** Presses the answer card that says exactly this. */
async function pick(user, text) {
  const handle = await until(user, `the answer "${text}" to press`, (wanted) => [...document.querySelectorAll('button.card.pick')].find((b) => b.textContent.trim() === wanted) ?? null, text);
  await handle.asElement().click();
  await handle.dispose();
}
/** Closes the scores pop-up with its own button, which is how a person says they are ready to go on. */
const closeScores = (user) => user.clickButton('Continue', { exact: true, scope: '.modal-backdrop' });
/** The line saying who chose an answer must name exactly these people. */
function assertChose(line, names, about) {
  if (!names.length) return assert.equal(line, 'Nobody chose this', about);
  if (names.length === 1) return assert.equal(line, `Chose ${names[0]}`, about);
  assert.match(line, /^Chose /, about);
  for (const name of names) assert.ok(line.includes(name), `${about}: "${line}" names ${name}`);
}

test('three people join, only the host may change the settings, and the lobby says how long the game will be', { timeout: 120000 }, guarded('lobby', async () => {
  await host.goto('/play/gtk');
  await host.clickButton('Start a new game');
  await host.waitForText('Waiting for players');
  // The settings start where the rules say they normally are.
  await host.waitForText('1 round');
  await host.waitForText('2 questions a turn');
  await host.waitForText('60 seconds');
  // Three are needed for anybody to have somebody to fool.
  await host.waitForText('You need at least 3 players.');
  assert.equal((await host.buttonState('Start the game')).disabled, true, 'one player cannot start');

  const code = await host.inviteCode();
  for (const user of [second, third]) {
    await user.goto(`/play/gtk?${code}`);
    await user.waitForText('Waiting for the host to start.');
  }
  await host.waitForText('Players (3 of 8)');
  await host.waitForText('3 turns in all with 3 players, and 2 questions a turn.');
  assert.equal(await second.page.$eval('button[aria-label="More rounds"]', (el) => el.disabled), true, 'somebody who is not the host cannot change the length');

  // The host gives everybody the longest time there is, in steps, and can go no further.
  for (let seconds = 75; seconds <= LONGEST; seconds += 15) {
    await host.clickButton('More time', { exact: true });
    await host.waitForText(`${seconds} seconds`);
  }
  await until(host, 'More time to be switched off at the longest time', () => document.querySelector('button[aria-label="More time"]')?.disabled === true);
  await third.waitForText(`${LONGEST} seconds`);
  assert.equal((await host.buttonState('Start the game')).disabled, false);
  await host.clickButton('Start the game', { exact: true });
  for (const user of people) await user.waitForSelector('.game-frame');
  for (const user of people) expected[user.displayName] = 0;
}));

for (const [k, turn] of TURNS.entries()) {
  test(`turn ${k + 1}: everybody writes, each question is picked and revealed, and the points are the ones the rules give`, { timeout: 240000 }, guarded(`turn ${k + 1}`, async () => {
    for (const user of people) {
      await user.waitForSelector('.write-form');
      await user.waitForText(`Turn ${k + 1} of ${TURNS.length}`);
    }

    // One of them is told the questions are about them; the turns then go round in the order people joined.
    const about = [];
    for (const user of people) if ((await user.text()).includes('The questions are all about you.')) about.push(user);
    assert.equal(about.length, 1, 'the turn is about exactly one player');
    const [subject] = about;
    if (subjects.length) assert.equal(subject, people[(people.indexOf(subjects.at(-1)) + 1) % people.length], 'the next player in the order they joined is the subject');
    subjects.push(subject);
    const a = people[(people.indexOf(subject) + 1) % people.length];
    const b = people[(people.indexOf(subject) + 2) % people.length];
    const name = subject.displayName;

    await subject.waitForText('The questions are all about you. Answer them honestly: the others are making answers up for the same ones.');
    for (const user of [a, b]) {
      await user.waitForText(`Make up an answer to each question that could pass for ${name}’s own.`);
      await user.waitForText(`This turn is about ${name}`);
      await user.waitForText(`The true answer is worth ${SPOTTED}; a made-up answer earns ${FOOLED} for every player who picks it.`);
    }

    // The subject reads "your", everybody else reads the subject's name, and no question is asked twice in a game.
    const own = await prompts(subject);
    assert.equal(own.length, QUESTIONS, 'the subject is asked every question of the turn at once');
    for (const line of own) {
      assert.ok(!line.includes(name), `the subject's own question does not name them: "${line}"`);
      assert.ok(!asked.includes(line), `"${line}" has not been asked before in this game`);
      asked.push(line);
    }
    for (const user of [a, b]) {
      const theirs = await prompts(user);
      assert.equal(theirs.length, QUESTIONS);
      for (const line of theirs) assert.ok(line.includes(name), `the others are asked about ${name} by name: "${line}"`);
    }

    // Nothing can be sent until every box has something in it.
    assert.deepEqual(await subject.buttonState('Send all your answers'), { present: true, disabled: true }, 'empty boxes cannot be sent');
    await write(subject, turn.truth);
    await subject.waitForText(`Answers sent. Waiting for the others (1 of ${people.length}).`);
    assert.deepEqual(await subject.page.$$eval('.mine-list strong', (els) => els.map((el) => el.textContent.trim())), turn.truth, 'your own answers come back to you');
    // The others are told that the subject has written, and not what.
    await until(a, `${name} to be ticked as having written`, (who) => [...document.querySelectorAll('.who li.done')].some((li) => li.textContent.includes(who)), name);
    for (const answer of turn.truth) assert.ok(!(await a.text()).includes(answer), `nobody sees "${answer}" while the answers are being written`);
    await write(a, turn.a);
    await write(b, turn.b);

    for (let q = 0; q < QUESTIONS; q++) {
      const matched = k === MATCHED.turn && q === MATCHED.question;
      const picks = turn.picks[q];
      const textOf = { truth: turn.truth[q], a: turn.a[q], b: turn.b[q] };
      const onTable = matched ? [textOf.truth, textOf.a] : [textOf.truth, textOf.a, textOf.b];

      // The answers to this question go up together, with no names on them.
      for (const user of people) {
        await user.waitForSelector('.answers-box .cards');
        await user.waitForText(`Question ${q + 1} of ${QUESTIONS}`);
      }
      await subject.waitForText('The others are picking which answer is really yours.');
      await subject.waitForText('Waiting for the others to pick.');
      const shown = { subject: await cards(subject), a: await cards(a), b: await cards(b) };
      for (const [who, list] of Object.entries(shown)) assert.deepEqual(list.map((card) => card.text).sort(), [...onTable].sort(), `${who} sees the answers to question ${q + 1}`);
      for (const user of people) assert.ok(!(await user.page.$eval('.answers-box', (el) => el.innerText)).includes('Written by'), 'nobody is told who wrote what before the reveal');
      // The subject does not pick; everybody else may pick anything but their own.
      assert.deepEqual(shown.subject.filter((card) => card.pickable), [], 'the subject has nothing to press');
      assert.deepEqual(shown.a.filter((card) => card.pickable).map((card) => card.text).sort(), onTable.filter((text) => text !== textOf.a).sort(), 'a may pick any answer but their own');
      assert.deepEqual(shown.a.filter((card) => card.yours).map((card) => card.text), [textOf.a], 'and their own is marked as theirs');
      await a.waitForText(`Which of these is ${name}’s own answer? You cannot pick your own.`);
      if (matched) {
        // "the two are shown as one answer, you score for having guessed right, and you do not pick that question"
        assert.deepEqual(shown.b.filter((card) => card.pickable), [], 'somebody who wrote the truth has nothing to press');
        await b.waitForText('You wrote the true answer, so this one is already yours. Watch the others guess.');
        whoHadToPick = await a.page.$$eval('.answers-box ul.who li', (els) => els.map((el) => el.textContent.replace('✓', '').trim()));
      } else {
        assert.deepEqual(shown.b.filter((card) => card.pickable).map((card) => card.text).sort(), onTable.filter((text) => text !== textOf.b).sort(), 'b may pick any answer but their own');
        await b.waitForText(`Which of these is ${name}’s own answer? You cannot pick your own.`);
      }

      await pick(a, textOf[picks.a]);
      if (picks.b) {
        await a.waitForText('Picked. Waiting for the others (1 of 2).');
        await pick(b, textOf[picks.b]);
      }

      // The points, from rules.md: 2 for spotting the truth, 1 for each player who picks your made-up answer, 1 for
      // having written the truth by accident, and nothing for the subject.
      const fellFor = { a: [], b: [] }; // who picked a's made-up answer, and b's
      const spotted = [];
      for (const [who, user] of [['a', a], ['b', b]]) {
        if (picks[who] === 'truth') {
          spotted.push(user.displayName);
          expected[user.displayName] += SPOTTED;
        } else if (picks[who]) {
          fellFor[picks[who]].push(user.displayName);
          expected[(picks[who] === 'a' ? a : b).displayName] += FOOLED;
        }
      }
      if (matched) expected[b.displayName] += WROTE_THE_TRUTH;

      // The reveal: the true answer, who wrote each of the others, who fell for them, and the points.
      const title = `Scores after Turn ${k + 1}: ${name}, question ${q + 1}`;
      for (const user of people) {
        await until(user, `the pop-up "${title}"`, (wanted) => document.querySelector('.modal-backdrop [role="dialog"] h2')?.textContent?.trim() === wanted, title);
        await user.waitForText(`${name}’s answer was “${textOf.truth}”.`);
        await user.waitForText('Close the scores when you are ready to carry on.');
        assert.equal(await user.page.$eval('.modal-backdrop .reveal-truth', (el) => el.textContent.trim()), `The true answer was ${textOf.truth}`);
        const revealed = await entries(user);
        assert.deepEqual(revealed.map((entry) => entry.text).sort(), [...onTable].sort(), 'every answer is in the reveal once');
        const entry = Object.fromEntries(revealed.map((item) => [item.text, item]));
        assert.equal(entry[textOf.truth].wrote, `${name}’s own answer`);
        assertChose(entry[textOf.truth].chose, spotted, 'who chose the true answer');
        assert.equal(entry[textOf.a].wrote, `Written by ${a.displayName}`);
        assertChose(entry[textOf.a].chose, fellFor.a, `who chose ${a.displayName}'s answer`);
        if (!matched) {
          assert.equal(entry[textOf.b].wrote, `Written by ${b.displayName}`);
          assertChose(entry[textOf.b].chose, fellFor.b, `who chose ${b.displayName}'s answer`);
        }
        assert.deepEqual(await chips(user), expected, `the scores after turn ${k + 1}, question ${q + 1}`);
      }
      // Recent moves says the same in words.
      await host.waitForText(`The true answer was “${textOf.truth}”.`);
      await host.waitForText(spotted.length === 0 ? 'Nobody spotted the true answer.' : spotted.length === 1 ? '1 player spotted the true answer.' : `${spotted.length} players spotted the true answer.`);
      for (const who of ['a', 'b']) {
        const writer = who === 'a' ? a : b;
        if (fellFor[who].length) await host.waitForText(`${writer.displayName} fooled ${fellFor[who].length} player${fellFor[who].length === 1 ? '' : 's'} with “${textOf[who]}”.`);
      }

      // The game goes on when everybody has closed the scores, and says whom it is waiting for until then.
      const last = k === TURNS.length - 1 && q === QUESTIONS - 1;
      const next = last ? 'the final scores' : 'the next question';
      await closeScores(subject);
      await subject.waitForSelector('.modal-backdrop', { hidden: true });
      await subject.waitForText(new RegExp(`Waiting for (${a.displayName}.*${b.displayName}|${b.displayName}.*${a.displayName}) to be ready for ${next}\\.`));
      await closeScores(a);
      await subject.waitForText(`Waiting for ${b.displayName} to be ready for ${next}.`);
      await closeScores(b);
    }
  }));
}

test('a made-up answer that is the true one leaves its writer out of those who have to pick', { todo: 'modules/gtk/client/Table.vue lists everybody but the subject under "Who has picked", though its own comment (and the rules) leave out whoever wrote the true answer' }, () => {
  assert.ok(whoHadToPick, 'the question where somebody wrote the truth was played');
  const a = people[(people.indexOf(subjects[MATCHED.turn]) + 1) % people.length];
  assert.deepEqual(whoHadToPick, [a.displayName], 'only the one player with something to pick is being waited for');
});

test('the game ends after the last turn: the first subject wins, and every question is in All rounds', { timeout: 120000 }, guarded('finish', async () => {
  // Everybody was the subject once, in the order they joined; worked through, the picks above leave the first subject
  // with 7 points, the second with 5, and the third with 6.
  assert.equal(new Set(subjects).size, people.length, 'everybody was the subject once');
  const [first, next, lastOne] = subjects.map((user) => user.displayName);
  assert.deepEqual(expected, { [first]: 7, [next]: 5, [lastOne]: 6 });

  for (const user of people) {
    await until(user, 'the Final scores pop-up', () => document.querySelector('.modal-backdrop [role="dialog"] h2')?.textContent?.trim() === 'Final scores');
    // "The player with the most points at the end wins."
    assert.equal(await user.page.$eval('.modal-backdrop .winner', (el) => el.textContent.trim()), user.displayName === first ? `${first} (you) wins!` : `${first} wins!`);
    await user.waitForText(`${first} wins with 7 points.`);
    await user.waitForText('Game over');
    await user.waitForText('Use Leave game (top right) to go back to the menu, or "All rounds" in the score bar to see every question again.');
    assert.deepEqual(await chips(user), expected, 'the final scores');
    await user.clickButton('Close', { exact: true, scope: '.modal-backdrop' });
    await user.waitForSelector('.modal-backdrop', { hidden: true });
  }
  await host.waitForText(`${first} wins.`); // Recent moves

  await host.clickButton('All rounds', { exact: true });
  await host.waitForSelector('.modal');
  const rows = await host.page.$$eval('.modal .score-table tbody th', (els) => els.map((el) => el.textContent.trim()));
  assert.deepEqual(rows, subjects.flatMap((user, k) => Array.from({ length: QUESTIONS }, (_, q) => `Turn ${k + 1}: ${user.displayName}, question ${q + 1}`)));
  await host.closeModalWithEsc();
}));

test('one person plays a whole game against two computer players, and scores nothing in their own turn', { timeout: 240000 }, guarded('computer players', async () => {
  await solo.goto('/play/gtk');
  await solo.clickButton('Start a new game');
  await solo.waitForText('Waiting for players');
  await solo.clickButton('Add a computer player');
  await solo.clickButton('Add a computer player');
  await solo.waitForText('Players (3 of 8)');
  await solo.waitForText('3 turns in all with 3 players, and 2 questions a turn.');
  await solo.clickButton('Start the game', { exact: true });
  await solo.waitForSelector('.game-frame');

  const me = solo.displayName;
  const titles = new Set();
  const about = new Set(); // who the turns were about
  const mineInMyTurn = new Set(); // my score, every time it was looked at during the turn about me
  const step = async () => {
    // One look at the page, so that the turn and the score are read off the same state.
    const seen = await solo.page.evaluate(() => ({
      title: document.querySelector('.modal-backdrop [role="dialog"] h2')?.textContent?.trim() ?? '',
      about: /This turn is about ([^\n]+)/.exec(document.body.innerText)?.[1]?.trim() ?? null,
      mine: Number(document.querySelector('.score-bar .chip.me .points')?.textContent ?? NaN),
      writing: Boolean(document.querySelector('.write-form')),
    }));
    if (seen.about) about.add(seen.about);
    if (seen.about === me && Number.isFinite(seen.mine)) mineInMyTurn.add(seen.mine);
    if (seen.title) {
      titles.add(seen.title);
      await solo.page.keyboard.press('Escape');
      return true;
    }
    if (seen.writing) {
      // Filled in one go, in the page.  The look above can be of a form that has just been sent and is about to go
      // (the server has not answered yet); typing into it box by box then waited out a whole timeout for a box that
      // was never coming back, which failed this test about one run in three.  A form that has gone is simply no move.
      const filled = await solo.page.evaluate(() => {
        const inputs = [...document.querySelectorAll('.write-form input')];
        for (const [n, input] of inputs.entries()) {
          input.value = `Zebra crossing ${n + 1}`;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return inputs.length > 0;
      });
      if (!filled) return false;
      return solo.clickFound(() => [...document.querySelectorAll('.write-form button')].find((button) => !button.disabled) ?? null);
    }
    return solo.clickFound(() => document.querySelector('button.card.pick'));
  };
  await drive({ act: step, finished: async () => titles.has('Final scores'), timeout: 200000, what: 'GTK against computer players' });

  assert.ok([...titles].some((title) => /^Scores after Turn 1: .+, question 1$/.test(title)), `the scores came up after the first question: ${[...titles].join(' | ')}`);
  assert.equal(about.size, 3, `everybody was the subject of a turn: ${[...about].join(', ')}`);
  assert.ok(about.has(me), 'one of the turns was about the person');
  // "The subject scores nothing in their own turn"
  assert.equal(mineInMyTurn.size, 1, `the score did not move during the turn about ${me}: ${[...mineInMyTurn].join(', ')}`);

  // "The player with the most points at the end wins.  Tied leaders all win."
  const final = await chips(solo);
  const most = Math.max(...Object.values(final));
  const leaders = Object.keys(final).filter((name) => final[name] === most);
  await solo.waitForText('Game over');
  if (leaders.length === 1) await solo.waitForText(`${leaders[0]} wins with ${most} points.`);
  else {
    await solo.waitForText(`win with ${most} points.`);
    const headline = (await solo.text()).split('\n').find((line) => line.includes(`win with ${most} points.`));
    for (const name of leaders) assert.ok(headline.includes(name), `"${headline}" names ${name}`);
  }
}));

test('nothing in the pages went wrong along the way', () => {
  assert.deepEqual(world.pageErrors, []);
});
