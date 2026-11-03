// Trivia questions, kept in a small cache so a game never waits for the network mid-round.  `take(n)` hands out that
// many and quietly refills behind the player's back.  Answers arrive already shuffled with the index of the right one,
// so a game never has to know that a question is stored as the right answer and the wrong ones.
//
//   const store = sharedTrivia();                   // the site-wide cache, filtered to questions that suit the UK
//   const [question] = await store.take();          // { id, question, answers, correct, ... }
//   const five = await store.take(5);
//   const [art] = await store.take(1, { category: 'arts' });
//
// **A cacheful a category.**  A store holds 16 ready questions of each of the API's ten categories rather than 16 of
// no particular kind, so that a game asking for a history question has one in hand instead of hoping the cache holds
// one.  Naming a category this store does not hold is a mistake rather than an empty answer, and the names are the
// API's own, aliases and all: `movies`, `film`, and `film_and_tv` all mean Film & TV.
//
// **Weighed, not evened out.**  A take that names no category draws one for each question it hands out, weighed by how
// many questions there are of each: the API has six times as many about film and television as about general
// knowledge, and a game that takes what it is given sees them in about that proportion rather than one in ten of each.
// The bank's questions are weighed in too, so a site that has put a thousand history questions of its own in is asked
// about history more often than the API alone would be.  That costs one count request a category, because the API has
// no endpoint that breaks its total down, and those counts are then kept for a day: once they are stale the next fill
// asks again without waiting for the answer, so a site that runs for weeks keeps up with both sources without any
// game ever stopping to count.
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
// How long the counts the categories are weighed by are taken as still true.  Questions are added to the API, and to
// the site's own bank, far too slowly for this to want to be shorter, and a site that is up for weeks should not be
// weighing today's questions by the shape the sources had when it started.
export const COUNT_GOOD_FOR = 24 * 60 * 60 * 1000;

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
 * A cache of ready-to-use questions, one cacheful a category.  Nothing is fetched until the first `take` or `prime`.
 *
 * A store keeps `size` questions of each of the API's ten categories rather than `size` questions of no particular
 * kind, so that a game asking for a history question has one in hand instead of hoping the cache holds one.  A `take`
 * that names no category draws one at random for each question it hands out, which from the game's point of view is
 * what the one undivided cache used to do.
 *
 * @param {object} [options]
 * @param {number} [options.size]  how many questions to keep ready of each category (default 16)
 * @param {string} [options.region]  ISO country code; GB also lets in questions that only make sense in the UK
 * @param {string} [options.categories]  comma-separated API categories, e.g. 'history,music'; the store then holds
 *   only those, and a take of any other is a mistake
 * @param {string} [options.difficulties]  comma-separated, from easy, medium, and hard
 * @param {string} [options.tags]  comma-separated API tags, e.g. 'geology'
 * @param {() => number} [options.rng]  random source; pass a seeded one in tests
 * @param {() => number} [options.now]  the clock, which only says when the counts were last taken
 * @param {typeof fetch} [options.fetchImpl]  the fetch to use; pass a fake one in tests
 * @param {{ count: Function, draw: Function } | null} [options.bank]  the site's own questions (server/triviaBank.js);
 *   without one every question comes from the API
 * @returns {{ take: Function, prime: Function, ready: number, held: () => object, categories: string[],
 *   forget: () => void, sources: () => Promise<{ api: number, bank: number }> }}
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
    now = Date.now,
    fetchImpl = (...args) => fetch(...args),
    bank = null,
  } = options;

  // The categories this store draws on: the API's ten, or only the ones it was narrowed to.
  const only = canonicalCategories(categories);
  const kinds = only ? only.split(',') : Object.keys(CATEGORIES);

  // A cacheful of questions waiting to be handed out for each of them, the ids already handed out (across all of them,
  // so that a player never sees one twice), and the fill in flight for each, so that two overlapping takes of one
  // category share a set of requests rather than racing.
  const cache = new Map(kinds.map((kind) => [kind, []]));
  const seen = new Set();
  const filling = new Map();

  /** What this store was narrowed to overall, which is what the counts are of. */
  const filters = { region, categories: only, difficulties, tags };
  /** The same for one category: what a request or a draw actually asks for. */
  const filtersFor = (kind) => ({ region, categories: kind, difficulties, tags });

  /**
   * A set of filters as query parameters, which is how the API takes them.
   * @param {object} [these]  the filters (this store's own by default)
   * @returns {URLSearchParams} the parameters, without the ones nobody set
   */
  const query = (these = filters) => {
    const parameters = new URLSearchParams();
    for (const [name, value] of Object.entries(these)) if (value) parameters.set(name, value);
    return parameters;
  };

  /** The URL for one request for questions of one category. */
  const urlFor = (kind, count) => {
    const parameters = query(filtersFor(kind));
    parameters.set('limit', String(Math.min(count, MAX_PER_REQUEST)));
    return `${API}?${parameters}`;
  };

  // How many questions each source has, when that was worked out, and the counting in flight if any: see the head of
  // this file.  `null` until the first time anything needs them.
  let counts = null;
  let countedAt = 0;
  let counting = null;

  /**
   * Asks both sources how many questions they have of each category.  That is one small request a category at the API
   * (there is no endpoint that breaks the total down) and one cheap query a category at the bank, and it buys two
   * things: how often each category is handed out, and how often each source is asked within it.  A bank strong in
   * history and empty of music is therefore dealt with category by category rather than by one ratio across the lot.
   *
   * A source that will not say keeps whatever it last said, or counts as having none of that category if it has never
   * said: so a count taken while the API is down does not throw away yesterday's good numbers, a site with questions
   * of its own carries on asking them meanwhile, and a store that has never managed to count anything falls back to
   * choosing a category at random (see anyKind).
   *
   * @param {Map<string, { api: number, bank: number }> | null} [before]  what was last counted, if anything
   * @returns {Promise<Map<string, { api: number, bank: number }>>} how many of each, by category
   * Side effects: reads the bank, and makes one request a category to the API.  Never rejects.
   */
  const countSources = async (before = null) => {
    const held = new Map();
    await Promise.all(
      kinds.map(async (kind) => {
        const these = filtersFor(kind);
        const was = before?.get(kind);
        let mine;
        try {
          const found = bank?.count(these);
          mine = Number.isFinite(found) && found > 0 ? found : 0;
        } catch {
          mine = was?.bank ?? 0; // a bank that will not answer is a bank that has not changed
        }
        let theirs;
        try {
          const reply = await fetchImpl(`${API_COUNT}?${query(these)}`, { headers: { accept: 'application/json' } });
          if (!reply?.ok) throw new Error(`the API answered ${reply?.status ?? '(no response)'}`);
          const body = await reply.json();
          theirs = Number.isFinite(body?.count) && body.count > 0 ? body.count : 0;
        } catch {
          theirs = was?.api ?? 0; // likewise an API that will not say
        }
        held.set(kind, { api: theirs, bank: mine });
      }),
    );
    return held;
  };

  /**
   * The counts, worked out once however many callers want them at the same moment, and then kept for a day.
   *
   * Once they are a day old the next fill asks again, but it does not wait for the answer: the counts in hand are
   * handed back at once and brought up to date behind the caller, because they are a shape to weigh questions by
   * rather than anything a question depends on, and a fill that waited on ten count requests would be a fill that
   * stuttered once a day.  Only a store that has never counted anything has to wait.
   *
   * @returns {Promise<Map<string, { api: number, bank: number }>>} the counts, by category
   * Side effects: may start a count (see countSources); keeps the result and when it was taken.
   */
  const counted = () => {
    const stale = !counts || now() - countedAt >= COUNT_GOOD_FOR;
    if (stale && !counting) {
      const before = counts;
      counting = countSources(before)
        .then((found) => {
          counts = found;
          countedAt = now();
          return found;
        })
        .finally(() => {
          counting = null;
        });
    }
    return counts ? Promise.resolve(counts) : counting;
  };

  /** How many questions there are of one category, both sources together; 0 before anything has been counted. */
  const weightOf = (kind) => {
    const held = counts?.get(kind);
    return held ? held.api + held.bank : 0;
  };

  /**
   * A category to hand the next question out of, weighted by how many questions there are of each: the API has six
   * times as many film and television questions as general knowledge ones, so a game that asks for a question and
   * takes what it is given should see them in about that proportion rather than one in ten of each.  The bank's
   * questions count towards the weighing too, so a site that has put a thousand history questions in is asked about
   * history more often.
   *
   * Nothing counted (or nothing to count) falls back to an even chance, which is what the store did before it knew.
   *
   * @returns {string} one of this store's categories
   * Side effects: advances `rng` once.
   */
  const anyKind = () => {
    let total = 0;
    for (const kind of kinds) total += weightOf(kind);
    if (total <= 0) return kinds[Math.min(kinds.length - 1, Math.floor(rng() * kinds.length))];
    let at = rng() * total;
    for (const kind of kinds) {
      at -= weightOf(kind);
      if (at < 0) return kind;
    }
    return kinds[kinds.length - 1];
  };

  /**
   * How many of the next `want` questions of a category should come from the bank: a choice made for each question on
   * its own, at the ratio of that category's two counts, which is what makes a bank holding a tenth as many history
   * questions as the API answer about a tenth of the history asked for.
   * @param {number} want  how many questions are wanted
   * @param {{ api: number, bank: number }} held  how many each source has of this category
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
   * Takes questions of one category from the bank, keeping the ones nobody has seen.
   * @param {string} kind  the category
   * @param {number} count  how many are wanted
   * @returns {number} how many fresh questions were added to that cache
   * Side effects: appends to that category's cache and to `seen`.
   */
  const drawFromBank = (kind, count) => {
    if (!bank || count < 1) return 0;
    let added = 0;
    let raws = [];
    try {
      raws = bank.draw(count, filtersFor(kind)) ?? [];
    } catch {
      return 0; // a bank that will not answer is simply a bank with nothing in it
    }
    for (const raw of raws) {
      if (added >= count) break;
      const question = prepare(raw, rng);
      if (!question || seen.has(question.id)) continue;
      seen.add(question.id);
      cache.get(kind).push(question);
      added++;
    }
    return added;
  };

  /**
   * One request, appending every usable, unseen question of that category to its cache.
   * @param {string} kind  the category
   * @param {number} count  how many to ask for
   * @returns {Promise<number>} how many fresh questions were added
   */
  const fetchRound = async (kind, count) => {
    let reply;
    try {
      reply = await fetchImpl(urlFor(kind, count), { headers: { accept: 'application/json' } });
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
      cache.get(kind).push(question);
      added++;
    }
    return added;
  };

  /**
   * Tops one category's cache back up to `target`, asking again when a round brings back only questions already seen.
   * If every question the filters allow has been seen, the memory of what was handed out is cleared and they come
   * round again, which is what `drawUnused` does for words and spectra elsewhere.
   *
   * Each round chooses a source for every question it needs (see bankShare) and then asks each source for its share in
   * one go, which is the same thing as asking question by question but a single request.  Whatever one source cannot
   * supply is asked of the other before the round is given up on, so an empty bank or a silent API only costs a round.
   */
  const fill = async (kind, target) => {
    const held = (await counted()).get(kind) ?? { api: 0, bank: 0 };
    const mine = cache.get(kind);
    // The API is asked unless the bank is the only source with anything in it: a store with no questions of its own
    // (or whose bank has gone away, which counts as none) has nowhere else to ask.
    let askApi = !held.bank || held.api > 0;
    for (let round = 0; mine.length < target && round < MAX_ROUNDS; round++) {
      const want = target - mine.length;
      const fromBank = bankShare(want, held);
      let added = drawFromBank(kind, fromBank);
      if (askApi && want > added) {
        try {
          added += await fetchRound(kind, want - added);
        } catch (error) {
          // With questions of its own the store carries on without the API for the rest of this fill; without them
          // there is nothing to carry on with, and the caller is told.
          if (!held.bank) throw error;
          askApi = false;
        }
      }
      // Whatever the API could not supply is asked of the bank, if it was not already asked for all of it.
      if (mine.length < target && fromBank < want) added += drawFromBank(kind, target - mine.length);
      // Nothing new twice running means the filters have been exhausted rather than a source being unlucky.
      if (!added && round) seen.clear();
    }
    // A round puts the bank's questions in before the API's, and a take hands out the front of the cache, so without
    // this the first questions out would be the bank's every time however the ratio fell.
    if (mine.length > 1) mine.splice(0, mine.length, ...shuffle(mine, rng));
  };

  /**
   * Runs a fill of one category, sharing one in-flight promise between overlapping callers.
   * @param {string} kind  the category
   * @param {number} [target]  how full that cache should end up; a take of more than `size` asks for more than usual
   * @returns {Promise<void>} the fill, shared
   */
  const fillOnce = (kind, target = size) => {
    if (!filling.has(kind)) {
      filling.set(
        kind,
        fill(kind, target).finally(() => {
          filling.delete(kind);
        }),
      );
    }
    return filling.get(kind);
  };

  /**
   * The category a caller named, as this store knows it.
   * @param {string} category  the name, by any of its aliases
   * @returns {string} the canonical name
   * @throws {TypeError} when this store holds no such category
   */
  const kindAsked = (category) => {
    const kind = canonicalCategory(category);
    if (!cache.has(kind)) throw new TypeError(`trivia: this store holds no "${category}" questions`);
    return kind;
  };

  return {
    /**
     * Hands out questions, fetching only if the caches cannot cover the request.  With no category named, each
     * question is of one drawn at random; with one, every question is of that category.
     *
     * @param {number} [count]  how many to hand out (default 1)
     * @param {object} [options]
     * @param {string} [options.category]  the category to take them from, by any of its names (see canonicalCategory)
     * @returns {Promise<object[]>} always an array, `count` long, each `{ id, question, answers, correct, ... }`
     * @throws a TypeError for a count that is not a positive whole number, or a category this store does not hold; an
     *   Error with `code` 'triviaUnavailable' when the sources cannot supply enough questions
     * Side effects: empties that many questions out of the caches and starts a background refill of each one touched.
     */
    async take(count = 1, { category } = {}) {
      if (!Number.isInteger(count) || count < 1) throw new TypeError(`trivia: take(${count}) wants a positive whole number`);
      const asked = category === undefined || category === null ? null : kindAsked(category);

      // How many to take out of each category: all of them from the one named, or one at a time from a category
      // weighed by how many questions there are of it (see anyKind, which needs the counts to weigh them by).
      const plan = new Map();
      if (asked !== null) plan.set(asked, count);
      else {
        await counted();
        for (let n = 0; n < count; n++) {
          const kind = anyKind();
          plan.set(kind, (plan.get(kind) ?? 0) + 1);
        }
      }

      // Fill whichever of them cannot cover their share.  One category failing is not fatal on its own: its questions
      // may be made up from another, and only a request still short after that has really failed.
      const fills = await Promise.allSettled(
        [...plan].filter(([kind, n]) => cache.get(kind).length < n).map(([kind, n]) => fillOnce(kind, Math.max(size, n))),
      );

      // Settle the plan against what is really in hand, moving any shortfall to the categories with questions spare -
      // but only when none was named, because a take of history is not quietly answered with music.
      let short = 0;
      for (const [kind, n] of plan) {
        const have = cache.get(kind).length;
        if (have < n) {
          short += n - have;
          plan.set(kind, have);
        }
      }
      if (short && asked === null) {
        for (const kind of kinds) {
          if (!short) break;
          const spare = cache.get(kind).length - (plan.get(kind) ?? 0);
          if (spare <= 0) continue;
          const extra = Math.min(spare, short);
          plan.set(kind, (plan.get(kind) ?? 0) + extra);
          short -= extra;
        }
      }
      if (short) {
        // Say why if a source gave a reason; otherwise there simply were not enough questions to be had.
        const failed = fills.find((outcome) => outcome.status === 'rejected');
        if (failed) throw failed.reason;
        throw unavailable(`only ${count - short} of ${count} questions available`);
      }

      const taken = [];
      for (const [kind, n] of plan) taken.push(...cache.get(kind).splice(0, n));
      // Refill for the next request, but do not make this caller wait for it, or fail if it goes wrong: the cache is
      // simply short, and the next `take` will try again.
      for (const kind of plan.keys()) if (cache.get(kind).length < size) fillOnce(kind).catch(() => {});
      return taken;
    },

    /**
     * Fills the caches ahead of time, so that the first `take` of a game is instant whatever it asks for.  That is one
     * request a category, so a store left to itself primes ten of them; naming one primes that one alone.
     *
     * @param {string} [category]  only this category, by any of its names
     * @returns {Promise<void>} resolving when they are full, or rejecting as `take` would
     */
    prime(category) {
      if (category === undefined || category === null) return Promise.all(kinds.map((kind) => fillOnce(kind))).then(() => {});
      return fillOnce(kindAsked(category)).then(() => {});
    },

    /** How many questions are ready to hand out right now, of every category together, without touching the network. */
    get ready() {
      let total = 0;
      for (const questions of cache.values()) total += questions.length;
      return total;
    },

    /**
     * How many are ready of each category, for the logs and the tests.
     * @returns {object} `{ history: 16, music: 4, ... }`
     * Side effects: none.
     */
    held: () => Object.fromEntries([...cache].map(([kind, questions]) => [kind, questions.length])),

    /** The categories this store holds, which are the ones `take` and `prime` accept. */
    get categories() {
      return [...kinds];
    },

    /** Forgets which questions have been handed out, so they may come round again.  Mostly for the tests. */
    forget: () => seen.clear(),

    /**
     * How many questions each source has, as the store last counted them; asking before it ever has is what counts
     * them.  `api` and `bank` are the totals, and `byCategory` is the breakdown the store weighs its categories by.
     *
     * These may be a day old, and may be being brought up to date as you read them: nothing waits for that.
     * @returns {Promise<{ api: number, bank: number, byCategory: object }>}
     * Side effects: the first call asks the bank and the API (see the head of this file).
     */
    async sources() {
      // Whatever is in hand, without waiting: a day-old refresh going on behind a fill (see counted) is not worth
      // holding a caller up for.  Only a store that has never counted anything waits here.
      const held = await counted();
      let api = 0;
      let bankHas = 0;
      for (const of of held.values()) {
        api += of.api;
        bankHas += of.bank;
      }
      return { api, bank: bankHas, byCategory: Object.fromEntries(held) };
    },
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
