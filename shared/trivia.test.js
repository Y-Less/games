// shared/trivia.js is the cache of questions from The Trivia API that any game can draw on.  No test here touches the
// network: every store is given a fake fetch that counts the requests it was asked to make.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_SIZE, createTriviaStore, prepare } from './trivia.js';
import { seeded } from './random.js';

// One question in the shape the API sends, numbered so every question is a different one.
const apiQuestion = (n) => ({
  category: 'history',
  id: `id-${n}`,
  correctAnswer: `right-${n}`,
  incorrectAnswers: [`wrong-${n}a`, `wrong-${n}b`, `wrong-${n}c`],
  question: { text: `question ${n}?` },
  tags: ['history'],
  type: 'text_choice',
  difficulty: 'medium',
  regions: [],
});

/**
 * A fake fetch that answers with fresh questions every time.
 * @param {object} [options] `repeat` makes it answer with the same questions over and over, `fail` with an error, and
 *   `status` with that HTTP status
 * @returns {Function} the fake, carrying `calls` (every URL it was given)
 */
function fakeFetch({ repeat = false, fail = false, status = 200 } = {}) {
  let next = 0;
  const fetchImpl = async (url) => {
    fetchImpl.calls.push(String(url));
    if (fail) throw new Error('offline');
    const limit = Number(new URL(String(url)).searchParams.get('limit'));
    const body = Array.from({ length: limit }, () => apiQuestion(repeat ? 1 : next++));
    return { ok: status === 200, status, json: async () => body };
  };
  fetchImpl.calls = [];
  return fetchImpl;
}

// A store with a fake fetch and a seeded shuffle, so a failing run can be repeated.
const testStore = (options = {}, fetchOptions) => {
  const fetchImpl = options.fetchImpl ?? fakeFetch(fetchOptions);
  return { store: createTriviaStore({ rng: seeded(7), ...options, fetchImpl }), fetchImpl };
};

test('prepare puts every answer in one list and says which is right', () => {
  const question = prepare(apiQuestion(1), seeded(1));
  assert.equal(question.question, 'question 1?');
  assert.equal(question.answers.length, 4);
  assert.deepEqual([...question.answers].sort(), ['right-1', 'wrong-1a', 'wrong-1b', 'wrong-1c']);
  assert.equal(question.answers[question.correct], 'right-1');
  assert.equal(question.category, 'history');
  assert.equal(question.difficulty, 'medium');
});

test('prepare really shuffles: the right answer does not sit in one place', () => {
  const places = new Set();
  for (let seed = 1; seed <= 40; seed++) places.add(prepare(apiQuestion(seed), seeded(seed)).correct);
  assert.deepEqual([...places].sort(), [0, 1, 2, 3], 'the correct answer should turn up in all four positions');
});

test('prepare refuses anything that is not a usable multiple-choice question', () => {
  for (const raw of [null, undefined, {}, { question: { text: 'q?' } }, { correctAnswer: 'a' },
    { question: { text: 'q?' }, correctAnswer: 'a', incorrectAnswers: [] },
    { question: {}, correctAnswer: 'a', incorrectAnswers: ['b'] }]) {
    assert.equal(prepare(raw, seeded(1)), null, JSON.stringify(raw));
  }
});

test('prepare copes with a question that has fewer than three wrong answers', () => {
  const question = prepare({ ...apiQuestion(2), incorrectAnswers: ['only-wrong'] }, seeded(2));
  assert.equal(question.answers.length, 2);
  assert.equal(question.answers[question.correct], 'right-2');
});

test('a new store holds nothing and has asked for nothing', () => {
  const { store, fetchImpl } = testStore();
  assert.equal(store.ready, 0);
  assert.equal(fetchImpl.calls.length, 0, 'making a store must not touch the network');
});

test('prime fills the cache with sixteen questions in one request', async () => {
  const { store, fetchImpl } = testStore();
  await store.prime();
  assert.equal(store.ready, CACHE_SIZE);
  assert.equal(CACHE_SIZE, 16);
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0], /limit=16/);
});

test('take hands out one question by default and refills behind it', async () => {
  const { store } = testStore();
  const taken = await store.take();
  assert.equal(taken.length, 1);
  assert.equal(taken[0].answers[taken[0].correct], 'right-0');
  await store.prime(); // waits for the refill the take started
  assert.equal(store.ready, CACHE_SIZE, 'the cache should be full again for the next request');
});

test('take hands out as many as were asked for', async () => {
  const { store } = testStore();
  const taken = await store.take(5);
  assert.equal(taken.length, 5);
  for (const question of taken) assert.equal(question.answers.length, 4);
});

