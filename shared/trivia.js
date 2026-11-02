// Trivia questions from The Trivia API (https://the-trivia-api.com), kept in a small cache so a game never waits for the
// network mid-round.  A store holds 16 ready-to-use questions; `take(n)` hands out that many and quietly refills behind
// the player's back.  Answers arrive already shuffled with the index of the right one, so a game never has to know that
// the API returns the correct answer separately from the wrong ones.
//
//   const store = sharedTrivia();                   // the site-wide cache, filtered to questions that suit the UK
//   const [question] = await store.take();          // { id, question, answers, correct, ... }
//   const five = await store.take(5);
//
// The questions are licensed CC BY-NC 4.0, so the site credits the API in the Games help page.
// Server-side only: it needs `fetch`, and a browser could not keep one shared cache for everybody anyway.
// Depends on: ./cards.js (shuffle), and the global fetch.
import { shuffle } from './cards.js';

// Where the questions come from, and how many a store keeps ready.
const API = 'https://the-trivia-api.com/v2/questions';
export const CACHE_SIZE = 16;
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
 * @returns {{ take: (count?: number) => Promise<object[]>, prime: () => Promise<void>, ready: number, forget: () => void }}
 * Side effects: none until a method is called; after that it makes HTTPS requests to the API.
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
  } = options;

  // The questions waiting to be handed out, the ids already handed out (so a player never sees one twice), and the fill
  // in flight, if any, so two overlapping takes share one set of requests rather than racing.
  const cache = [];
  const seen = new Set();
  let filling = null;

  /** The URL for one request, carrying whichever filters this store was given. */
  const urlFor = (count) => {
    const query = new URLSearchParams({ limit: String(Math.min(count, MAX_PER_REQUEST)) });
    if (region) query.set('region', region);
    if (categories) query.set('categories', categories);
    if (difficulties) query.set('difficulties', difficulties);
    if (tags) query.set('tags', tags);
    return `${API}?${query}`;
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
   * Tops the cache back up to `size`, asking again when a round brings back only questions already seen.  If every
   * question the filters allow has been seen, the memory of what was handed out is cleared and they come round again,
   * which is what `drawUnused` does for words and spectra elsewhere.
   */
  const fill = async (target) => {
    for (let round = 0; cache.length < target && round < MAX_ROUNDS; round++) {
      const added = await fetchRound(target - cache.length);
      // Nothing new twice running means the filters have been exhausted rather than the API being unlucky.
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
  };
}

// The site-wide store, made on first use so that importing this file never touches the network.
let shared = null;

/**
 * The one cache the whole site shares, so several games draw from the same 16 questions in hand and no two of them ask
 * a player the same question.
 * @returns {ReturnType<typeof createTriviaStore>} the shared store, made on the first call
 * Side effects: makes the store the first time it is called.
 */
export function sharedTrivia() {
  if (!shared) shared = createTriviaStore();
  return shared;
}
