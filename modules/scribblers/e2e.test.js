// Whole games of Scribblers against the real site, over real sockets, with computer players filling the table, played
// from the invite code to the final scores - and every state every person was sent along the way looked at afterwards.
//
// server.test.js plays a game of people only, and watches a computer player draw without finishing the game.  What is
// protected here is the whole of a mixed game: that computer players choose, draw, and guess without holding anybody
// up; that through all of it no guesser is ever sent the word, a letter the clock has not shown, or the words on
// offer; that the scoreboard adds up and nobody's score goes down; and that the game is recorded once, for the people
// only, with what each of them actually did.
//
// The people here guess the word at once, which they can only do because the test reads it from the saved room: a
// computer player's drawing would otherwise run its full time, and the shortest drawing time there is is half a minute.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, savedRooms, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = 'scribblers';

// Nothing a person has to do is on a short clock, so a slow machine cannot have a word chosen for them or a round
// moved on without them; the computer players, and the pause between turns, are quick.
process.env.SCRIBBLERS_CHOOSE_WAIT = '120000';
process.env.SCRIBBLERS_BETWEEN_WAIT = '100';
process.env.SCRIBBLERS_SCORES_WAIT = '120000';
process.env.SCRIBBLERS_AWAY_WAIT = '120000';
process.env.SCRIBBLERS_BOT_DELAY = '20-60';
process.env.SCRIBBLERS_BOT_DRAW = '50';
process.env.SCRIBBLERS_BOT_RATE = '5000';
process.env.SCRIBBLERS_PICTURES = 'test';

const LONG = { timeout: 60000 };
const sum = (numbers) => numbers.reduce((a, b) => a + b, 0);
const me = (person) => person.state.players.find((p) => p.id === person.id);

/**
 * Plays the game these people are in to its end.  A person who is drawing chooses the first word; everybody else
 * guesses it; the scores are closed as they come up.  Returns what each turn was, for the test's own book.
 * @param {object} site  the running site (for the saved room, which is where a computer player's word is read from)
 * @param {object[]} people  the connected people at the table
 * @returns {Promise<{ drawer: number | string, word: string, gained: Map<number, number> }[]>}
 */
