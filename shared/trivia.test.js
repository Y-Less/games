// shared/trivia.js is the cache of questions any game can draw on, from The Trivia API and from the site's own
// question bank.  No test here touches the network or a database: every store is given a fake fetch that counts the
// requests it was asked to make, and a fake bank that counts what was drawn from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_SIZE, CATEGORIES, COUNT_GOOD_FOR, canonicalCategories, canonicalCategory, createTriviaStore, prepare } from './trivia.js';
import { seeded } from './random.js';

// One question in the shape the API sends, numbered so every question is a different one.
const apiQuestion = (n, category = 'history') => ({
  category,
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
 * A fake fetch that answers with fresh questions every time, and says how many questions the API has when asked.
 * @param {object} [options] `repeat` makes it answer with the same questions over and over, `fail` with an error,
 *   `status` with that HTTP status, and `count` is how many questions it claims to have - one number for every
 *   category, or `{ history: 400, music: 90, ... }` for an API that has more of some than others
 * @returns {Function} the fake, carrying `calls` (every URL it was given)
 */
function fakeFetch({ repeat = false, fail = false, status = 200, count = 1000 } = {}) {
  let next = 0;
  const fetchImpl = async (url) => {
    fetchImpl.calls.push(String(url));
    if (fail) throw new Error('offline');
    const asked = new URL(String(url)).searchParams;
    if (String(url).includes('/count')) {
      // Read off the fake rather than the option it was made with, so a test can change its mind partway through.
      const says = fetchImpl.says;
      const held = typeof says === 'object' && says !== null ? (says[asked.get('categories')] ?? 0) : says;
      return { ok: status === 200, status, json: async () => ({ count: held }) };
    }
    const limit = Number(asked.get('limit'));
    // Questions come back of the category they were asked for, as the real API's do, so a test can tell which cache
    // one came out of.
    const category = asked.get('categories') ?? 'history';
    const body = Array.from({ length: limit }, () => apiQuestion(repeat ? 1 : next++, category));
    return { ok: status === 200, status, json: async () => body };
  };
  fetchImpl.calls = [];
  fetchImpl.says = count; // how many it claims to have; a test may change it to see the store notice
  return fetchImpl;
}

/** Every URL the fake fetch was asked for that was a request for questions, not for how many there are. */
const questionCalls = (fetchImpl) => fetchImpl.calls.filter((url) => !url.includes('/count'));

/** And the other way about: the requests that only asked how many there are. */
const countCalls = (fetchImpl) => fetchImpl.calls.filter((url) => url.includes('/count'));

/**
 * A fake question bank: `held` questions of its own, numbered apart from the API's so a test can tell them apart.
 * @param {number | object} held  how many questions it has: one number for every category, or `{ history: 90, ... }`
 * @param {object} [options] `fail` makes every call throw, as a database that has gone away would
 * @returns {object} the bank, carrying `draws` (how many questions each draw was asked for) and `filters` (what it
 *   was asked to narrow to, every time)
 */
function fakeBank(held, { fail = false } = {}) {
  /** How many it holds of whatever was asked for. */
  const has = (filters) => (typeof held === 'object' && held !== null ? (held[filters?.categories] ?? 0) : held);
  const bank = {
    draws: [],
    filters: [],
    count(filters) {
      bank.filters.push({ ...filters });
      if (fail) throw new Error('no database');
      return has(filters);
    },
    draw(count, filters) {
      bank.draws.push(count);
      bank.filters.push({ ...filters });
      if (fail) throw new Error('no database');
      const mine = has(filters);
      return Array.from({ length: Math.min(count * 3, mine) }, (_, n) => ({ ...apiQuestion(`bank-${bank.drawn + n}`), id: `bank-${bank.drawn + n}` }));
    },
    drawn: 0,
  };
  const draw = bank.draw;
  bank.draw = (count, filters) => {
    const got = draw(count, filters);
    bank.drawn += got.length;
    return got;
  };
  return bank;
}

/**
 * A fake fetch that says how many questions the API has but then refuses to hand any over, which is what a wobbly API
 * looks like to a store that has already counted it.
 * @param {number} count  how many it claims to have
 * @returns {Function} the fake, carrying `calls`
 */
function failingFetch(count) {
  const fetchImpl = async (url) => {
    fetchImpl.calls.push(String(url));
    if (String(url).includes('/count')) return { ok: true, status: 200, json: async () => ({ count }) };
    throw new Error('offline');
  };
  fetchImpl.calls = [];
  return fetchImpl;
}

/** How many of a handful of questions came from the bank. */
const fromBank = (questions) => questions.filter((q) => String(q.id).startsWith('bank-')).length;

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

test('prime fills every category with sixteen questions, in a request each', async () => {
  const { store, fetchImpl } = testStore();
  await store.prime();
  assert.equal(CACHE_SIZE, 16);
  assert.equal(store.categories.length, 10, 'the API has ten categories');
  assert.deepEqual(Object.values(store.held()), Array(10).fill(CACHE_SIZE), 'sixteen of each');
  assert.equal(store.ready, CACHE_SIZE * 10);
  assert.equal(questionCalls(fetchImpl).length, 10, 'one request a category: they are different questions');
  for (const url of questionCalls(fetchImpl)) assert.match(url, /limit=16/);
});

test('one category can be primed on its own', async () => {
  const { store, fetchImpl } = testStore();
  await store.prime('movies');
  assert.equal(store.ready, CACHE_SIZE);
  assert.equal(store.held().film_and_tv, CACHE_SIZE, 'the one that was asked for, under its own name');
  assert.equal(questionCalls(fetchImpl).length, 1);
});

test('take hands out one question by default and refills behind it', async () => {
  const { store } = testStore();
  const taken = await store.take();
  assert.equal(taken.length, 1);
  // Whichever question it is - a cacheful is shuffled, so it is not always the first the API sent.
  assert.equal(taken[0].answers[taken[0].correct], taken[0].id.replace('id-', 'right-'));
  await store.prime(); // waits for the refill the take started, and fills the rest
  assert.deepEqual(Object.values(store.held()), Array(10).fill(CACHE_SIZE), 'every category full for the next request');
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

test('the questions come from the cache, so a take needs no request of its own', async () => {
  // One category, so that this is about the cache rather than about which category the takes happened to draw.
  const answer = fakeFetch();
  let open = true;
  const fetchImpl = async (url) => {
    // Once the cache is primed the API goes away, so anything handed out after that came from what was in hand.
    if (!open) throw new Error('offline');
    return answer(url);
  };
  fetchImpl.calls = answer.calls;

  const { store } = testStore({ fetchImpl, categories: 'history' });
  await store.prime();
  assert.equal(questionCalls(fetchImpl).length, 1);
  open = false;

  const first = await store.take(3);
  const second = await store.take(3);
  assert.equal(new Set([...first, ...second].map((q) => q.id)).size, 6, 'six questions, with nowhere to have fetched them from');
});

test('overlapping takes share one fill rather than racing', async () => {
  // The fake holds its answer back until the test lets go, so both takes are still waiting when the requests are counted.
  let letGo;
  const held = new Promise((resolve) => { letGo = resolve; });
  const answer = fakeFetch();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    // Only the questions are held back; the counts answer at once, since they are not what is being shared here.
    if (!String(url).includes('/count')) await held;
    return answer(url);
  };
  const { store } = testStore({ fetchImpl });

  // Both of one category: two takes that want different ones have nothing to share, and rightly ask for both.
  const both = Promise.all([store.take(2, { category: 'history' }), store.take(2, { category: 'history' })]);
  await new Promise((resolve) => setImmediate(resolve));
  const asked = calls.filter((url) => !url.includes('/count'));
  assert.equal(asked.length, 1, 'the second take should wait on the request the first one started');

  letGo();
  const [first, second] = await both;
  const ids = [...first, ...second].map((q) => q.id);
  assert.equal(new Set(ids).size, 4, 'and the two takes still get different questions');
});

test('the request carries the UK region by default, and whatever filters the store was given', async () => {
  const { store, fetchImpl } = testStore();
  await store.prime();
  for (const url of fetchImpl.calls) assert.match(url, /region=GB/, 'the counts as much as the questions');

  const picky = testStore({ region: 'US', categories: 'history,music', difficulties: 'easy', tags: 'geology', size: 4 });
  await picky.store.prime();
  assert.equal(questionCalls(picky.fetchImpl).length, 2, 'the two categories it was narrowed to, and no others');
  const asked = new Set();
  for (const call of questionCalls(picky.fetchImpl)) {
    const url = new URL(call);
    assert.equal(url.origin + url.pathname, 'https://the-trivia-api.com/v2/questions');
    assert.equal(url.searchParams.get('region'), 'US');
    assert.equal(url.searchParams.get('difficulties'), 'easy');
    assert.equal(url.searchParams.get('tags'), 'geology');
    assert.equal(url.searchParams.get('limit'), '4');
    asked.add(url.searchParams.get('categories'));
  }
  // Each request is for one category, because each category has a cache of its own to fill.
  assert.deepEqual([...asked].sort(), ['history', 'music']);
});

test('a store can be told to keep a different number of questions ready', async () => {
  const { store } = testStore({ size: 3, categories: 'history' });
  await store.prime();
  assert.equal(store.ready, 3);
  assert.equal(testStore({ size: 3 }).store.categories.length, 10, 'and that many of each, when it holds the lot');
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

// ---- the site's own questions, beside the API's ----

test('a store with no questions of its own still counts the API, to weigh its categories by', async () => {
  const { store, fetchImpl } = testStore({}, { count: 400 });
  await store.prime();
  const counted = await store.sources();
  assert.equal(counted.bank, 0, 'it has no questions of its own');
  assert.equal(counted.api, 400 * 10);
  assert.deepEqual(counted.byCategory.music, { api: 400, bank: 0 });
  assert.equal(countCalls(fetchImpl).length, 10, 'one a category: the API has no endpoint that breaks the total down');
  assert.equal(store.ready, CACHE_SIZE * 10);
});

test('both sides are counted a category at a time, once, whatever the store is then asked for', async () => {
  const bank = fakeBank(500);
  const { store, fetchImpl } = testStore({ bank }, { count: 1500 });
  await store.prime();
  const counted = await store.sources();
  assert.equal(counted.api, 1500 * 10, 'the fake says 1500 of each of the ten');
  assert.equal(counted.bank, 500 * 10);
  assert.deepEqual(counted.byCategory.history, { api: 1500, bank: 500 }, 'and it knows which came from where');
  assert.equal(Object.keys(counted.byCategory).length, 10);
  await store.take(4);
  await store.take(4);
  assert.equal(countCalls(fetchImpl).length, 10, 'one count a category, once, not once a fill');
});

test('the count request carries the same filters as the questions do', async () => {
  const { store, fetchImpl } = testStore({ bank: fakeBank(10), categories: 'history', difficulties: 'easy', region: 'GB' });
  await store.prime();
  const [counted] = countCalls(fetchImpl);
  const asked = new URL(counted);
  assert.equal(asked.pathname.endsWith('/questions/count'), true);
  assert.equal(asked.searchParams.get('categories'), 'history');
  assert.equal(asked.searchParams.get('difficulties'), 'easy');
  assert.equal(asked.searchParams.get('region'), 'GB');
  assert.equal(asked.searchParams.get('limit'), null, 'a count is not a question');
});

test('each question picks its source, so the bank answers about its share of them', async () => {
  // Half and half: over several hundred questions the bank should answer roughly half, and certainly not none or all.
  let drawn = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const bank = fakeBank(1000);
    const { store } = testStore({ bank, rng: seeded(seed), size: 20 }, { count: 1000 });
    drawn += fromBank(await store.take(20));
  }
  const share = drawn / (12 * 20);
  assert.ok(share > 0.3 && share < 0.7, `the bank answered ${Math.round(share * 100)}% of them, which should be about half`);
});

test('a bank holding a tenth as many questions answers about a tenth of them', async () => {
  let drawn = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const bank = fakeBank(100);
    const { store } = testStore({ bank, rng: seeded(seed), size: 20 }, { count: 900 });
    drawn += fromBank(await store.take(20));
  }
  const share = drawn / (12 * 20);
  assert.ok(share > 0.02 && share < 0.25, `the bank answered ${Math.round(share * 100)}% of them, which should be about a tenth`);
});

test('a question is asked of one source or the other, never counted twice', async () => {
  const bank = fakeBank(1000);
  const { store } = testStore({ bank, size: 12 }, { count: 1000 });
  const questions = await store.take(12);
  assert.equal(questions.length, 12);
  assert.equal(new Set(questions.map((q) => q.id)).size, 12, 'no question twice');
  const own = fromBank(questions);
  assert.ok(own > 0 && own < 12, `${own} of the twelve came from the bank`);
});

test('a bank with nothing in it yet is the same as having none: every question comes from the API', async () => {
  // What a new site looks like, since server/index.js always hands the store a bank: it is simply empty until
  // somebody puts questions in it.
  const bank = fakeBank(0);
  const { store, fetchImpl } = testStore({ bank, size: 8 }, { count: 1000 });
  const questions = await store.take(8);
  assert.equal(questions.length, 8);
  assert.equal(fromBank(questions), 0, 'there was nothing to take from the bank');
  assert.deepEqual(bank.draws, [], 'and so it was never drawn on');
  const counted = await store.sources();
  assert.equal(counted.bank, 0);
  assert.equal(counted.api, 1000 * 10, 'the API is still counted, because the categories are weighed by it');
  assert.ok(questionCalls(fetchImpl).length > 0);
});

test('a store whose API has nothing takes every question from its own bank, without asking for any', async () => {
  const bank = fakeBank(50);
  const { store, fetchImpl } = testStore({ bank, size: 8 }, { count: 0 });
  const questions = await store.take(8);
  assert.equal(fromBank(questions), 8);
  assert.deepEqual(questionCalls(fetchImpl), [], 'an API with no questions is not asked for any');
});

test('an API that falls over is made up for by the bank rather than failing the game', async () => {
  const bank = fakeBank(50);
  const { store } = testStore({ bank, size: 8, fetchImpl: failingFetch(1000) });
  const questions = await store.take(8);
  assert.equal(questions.length, 8);
  assert.equal(fromBank(questions), 8, 'all of them came from the questions the site holds');
});

test('a bank that falls over is made up for by the API', async () => {
  const bank = fakeBank(50, { fail: true });
  const { store } = testStore({ bank, size: 8 }, { count: 1000 });
  const questions = await store.take(8);
  assert.equal(questions.length, 8);
  assert.equal(fromBank(questions), 0, 'they all came from the API');
});

test('with both sources gone, the game is still told rather than left waiting', async () => {
  const bank = fakeBank(0);
  const { store } = testStore({ bank }, { fail: true });
  await assert.rejects(() => store.take(1), (error) => error.code === 'triviaUnavailable');
});

test('a question the bank has already given is not given again', async () => {
  const bank = fakeBank(6);
  const { store } = testStore({ bank, size: 6 }, { count: 0 });
  const first = await store.take(3);
  const second = await store.take(3);
  const ids = [...first, ...second].map((q) => q.id);
  assert.equal(new Set(ids).size, 6, 'six different questions');
});

// ---- the API's category names, which the bank has to be asked in the same form ----

test('an alias is turned into the name a question actually carries', () => {
  assert.equal(canonicalCategory('movies'), 'film_and_tv');
  assert.equal(canonicalCategory('film'), 'film_and_tv');
  assert.equal(canonicalCategory('novels'), 'arts_and_literature');
  assert.equal(canonicalCategory('sports'), 'sport_and_leisure');
  assert.equal(canonicalCategory(' Movies '), 'film_and_tv', 'however it is typed');
  assert.equal(canonicalCategory('history'), 'history', 'a canonical name is already one');
  assert.equal(canonicalCategory('nothing-like-it'), 'nothing-like-it', 'and a name the API does not know is left alone');
});

test('every category is its own canonical name, and no alias is claimed twice', () => {
  const seen = new Set();
  for (const [name, aliases] of Object.entries(CATEGORIES)) {
    assert.equal(canonicalCategory(name), name, name);
    for (const alias of [name, ...aliases]) {
      assert.equal(seen.has(alias), false, `${alias} belongs to more than one category`);
      seen.add(alias);
    }
  }
  assert.equal(Object.keys(CATEGORIES).length, 10, 'the API offers ten');
});

test('a list of categories comes back canonical, without repeats', () => {
  assert.equal(canonicalCategories('movies,history'), 'film_and_tv,history');
  assert.equal(canonicalCategories(['film', 'movies']), 'film_and_tv', 'two names for one category are one category');
  assert.equal(canonicalCategories('history , music '), 'history,music');
  assert.equal(canonicalCategories(''), undefined);
  assert.equal(canonicalCategories(undefined), undefined, 'a store without the filter still has none');
});

test('both sources are asked for a category by the name a question carries, not by the alias given', () => {
  const bank = fakeBank(100);
  const { store, fetchImpl } = testStore({ bank, categories: 'movies' }, { count: 100 });
  return store.prime().then(() => {
    for (const url of fetchImpl.calls) {
      assert.equal(new URL(url).searchParams.get('categories'), 'film_and_tv', url);
    }
    for (const asked of bank.filters) assert.equal(asked.categories, 'film_and_tv');
  });
});

// ---- a cacheful a category ----

test('a take of one category hands out that category, by whichever of its names was used', async () => {
  const { store } = testStore();
  for (const question of await store.take(3, { category: 'music' })) assert.equal(question.category, 'music');
  for (const question of await store.take(3, { category: 'movies' })) {
    assert.equal(question.category, 'film_and_tv', 'an alias is the category it stands for');
  }
  assert.equal(store.held().music, CACHE_SIZE, 'and the cache it came out of was topped back up');
});

test('a take of one category leaves the others alone', async () => {
  const { store, fetchImpl } = testStore();
  await store.take(2, { category: 'history' });
  await store.prime('history'); // waits for the refill the take started, and starts nothing else
  const held = store.held();
  assert.equal(held.history, CACHE_SIZE, 'filled, taken from, and filled again');
  for (const [kind, ready] of Object.entries(held)) {
    if (kind !== 'history') assert.equal(ready, 0, `${kind} was fetched for no reason`);
  }
  for (const url of questionCalls(fetchImpl)) assert.equal(new URL(url).searchParams.get('categories'), 'history');
});

// The questions The Trivia API really had of each category for region GB when this was written: six times as many
// about film and television as about general knowledge, which is the lopsidedness the weighing is for.
const GB_COUNTS = {
  arts_and_literature: 690,
  film_and_tv: 816,
  food_and_drink: 415,
  general_knowledge: 134,
  geography: 808,
  history: 483,
  music: 524,
  science: 549,
  society_and_culture: 419,
  sport_and_leisure: 407,
};

/** How many questions of each category a store handed out over several takes. */
async function spread(store, takes, each) {
  const tally = new Map();
  for (let n = 0; n < takes; n++) {
    for (const question of await store.take(each)) tally.set(question.category, (tally.get(question.category) ?? 0) + 1);
  }
  return tally;
}

test('a category comes up as often as the API has questions of it, not one time in ten', async () => {
  const { store } = testStore({ rng: seeded(11), size: 50 }, { count: GB_COUNTS });
  const tally = await spread(store, 20, 25); // five hundred questions
  const total = [...tally.values()].reduce((sum, n) => sum + n, 0);
  assert.equal(total, 500);
  const share = (kind) => (tally.get(kind) ?? 0) / total;
  const ofTheApi = (kind) => GB_COUNTS[kind] / Object.values(GB_COUNTS).reduce((sum, n) => sum + n, 0);
  for (const kind of Object.keys(GB_COUNTS)) {
    assert.ok(Math.abs(share(kind) - ofTheApi(kind)) < 0.05, `${kind}: ${Math.round(share(kind) * 100)}% handed out, ${Math.round(ofTheApi(kind) * 100)}% of the API`);
  }
  assert.ok(share('film_and_tv') > share('general_knowledge') * 2, 'the commonest category beats the rarest handsomely');
});

test('the questions a site has of its own count towards how often its categories come up', async () => {
  // The API has the same of each; the site has put two thousand history questions in and nothing else.
  const even = Object.fromEntries(Object.keys(GB_COUNTS).map((kind) => [kind, 100]));
  const plain = testStore({ rng: seeded(3), size: 40 }, { count: even });
  const evenly = await spread(plain.store, 10, 20);
  assert.ok((evenly.get('history') ?? 0) < 50, 'with nothing of its own, history is one category of ten');

  const bank = fakeBank({ history: 2000 });
  const { store } = testStore({ bank, rng: seeded(3), size: 40 }, { count: even });
  const tally = await spread(store, 10, 20);
  assert.ok(tally.get('history') > 100, `history came up ${tally.get('history')} times in two hundred, which is not often enough`);
  assert.ok(tally.size > 3, 'but it has not taken the game over either');
});

test('a store that cannot count anything still hands out every category', async () => {
  // The count endpoint is down but the questions are fine, so there is nothing to weigh by: an even chance each,
  // which is what the store did before it counted.
  const answer = fakeFetch();
  const fetchImpl = async (url) => {
    if (String(url).includes('/count')) throw new Error('offline');
    return answer(url);
  };
  fetchImpl.calls = answer.calls;

  const { store } = testStore({ fetchImpl, rng: seeded(7), size: 30 });
  assert.deepEqual(await store.sources(), { api: 0, bank: 0, byCategory: Object.fromEntries(store.categories.map((k) => [k, { api: 0, bank: 0 }])) });
  const tally = await spread(store, 10, 10);
  assert.ok(tally.size >= 7, `only ${tally.size} categories came up`);
});

// ---- the counts are kept for a day ----

/** Lets everything already in flight finish.  No fake here waits on anything real, so one turn of the loop does it. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A clock the test winds on itself, and a store that reads it. */
function withClock(options, fetchOptions) {
  let at = 1_000_000;
  const made = testStore({ now: () => at, ...options }, fetchOptions);
  return { ...made, wind: (ms) => { at += ms; } };
}

test('the counts are taken once and then kept, however much is asked of the store', async () => {
  const { store, fetchImpl, wind } = withClock({ categories: 'history', size: 4 });
  await store.prime();
  assert.equal(countCalls(fetchImpl).length, 1);
  wind(COUNT_GOOD_FOR - 1);
  for (let n = 0; n < 5; n++) await store.take(2);
  assert.equal(countCalls(fetchImpl).length, 1, 'still yesterday, so still yesterday’s counts');
});

test('a day later the next fill counts again, and the questions do not wait for it', async () => {
  // The counts can be held back on demand, so that the test can see whether a take waits on one.
  let letGo = () => {};
  let holding = false;
  const answer = fakeFetch({ count: 100 });
  const fetchImpl = async (url) => {
    const reply = answer(url); // asked for straight away, whatever happens to the answer
    if (holding && String(url).includes('/count')) await new Promise((resolve) => { letGo = resolve; });
    return reply;
  };
  fetchImpl.calls = answer.calls;

  const { store, wind } = withClock({ fetchImpl, categories: 'history', size: 4 });
  await store.prime();
  assert.equal((await store.sources()).api, 100);
  assert.equal(countCalls(fetchImpl).length, 1);

  wind(COUNT_GOOD_FOR);
  holding = true;
  answer.says = 900; // from here the API has more questions than it had, which the store should notice

  const taken = await store.take(4); // empties the cache, so this one has to fill, which is what counts again
  assert.equal(taken.length, 4, 'the questions came back without waiting on the count');
  assert.equal(countCalls(fetchImpl).length, 2, 'the second count was asked for, and is still in the air');
  assert.equal((await store.sources()).api, 100, 'which is still reported as yesterday’s number, rather than waited for');

  letGo();
  await settle();
  assert.equal((await store.sources()).api, 900, 'and once it lands, the new number is what it weighs by');

  wind(60_000);
  holding = false;
  await store.take(2);
  assert.equal(countCalls(fetchImpl).length, 2, 'and not again until tomorrow');
});

test('a count taken while the API is down keeps the numbers it had', async () => {
  const answer = fakeFetch({ count: 500 });
  let open = true;
  let countsAsked = 0; // counted here rather than off the fake, which only records what it manages to answer
  const fetchImpl = async (url) => {
    if (String(url).includes('/count')) {
      countsAsked++;
      if (!open) throw new Error('offline');
    }
    return answer(url);
  };
  fetchImpl.calls = answer.calls;

  const { store, wind } = withClock({ fetchImpl, categories: 'history', size: 4 });
  await store.prime();
  assert.equal((await store.sources()).api, 500);
  assert.equal(countsAsked, 1);

  open = false;
  wind(COUNT_GOOD_FOR);
  await store.take(4); // the fill that notices the counts are a day old
  await settle();
  assert.equal(countsAsked, 2, 'it did ask again');
  assert.equal((await store.sources()).api, 500, 'and kept what it knew: yesterday’s count beats no count at all');
});

test('a take that names no category spreads over all of them', async () => {
  // Forty questions from ten categories: every one should turn up, and none should answer more than its share.
  const { store } = testStore({ rng: seeded(5) });
  const questions = await store.take(40);
  assert.equal(questions.length, 40);
  const answered = new Map();
  for (const question of questions) answered.set(question.category, (answered.get(question.category) ?? 0) + 1);
  assert.ok(answered.size >= 8, `only ${answered.size} categories of the ten came up`);
  for (const [kind, n] of answered) assert.ok(n < 15, `${kind} answered ${n} of the forty`);
});

test('a take of a category this store does not hold is a mistake, not an empty answer', async () => {
  const { store, fetchImpl } = testStore();
  await assert.rejects(() => store.take(1, { category: 'basket weaving' }), TypeError);
  const narrow = testStore({ categories: 'history,music' });
  assert.deepEqual(narrow.store.categories, ['history', 'music'], 'it holds only what it was narrowed to');
  await assert.rejects(() => narrow.store.take(1, { category: 'science' }), TypeError, 'a real category it was not given');
  assert.equal((await narrow.store.take(1, { category: 'music' })).length, 1);
  assert.equal(fetchImpl.calls.length, 0, 'and a mistake never reaches the network');
});

test('a take with no category named is the same request it always was', async () => {
  // What a game that knows nothing of categories does: ask for some questions and get some questions.
  const { store } = testStore();
  const first = await store.take(5);
  const second = await store.take(5);
  const all = [...first, ...second];
  assert.equal(all.length, 10);
  assert.equal(new Set(all.map((q) => q.id)).size, 10, 'all different');
  for (const question of all) {
    assert.equal(question.answers.length, 4);
    assert.equal(typeof question.question, 'string');
  }
});

test('a category that cannot be filled is made up from the others, unless it was the one asked for', async () => {
  // The API has history questions and nothing else at all.
  const fetchImpl = async (url) => {
    fetchImpl.calls.push(String(url));
    const asked = new URL(String(url)).searchParams;
    if (asked.get('categories') !== 'history') return { ok: true, status: 200, json: async () => [] };
    const limit = Number(asked.get('limit'));
    return { ok: true, status: 200, json: async () => Array.from({ length: limit }, () => apiQuestion(fetchImpl.next++, 'history')) };
  };
  fetchImpl.calls = [];
  fetchImpl.next = 0;

  const { store } = testStore({ fetchImpl });
  const questions = await store.take(6);
  assert.equal(questions.length, 6, 'the request is still answered in full');
  for (const question of questions) assert.equal(question.category, 'history');
  await assert.rejects(
    () => store.take(2, { category: 'music' }),
    (error) => error.code === 'triviaUnavailable',
    'but a take of music is not quietly answered with history',
  );
});