test('take never hands out the same question twice', async () => {
  const { store } = testStore();
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    for (const question of await store.take(5)) {
      assert.ok(!seen.has(question.id), `${question.id} was handed out twice`);
      seen.add(question.id);
    }
  }
  assert.equal(seen.size, 30);
});

test('take may ask for more questions than the cache holds', async () => {
  const { store } = testStore();
  const taken = await store.take(25);
  assert.equal(taken.length, 25);
  assert.equal(new Set(taken.map((q) => q.id)).size, 25);
});

test('take refuses a count that is not a positive whole number', async () => {
  const { store, fetchImpl } = testStore();
  for (const count of [0, -1, 1.5, '3', null, NaN]) {
    await assert.rejects(() => store.take(count), TypeError, String(count));
  }
  assert.equal(fetchImpl.calls.length, 0, 'a bad count should not reach the network');
});

test('the questions come from the cache, so a second take needs no new request', async () => {
  const { store, fetchImpl } = testStore();
  await store.prime();
  assert.equal(fetchImpl.calls.length, 1);
  await store.take(3);
  const after = fetchImpl.calls.length; // the refill the take started
  await store.take(3);
  assert.equal(fetchImpl.calls.length, after, 'the cache covered the second take on its own');
});

test('overlapping takes share one fill rather than racing', async () => {
  // The fake holds its answer back until the test lets go, so both takes are still waiting when the requests are counted.
  let letGo;
  const held = new Promise((resolve) => { letGo = resolve; });
  const answer = fakeFetch();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    await held;
    return answer(url);
  };
  const { store } = testStore({ fetchImpl });

  const both = Promise.all([store.take(2), store.take(2)]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1, 'the second take should wait on the request the first one started');

  letGo();
  const [first, second] = await both;
  const ids = [...first, ...second].map((q) => q.id);
  assert.equal(new Set(ids).size, 4, 'and the two takes still get different questions');
});

test('the request carries the UK region by default, and whatever filters the store was given', async () => {
  const { store, fetchImpl } = testStore();
  await store.prime();
  assert.match(fetchImpl.calls[0], /region=GB/);

  const picky = testStore({ region: 'US', categories: 'history,music', difficulties: 'easy', tags: 'geology', size: 4 });
  await picky.store.prime();
  const url = new URL(picky.fetchImpl.calls[0]);
  assert.equal(url.origin + url.pathname, 'https://the-trivia-api.com/v2/questions');
  assert.equal(url.searchParams.get('region'), 'US');
  assert.equal(url.searchParams.get('categories'), 'history,music');
  assert.equal(url.searchParams.get('difficulties'), 'easy');
  assert.equal(url.searchParams.get('tags'), 'geology');
  assert.equal(url.searchParams.get('limit'), '4');
});

test('a store can be told to keep a different number of questions ready', async () => {
  const { store } = testStore({ size: 3 });
  await store.prime();
  assert.equal(store.ready, 3);
});

test('a dead API gives an error with a code rather than a sentence', async () => {
  const { store } = testStore({}, { fail: true });
  await assert.rejects(() => store.take(), (error) => {
    assert.equal(error.code, 'triviaUnavailable');
    assert.equal(error.cause.message, 'offline');
    return true;
  });
});

test('an unhappy API answer gives the same error', async () => {
  for (const status of [429, 500]) {
    const { store } = testStore({}, { status });
    await assert.rejects(() => store.take(), (error) => {
      assert.equal(error.code, 'triviaUnavailable');
      assert.match(error.message, new RegExp(String(status)));
      return true;
    });
  }
});

test('an answer that is not a list of questions gives the same error', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ error: 'nope' }) });
  const { store } = testStore({ fetchImpl });
  await assert.rejects(() => store.take(), (error) => error.code === 'triviaUnavailable');
});

test('questions already handed out come round again once the API has no new ones', async () => {
  // This fake only ever answers with question 1, so the store runs out of unseen questions at once.
  const { store } = testStore({ size: 2 }, { repeat: true });
  const first = await store.take();
  assert.equal(first[0].id, 'id-1');
  const second = await store.take();
  assert.equal(second[0].id, 'id-1', 'rather than failing, the store starts the questions again');
});

test('a take that cannot be filled says so instead of handing out fewer', async () => {
  // Three questions exist, five are asked for.
  let left = 3;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => Array.from({ length: Math.max(left--, 0) }, (_, i) => apiQuestion(`only-${i}`)),
  });
  const { store } = testStore({ fetchImpl, size: 5 });
  await assert.rejects(() => store.take(5), (error) => {
    assert.equal(error.code, 'triviaUnavailable');
    assert.match(error.message, /of 5 questions/);
    return true;
  });
});