async function playToEnd(site, people) {
  const [host] = people;
  const dataDir = path.join(site.dataDir, 'site', 'modules', ID);
  // The turns in which each person has been sent some of a drawing, by round and turn.
  const drawn = new Map(people.map((p) => [p, new Set()]));
  for (const p of people) p.socket.on('draw', () => drawn.get(p).add(`${p.state?.round}:${p.state?.turn}`));
  const turns = [];
  const done = new Set();
  const key = (state) => `${state.round}:${state.turn}:${state.phase}`;
  const everybodyAt = (k) => people.every((p) => p.state && key(p.state) === k);

  for (let guard = 0; guard < 400 && host.state.phase !== 'finished'; guard++) {
    const now = key(host.state);
    if (done.has(now)) {
      await until(() => key(host.state) !== now, `the game to move on from ${now}`, LONG);
      continue;
    }
    done.add(now);
    await until(() => everybodyAt(now) || key(host.state) !== now, `everybody to see ${now}`, LONG);
    if (key(host.state) !== now) continue;
    const { phase, round, turn } = host.state;

    if (phase === 'choosing') {
      const drawer = people.find((p) => p.state.youDraw);
      if (drawer) {
        assert.ok(drawer.state.choices.length >= 2, 'the drawer is offered a few words');
        assert.equal((await drawer.call('word', { n: 0 })).ok, true);
      }
    } else if (phase === 'drawing') {
      const drawer = people.find((p) => p.state.youDraw);
      const before = new Map(people.map((p) => [p.id, me(p).score]));
      let word = drawer?.state.word;
      if (!drawer) {
        // A computer player is drawing: its picture reaches the table, and the word is read from the saved room.
        await until(() => people.every((p) => drawn.get(p).has(`${round}:${turn}`)), 'the computer player\'s picture to reach everybody', LONG);
        await until(() => {
          const saved = savedRooms(dataDir).find((room) => room.code === host.state.code);
          if (saved?.phase === 'drawing' && saved.round === round && saved.turn + 1 === turn) word = saved.word;
          return Boolean(word);
        }, 'the word to be in the saved room', LONG);
      }
      assert.equal(typeof word, 'string');
      for (const p of people) {
        if (p === drawer) continue;
        assert.equal(p.state.word, null, `${p.name} is guessing and has not been sent the word`);
        // Turns go by so quickly here that a person can be told they are typing too fast (five lines in three
        // seconds); such a guess was not taken at all, so it is simply made again a moment later.
        let reply;
        await until(async () => {
          reply = await p.call('guess', { text: word });
          return reply.error !== 'tooFast';
        }, `${p.name} to be allowed to guess`, { timeout: 30000, step: 250 });
        assert.equal(reply.ok, true, `${p.name} guesses: ${reply.error}`);
      }
      // A right guess shows in the guesser's own state, or the turn has already ended because it was the last one.
      await until(() => people.every((p) => p === drawer || p.state.youGuessed || key(p.state) !== now), 'the right guesses to count', LONG);
      // Everybody (every person, that is) has the word, so the turn ends without waiting for the clock.
      await until(() => people.every((p) => p.state.phase !== 'drawing' || p.state.turn !== turn || p.state.round !== round), 'the turn to end once everybody has the word', LONG);
      // What each person made of the turn is on the scoreboard by the time the word is shown, whatever came after.
      const shown = (p) => p.states.find((s) => s && s.round === round && s.turn === turn && s.phase === 'between') ?? p.state;
      turns.push({ drawer: shown(host).drawer, word, gained: new Map(people.map((p) => [p.id, shown(p).players.find((x) => x.id === p.id).score - before.get(p.id)])) });
    } else if (phase === 'scores') {
      for (const p of people) {
        const reply = await p.call('ready');
        assert.ok(reply.ok || reply.error === 'noScoresToClose', `${p.name} closes the scores (${reply.error})`);
      }
    }
  }
  await until(() => people.every((p) => p.state.phase === 'finished'), 'everybody to see the end', LONG);
  return turns;
}

