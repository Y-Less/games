// Trivia questions, kept in a small cache so a game never waits for the network mid-round.  A store holds 16
// ready-to-use questions; `take(n)` hands out that many and quietly refills behind the player's back.  Answers arrive
// already shuffled with the index of the right one, so a game never has to know that a question is stored as the right
// answer and the wrong ones.
//
//   const store = sharedTrivia();                   // the site-wide cache, filtered to questions that suit the UK
//   const [question] = await store.take();          // { id, question, answers, correct, ... }
//   const five = await store.take(5);
//
// **Two sources.**  Questions come from The Trivia API (https://the-trivia-api.com) and from the site's own question
// bank (server/triviaBank.js), if it has been given one.  The first time a store needs questions it asks both how many
// they have, and from then on it chooses between them for *each* question at that ratio: a bank holding a quarter as
// many questions as the API answers about a fifth of them.  A source that comes up short is made up for by the other,
// so a game carries on when the API is down or the bank is empty.
//
// The API's questions are licensed CC BY-NC 4.0, so the site credits the API in the Games help page.
// Server-side only: it needs `fetch`, and a browser could not keep one shared cache for everybody anyway.
// Depends on: ./cards.js (shuffle), and the global fetch.
import { shuffle } from './cards.js';

// Where the questions come from, and how many a store keeps ready.
const API = 'https://the-trivia-api.com/v2/questions';
// The same endpoint with the same filters, but answering with how many questions there are rather than with questions.
const API_COUNT = `${API}/count`;
export const CACHE_SIZE = 16;

/**
 * The categories the API offers, each with the other names it answers to (from https://the-trivia-api.com/v2/categories).
 *
 * The API resolves an alias itself, but a question reports only the canonical name, so the site's own questions are
 * stored under that name: a filter therefore has to be put into canonical form before either source is asked, or
 * `categories=movies` would find questions at the API and none at all in the bank.
 */
export const CATEGORIES = {
  arts_and_literature: ['arts', 'literature', 'novels'],
  film_and_tv: ['movies', 'film'],
  food_and_drink: ['food', 'drink', 'alcohol'],
  general_knowledge: [],
  geography: [],
  history: [],
  music: [],
  science: [],
  society_and_culture: ['society', 'culture'],
  sport_and_leisure: ['sports', 'sport', 'games'],
};

/** Every name the API answers to, against the one a question carries: 'movies' -> 'film_and_tv'. */
const CANONICAL = new Map(Object.entries(CATEGORIES).flatMap(([name, aliases]) => [[name, name], ...aliases.map((alias) => [alias, name])]));

/**
 * One category name in the form a question carries it, so that one filter finds the same questions at either source.
 * A name the API does not know is left alone: it will simply find nothing, which is what it would do anyway.
 *
 * @param {string} name  a category name or one of its aliases, in any case
 * @returns {string} the canonical name
 * Side effects: none.
 */
export const canonicalCategory = (name) => {
  const tidy = String(name ?? '').trim();
  return CANONICAL.get(tidy.toLowerCase()) ?? tidy;
};

/**
 * A comma-separated list of categories with every name in canonical form (see canonicalCategory).  Nothing in gives
 * nothing out, so that a store without the filter still has none.
 *
 * @param {string | string[] | undefined} value  'movies,history', ['movies'], or nothing
 * @returns {string | undefined} the list, or undefined when there was nothing in it
 * Side effects: none.
 */
export function canonicalCategories(value) {
  const names = (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((name) => canonicalCategory(name))
    .filter(Boolean);
  return names.length ? [...new Set(names)].join(',') : undefined;
}
// The API refuses a limit above this, so a large fill is split into several requests.
const MAX_PER_REQUEST = 50;
// How many requests one fill may make before giving up on finding questions nobody has seen yet.
const MAX_ROUNDS = 4;

/**
 * The error every failure throws, so a caller can tell "the API is down" from a programming mistake.
 * @param {string} why  for the logs, never shown to a player
 * @returns {Error} with `code` set to 'triviaUnavailable', which a module's server turns into a message key
 */
const unavailable = (why) => Object.assign(new Error(`trivia: ${why}`), { code: 'triviaUnavailable' });

/**
 * Turns one question as the API sends it into the shape a game wants: every answer in one shuffled list, plus the index
 * of the right one.
 * @param {object} raw  one entry of the API's reply
 * @param {() => number} rng  random source returning a number in [0, 1)
 * @returns {object|null} `{ id, question, answers, correct, category, difficulty, tags, regions }`, or null when the
 *   entry is not a usable multiple-choice question (`correct` is an index into `answers`)
 * Side effects: none beyond advancing `rng`.
 */
export function prepare(raw, rng = Math.random) {
  const text = raw?.question?.text;
  const right = raw?.correctAnswer;
  const wrong = Array.isArray(raw?.incorrectAnswers) ? raw.incorrectAnswers : [];
  if (typeof text !== 'string' || typeof right !== 'string' || !wrong.length) return null;
  const answers = shuffle([right, ...wrong], rng);
  return {
    id: String(raw.id ?? text),
    question: text,
    answers,
    correct: answers.indexOf(right),
    category: raw.category ?? '',
    difficulty: raw.difficulty ?? '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    regions: Array.isArray(raw.regions) ? raw.regions : [],
  };
}

/**
 * A cache of ready-to-use questions.  Nothing is fetched until the first `take` or `prime`.
 *
 * @param {object} [options]
 * @param {number} [options.size]  how many questions to keep ready (default 16)
 * @param {string} [options.region]  ISO country code; GB also lets in questions that only make sense in the UK
 * @param {string} [options.categories]  comma-separated API categories, e.g. 'history,music'
 * @param {string} [options.difficulties]  comma-separated, from easy, medium, and hard
 * @param {string} [options.tags]  comma-separated API tags, e.g. 'geology'
 * @param {() => number} [options.rng]  random source; pass a seeded one in tests
 * @param {typeof fetch} [options.fetchImpl]  the fetch to use; pass a fake one in tests
 * @param {{ count: Function, draw: Function } | null} [options.bank]  the site's own questions (server/triviaBank.js);
 *   without one every question comes from the API
 * @returns {{ take: (count?: number) => Promise<object[]>, prime: () => Promise<void>, ready: number, forget: () => void,
 *   sources: () => Promise<{ api: number, bank: number }> }}
 * Side effects: none until a method is called; after that it makes HTTPS requests to the API and reads the bank.
 */
export function createTriviaStore(options = {}) {
  const {
    size = CACHE_SIZE,
    region = 'GB',
    categories,
    difficulties,
    tags,
    rng = Math.random,
    fetchImpl = (...args) => fetch(...args),
    bank = null,
  } = options;

  // The questions waiting to be handed out, the ids already handed out (so a player never sees one twice), and the fill
  // in flight, if any, so two overlapping takes share one set of requests rather than racing.
  const cache = [];
  const seen = new Set();
  let filling = null;

  // Whatever this store was asked to narrow its questions to; both sources are given the same, which is why the
  // categories are put into the form a question carries before either of them sees them.
  const filters = { region, categories: canonicalCategories(categories), difficulties, tags };

  /** Those filters as query parameters, which is how the API takes them. */
  const query = () => {
    const parameters = new URLSearchParams();
    for (const [name, value] of Object.entries(filters)) if (value) parameters.set(name, value);
    return parameters;
  };

  /** The URL for one request, carrying whichever filters this store was given. */
  const urlFor = (count) => {
    const parameters = query();
    parameters.set('limit', String(Math.min(count, MAX_PER_REQUEST)));
    return `${API}?${parameters}`;
  };

  // How many questions each source has, asked once and then kept: see the head of this file.  `null` until then.
  let counts = null;
  let counting = null;

  /**
   * Asks the API and the bank how many questions they have.  The API is only asked when the bank has some, because
   * that is the only time the answer changes anything: with no questions of its own a store takes every one of them
   * from the API, and a store with no bank at all never touches the count endpoint.
   *
   * An API that will not say is counted as having none, so that a site with questions of its own carries on asking
   * them while the API is unreachable.
   * @returns {Promise<{ api: number, bank: number }>}
   * Side effects: reads the bank, and may make one request to the API.
   */
  const countSources = async () => {
    let held = 0;
    try {
      const found = bank?.count(filters);
      held = Number.isFinite(found) && found > 0 ? found : 0;
    } catch {
      held = 0; // a bank that will not answer is a bank with nothing in it
    }
    if (!held) return { api: 0, bank: 0 };
    try {
      const reply = await fetchImpl(`${API_COUNT}?${query()}`, { headers: { accept: 'application/json' } });
      if (!reply?.ok) return { api: 0, bank: held };
      const body = await reply.json();
      return { api: Number.isFinite(body?.count) && body.count > 0 ? body.count : 0, bank: held };
    } catch {
      return { api: 0, bank: held };
    }
  };

  /** The counts, asked for once however many callers want them at the same moment. */
  const sources = () => {
    if (counts) return Promise.resolve(counts);
    counting ??= countSources()
      .then((found) => {
        counts = found;
        return found;
      })
      .finally(() => {
        counting = null;
      });
    return counting;
  };

  /**
   * How many of the next `want` questions should come from the bank: a choice made for each question on its own, at
   * the ratio of the two counts, which is what makes a bank of a tenth the size answer about a tenth of the questions.
   * @param {number} want  how many questions are wanted
   * @param {{ api: number, bank: number }} held  how many each source has
   * @returns {number} how many to draw from the bank (the rest come from the API)
   * Side effects: advances `rng` once per question.
   */
  const bankShare = (want, held) => {
    if (!bank || !held.bank) return 0;
    if (!held.api) return want; // nothing to be had from the API: the bank answers everything
    const share = held.bank / (held.api + held.bank);
    let fromBank = 0;
    for (let n = 0; n < want; n++) if (rng() < share) fromBank++;
    return fromBank;
  };

  /**
   * Takes questions from the bank, keeping the ones nobody has seen.
   * @param {number} count  how many are wanted
   * @returns {number} how many fresh questions were added to the cache
   * Side effects: appends to `cache` and `seen`.
   */
  const drawFromBank = (count) => {
    if (!bank || count < 1) return 0;
    let added = 0;
    let raws = [];
    try {
      raws = bank.draw(count, filters) ?? [];
    } catch {
      return 0; // a bank that will not answer is simply a bank with nothing in it
    }
    for (const raw of raws) {
      if (added >= count) break;
      const question = prepare(raw, rng);
      if (!question || seen.has(question.id)) continue;
      seen.add(question.id);
      cache.push(question);
      added++;
    }
    return added;
  };

  /**
   * One request, appending every usable, unseen question to the cache.
   * @param {number} count  how many to ask for
   * @returns {Promise<number>} how many fresh questions were added
   */
  const fetchRound = async (count) => {
    let reply;
    try {
      reply = await fetchImpl(urlFor(count), { headers: { accept: 'application/json' } });
    } catch (cause) {
      throw Object.assign(unavailable(`request failed: ${cause?.message ?? cause}`), { cause });
    }
    if (!reply?.ok) throw unavailable(`the API answered ${reply?.status ?? '(no response)'}`);
    let body;
    try {
      body = await reply.json();
    } catch (cause) {
      throw Object.assign(unavailable('the API did not answer with JSON'), { cause });
    }
    if (!Array.isArray(body)) throw unavailable('the API did not answer with a list of questions');
    let added = 0;
    for (const raw of body) {
      const question = prepare(raw, rng);
      if (!question || seen.has(question.id)) continue;
      seen.add(question.id);
      cache.push(question);
      added++;
    }
    return added;
  };

  /**
   * Tops the cache back up to `target`, asking again when a round brings back only questions already seen.  If every
   * question the filters allow has been seen, the memory of what was handed out is cleared and they come round again,
   * which is what `drawUnused` does for words and spectra elsewhere.
   *
   * Each round chooses a source for every question it needs (see bankShare) and then asks each source for its share in
   * one go, which is the same thing as asking question by question but a single request.  Whatever one source cannot
   * supply is asked of the other before the round is given up on, so an empty bank or a silent API only costs a round.
   */
  const fill = async (target) => {
    const held = await sources();
    // The API is asked unless the bank is the only source with anything in it: a store with no questions of its
    // own (or whose bank has gone away, which counts as none) has nowhere else to ask.
    let askApi = !held.bank || held.api > 0;
    for (let round = 0; cache.length < target && round < MAX_ROUNDS; round++) {
      const want = target - cache.length;
      const fromBank = bankShare(want, held);
      let added = drawFromBank(fromBank);
      if (askApi && want > added) {
        try {
          added += await fetchRound(want - added);
        } catch (error) {
          // With questions of its own the store carries on without the API for the rest of this fill; without them
          // there is nothing to carry on with, and the caller is told.
          if (!held.bank) throw error;
          askApi = false;
        }
      }
      // Whatever the API could not supply is asked of the bank, if it was not already asked for all of it.
      if (cache.length < target && fromBank < want) added += drawFromBank(target - cache.length);
      // Nothing new twice running means the filters have been exhausted rather than a source being unlucky.
      if (!added && round) seen.clear();
    }
  };

  /**
   * Runs a fill, sharing one in-flight promise between overlapping callers.
   * @param {number} [target]  how full the cache should end up; a take of more than `size` asks for more than usual
   */
  const fillOnce = (target = size) => {
    if (!filling) filling = fill(target).finally(() => { filling = null; });
    return filling;
  };

  return {
    /**
     * Hands out questions, fetching only if the cache cannot cover the request.
     * @param {number} [count]  how many to hand out (default 1)
     * @returns {Promise<object[]>} always an array, `count` long, each `{ id, question, answers, correct, ... }`
     * @throws an Error with `code` 'triviaUnavailable' when the API cannot supply enough questions
     * Side effects: empties that many questions out of the cache and starts a background refill.
     */
    async take(count = 1) {
      if (!Number.isInteger(count) || count < 1) throw new TypeError(`trivia: take(${count}) wants a positive whole number`);
      // A request for more than the cache holds is allowed: the fill simply aims higher than usual this once.
      if (cache.length < count) await fillOnce(Math.max(size, count));
      if (cache.length < count) throw unavailable(`only ${cache.length} of ${count} questions available`);
      const taken = cache.splice(0, count);
      // Refill for the next request, but do not make this caller wait for it, or fail if it goes wrong: the cache is
      // simply short, and the next `take` will try again.
      if (cache.length < size) fillOnce().catch(() => {});
      return taken;
    },

    /**
     * Fills the cache ahead of time, so the first `take` of a game is instant.
     * @returns {Promise<void>} resolving when the cache is full, or rejecting as `take` would
     */
    prime: () => fillOnce(),

    /** How many questions are ready to hand out right now, without touching the network. */
    get ready() {
      return cache.length;
    },

    /** Forgets which questions have been handed out, so they may come round again.  Mostly for the tests. */
    forget: () => seen.clear(),

    /**
     * How many questions each source has, as the store counted them the first time it needed any; asking before then
     * is what counts them.  Both are 0 for a store with no questions of its own, which takes every one from the API
     * and so never needs to know how many that is.
     * @returns {Promise<{ api: number, bank: number }>}
     * Side effects: the first call asks the API and the bank (see the head of this file).
     */
    sources,
  };
}

// The site-wide store, made on first use so that importing this file never touches the network, and the questions of
// the site's own that it draws on (set by server/index.js as the site starts, before any game asks for a question).
let shared = null;
let sharedBank = null;

/**
 * The one cache the whole site shares, so several games draw from the same 16 questions in hand and no two of them ask
 * a player the same question.
 * @returns {ReturnType<typeof createTriviaStore>} the shared store, made on the first call
 * Side effects: makes the store the first time it is called.
 */
export function sharedTrivia() {
  if (!shared) shared = createTriviaStore({ bank: sharedBank });
  return shared;
}

/**
 * Gives the shared store the site's own questions (server/triviaBank.js).  The site does this as it starts, before the
 * games are loaded; a store already made is thrown away so that the next one is built with the bank, which costs
 * nothing at startup because it holds no questions yet.
 *
 * One process runs one site, so there is one bank: a test that wants its own should make a store of its own with
 * `createTriviaStore({ bank })` rather than setting this.
 *
 * @param {{ count: Function, draw: Function } | null} bank  the questions, or null to go back to the API alone
 * @returns {void}
 * Side effects: replaces the shared store.
 */
export function setTriviaBank(bank) {
  sharedBank = bank ?? null;
  shared = null;
}