/** Every state a person was ever sent: nothing they may not know, and a scoreboard that only ever makes sense. */
function assertStates(person) {
  const scores = new Map();
  let lines = 0;
  let turnsSeen = 0;
  for (const s of person.states) {
    if (!s) continue;
    const who = `${person.name} (round ${s.round}, turn ${s.turn}, ${s.phase})`;
    assert.ok(['lobby', 'choosing', 'drawing', 'between', 'scores', 'finished'].includes(s.phase), `${who}: a phase`);
    assert.equal(s.you, person.id);

    // The word, the letters still hidden, and the words on offer.
    const knows = s.youDraw || s.youGuessed;
    if (s.phase === 'choosing') assert.equal(s.word, null, `${who}: a word before one was chosen`);
    if (s.phase === 'drawing' && !knows) {
      assert.equal(s.word, null, `${who}: was sent the word while guessing`);
      assert.ok(s.hints.some((hint) => hint.ch === null), `${who}: was sent every letter while guessing`);
      for (const hint of s.hints) if (!hint.shown) assert.equal(hint.ch, null, `${who}: was sent a letter that has not been shown`);
      assert.ok(s.hints.filter((hint) => hint.shown && !hint.fixed).length <= 3, `${who}: more than three letters were given away`);
    }
    if (s.phase === 'drawing' && knows) assert.equal(typeof s.word, 'string', `${who}: knows the word and is shown it`);
    if (s.choices.length) assert.ok(s.phase === 'choosing' && s.youDraw, `${who}: was sent the words on offer`);
    for (const line of s.feed) {
      if (line.kind === 'correct') assert.equal(line.text, '', `${who}: a right guess shown as text`);
      if (line.kind === 'close') assert.equal(line.id, person.id, `${who}: told that somebody else was close`);
    }
    assert.equal(s.reveal !== null, s.phase === 'between', `${who}: the reveal is for between turns`);

    // The table and its scores.
    const ids = s.players.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${who}: a player twice`);
    assert.equal(s.players.filter((p) => p.drawing).length, ['choosing', 'drawing', 'between'].includes(s.phase) ? 1 : 0, `${who}: one drawer while a turn is on`);
    for (const p of s.players) {
      assert.ok(p.score >= (scores.get(p.id) ?? 0), `${who}: the score of ${p.name} went down`);
      scores.set(p.id, p.score);
      assert.equal(Boolean(p.ai), p.bot && s.phase !== 'lobby', `${who}: ${p.name} shows an AI if and only if it is a computer player in a game`);
      if (p.bot) assert.equal(p.online, true, `${who}: a computer player is never away`);
      const column = sum(s.scoreboard.rounds.map((round) => round.deltas[p.id] ?? 0));
      if (['scores', 'finished'].includes(s.phase)) assert.equal(column, p.score, `${who}: the scoreboard adds up for ${p.name}`);
      else assert.ok(column <= p.score, `${who}: the scoreboard gives ${p.name} more than their score`);
      if (s.phase !== 'finished') assert.ok(p.placement === null && !p.winner, `${who}: a winner before the end`);
    }
    assert.ok(s.scoreboard.rounds.length >= lines, `${who}: the scoreboard lost a round`);
    lines = s.scoreboard.rounds.length;
    if (s.phase !== 'lobby') {
      const turnNumber = (s.round - 1) * s.turns + s.turn;
      assert.ok(turnNumber >= turnsSeen, `${who}: the game went backwards`);
      turnsSeen = turnNumber;
    }
  }
  assert.ok(turnsSeen > 0, `${person.name} was sent a game`);
}

/** One game's statistics for a person, once the site has recorded it. */
async function recorded(person) {
  let mine;
  await until(async () => {
    const stats = await person.stats();
    mine = { stats, game: stats.perGame?.find((g) => g.game === ID || g.name === 'Scribblers') };
    return mine.game?.played === 1;
  }, `the game to be recorded for ${person.name}`, LONG);
  return { ...mine, extras: Object.fromEntries(mine.game.extras.map((e) => [e.key, e.value])) };
}

test('one person and three computer players: the computers choose, draw, and guess, and the game runs to its end', { timeout: 240000 }, async (t) => {
  const site = await launchModule(t, { id: ID, moduleDir: here });
  const ann = await site.person('ann').open();
  const created = await ann.call('create', { rounds: 1, drawTime: 30 });
  assert.equal(created.ok, true, created.error);
  assert.equal((await ann.call('start')).ok, false, 'one player is not a game');
  assert.equal((await ann.call('fillBots', { count: 4 })).ok, true);
  await until(() => ann.state?.players.length === 4, 'a table of four');
  assert.equal(ann.state.players.filter((p) => p.bot).length, 3);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state?.phase === 'choosing', 'the first turn');

  const turns = await playToEnd(site, [ann]);
  assertStates(ann);
  const final = ann.state;
  assert.equal(turns.length, 4, 'everybody draws once a round, the computer players included');
  assert.deepEqual(turns.map((turn) => String(turn.drawer)).sort(), final.players.map((p) => String(p.id)).sort(), 'each of the four drew');
  assert.equal(final.scoreboard.rounds.length, 1);

  // Ann found every word she was guessing at, and each of those scored what rules.md says a guess can.
  const guessing = turns.filter((turn) => turn.drawer !== ann.id);
  assert.equal(guessing.length, 3);
  for (const turn of guessing) assert.ok(turn.gained.get(ann.id) >= 100 && turn.gained.get(ann.id) <= 260, `a guess worth ${turn.gained.get(ann.id)}`);
  const best = Math.max(...final.players.map((p) => p.score));
  for (const p of final.players) assert.equal(p.winner, p.score === best, `${p.name}: the winners are the ones with the most`);

  // Recorded once, for the one person, with what she did.
  const { stats, game, extras } = await recorded(ann);
  const mine = me(ann);
  assert.equal(game.totalScore, mine.score);
  assert.equal(game.wins, mine.winner ? 1 : 0);
  assert.equal(stats.recent[0].players, 1, 'computer players are not recorded');
  assert.equal(extras.wordsDrawn, 1, 'she drew once');
  assert.equal(extras.wordsGuessed, 3, 'and guessed the other three');
  assert.equal(extras.guesses, 3, 'with one guess each');
  assert.equal(extras.wordsAdded, 0);
  assert.equal(extras.bestTurn, Math.max(...turns.map((turn) => turn.gained.get(ann.id))), 'her best single turn');
  assert.ok(extras.firstGuesses <= 3);

  // Looking again changes nothing: the game is recorded once.
  assert.deepEqual(await ann.call('resume', { code: created.code }), { ok: true, code: created.code });
  assert.equal(ann.state.phase, 'finished');
  assert.equal((await ann.stats()).perGame.find((g) => g.game === ID || g.name === 'Scribblers').played, 1);
});

test('two people among computer players: a word of their own is offered, both are recorded, and each is told only what they may know', { timeout: 240000 }, async (t) => {
  const site = await launchModule(t, { id: ID, moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((name) => site.person(name).open()));
  const created = await ann.call('create', { rounds: 2, drawTime: 30, wordChoices: 2 });
  assert.match(created.code, /^[a-z]+-[a-z]+-[a-z]+$/);
  assert.equal(created.ok, true, created.error);
  assert.equal((await bob.call('join', { code: created.code })).ok, true);
  assert.equal((await bob.call('addWord', { text: 'Space Hopper' })).ok, true, 'anybody at the table can add a word');
  assert.equal((await bob.call('fillBots', { count: 4 })).ok, false, 'but only the host adds computer players');
  assert.equal((await ann.call('fillBots', { count: 4 })).ok, true);
  await until(() => [ann, bob].every((p) => p.state?.players.length === 4), 'a table of four');
  assert.equal((await ann.call('start')).ok, true);
  const people = [ann, bob];
  await until(() => people.every((p) => p.state?.phase === 'choosing'), 'the first turn');

  const turns = await playToEnd(site, people);
  for (const p of people) assertStates(p);

  // "One of the words the drawer is offered each turn is one of them while any are left unplayed": so every time a
  // person was choosing before bob's word had been drawn, it was among the words they were offered.  (What a
  // computer player was offered is not sent to anybody.)
  for (const p of people) {
    for (const s of p.states.filter((state) => state?.phase === 'choosing' && state.youDraw)) {
      const earlier = turns.slice(0, (s.round - 1) * s.turns + s.turn - 1).map((turn) => turn.word);
      if (!earlier.includes('space hopper')) assert.ok(s.choices.includes('space hopper'), `${p.name} (round ${s.round}, turn ${s.turn}) was offered ${JSON.stringify(s.choices)}`);
    }
  }
  assert.equal(turns.length, 8, 'two rounds of four players drawing once each');
  assert.equal(new Set(turns.map((turn) => turn.word)).size, 8, 'a different word every turn');
  for (const p of ann.state.players) assert.equal(turns.filter((turn) => turn.drawer === p.id).length, 2, `${p.name} drew once a round`);
  assert.equal(ann.state.scoreboard.rounds.length, 2, 'a scoreboard line a round');
  assert.deepEqual(ann.state.scoreboard.rounds, bob.state.scoreboard.rounds, 'both see the same scoreboard');
  assert.deepEqual(ann.state.players.map((p) => [p.id, p.score, p.winner]), bob.state.players.map((p) => [p.id, p.score, p.winner]), 'and the same result');

  for (const p of people) {
    const { stats, game, extras } = await recorded(p);
    const mine = me(p);
    assert.equal(game.totalScore, mine.score, `${p.name}: the score recorded is the score shown`);
    assert.equal(game.wins, mine.winner ? 1 : 0);
    assert.equal(stats.recent[0].players, 2, 'two people were recorded, and no computer player');
    assert.equal(extras.wordsDrawn, 2, `${p.name} drew once a round`);
    assert.equal(extras.wordsGuessed, 6, `${p.name} guessed the other six`);
    assert.equal(extras.guesses, 6);
    assert.equal(extras.wordsAdded, p === bob ? 1 : 0, 'the word bob added is counted for him');
    assert.equal(extras.bestTurn, Math.max(...turns.map((turn) => turn.gained.get(p.id))), `${p.name}: best single turn`);
  }
});
