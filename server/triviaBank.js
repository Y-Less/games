// The site's own trivia questions, in the database beside everything else.  shared/trivia.js draws on this and on The
// Trivia API together, in proportion to how many questions each of them has, so a site that has put a few hundred
// questions of its own in asks them about that often.
//
// A question is kept the way the API sends one - the right answer and the wrong ones, separately - so that a question
// from here and a question from there become the same thing once shared/trivia.js has shuffled the answers.  Nothing
// here shuffles or picks: that is the store's business, and this file only knows SQL.
// Depends on: node:sqlite's prepared statements through the database it is given, and ./db.js for the table.

/** How many rows a draw looks at to find the ones nobody has seen yet (the store asks again if it comes up short). */
const DRAW_SPREAD = 3;

/**
 * Splits one of the store's comma-separated filters into a list.
 * @param {string | string[] | undefined} value  'history,music', ['history'], or nothing
 * @returns {string[]} the parts, trimmed, without the empty ones
 * Side effects: none.
 */
const listOf = (value) => (Array.isArray(value) ? value : String(value ?? '').split(',')).map((part) => String(part).trim()).filter(Boolean);

/**
 * The WHERE clause and its values for a set of filters.  A filter nobody gave is left out rather than matching
 * nothing: an empty filter means "any".
 *
 * Regions work as the API's do: a question with no regions suits everywhere, and one with regions suits only those.
 * Tags match if the question carries any of them.
 *
 * @param {{ categories?: string, difficulties?: string, tags?: string, region?: string }} [filters]
 * @returns {{ sql: string, values: Array<string> }} the clause (beginning with WHERE, or empty) and its bound values
 * Side effects: none.
 */
export function where(filters = {}) {
  const parts = [];
  const values = [];
  const anyOf = (column, list) => {
    if (!list.length) return;
    parts.push(`${column} IN (${list.map(() => '?').join(', ')})`);
    values.push(...list);
  };
  anyOf('category', listOf(filters.categories));
  anyOf('difficulty', listOf(filters.difficulties));
  const tags = listOf(filters.tags);
  if (tags.length) {
    parts.push(`EXISTS (SELECT 1 FROM json_each(trivia_questions.tags) WHERE value IN (${tags.map(() => '?').join(', ')}))`);
    values.push(...tags);
  }
  const region = String(filters.region ?? '').trim();
  if (region) {
    parts.push('(json_array_length(regions) = 0 OR EXISTS (SELECT 1 FROM json_each(trivia_questions.regions) WHERE value = ?))');
    values.push(region);
  }
  return { sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', values };
}

/**
 * The questions the site holds itself.
 *
 * @param {import('node:sqlite').DatabaseSync} db  the site's database
 * @param {object} [options]
 * @param {() => number} [options.now]  the clock, for when a question was added
 * @returns {{ count: Function, draw: Function, add: Function }} the question bank shared/trivia.js understands
 * Side effects: none until a method is called; `add` then writes rows.
 */
export function createQuestionBank(db, { now = Date.now } = {}) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO trivia_questions (id, question, correct, wrong, category, difficulty, tags, regions, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  /**
   * A row as The Trivia API would have sent it, so that one `prepare` in shared/trivia.js serves both sources.
   * @param {object} row  a row of trivia_questions
   * @returns {object} the question in the API's shape
   * Side effects: none.
   */
  const asApi = (row) => ({
    id: row.id,
    question: { text: row.question },
    correctAnswer: row.correct,
    incorrectAnswers: JSON.parse(row.wrong),
    category: row.category,
    difficulty: row.difficulty,
    tags: JSON.parse(row.tags),
    regions: JSON.parse(row.regions),
  });

  return {
    /**
     * How many questions the site holds that these filters allow.
     * @param {object} [filters]  as the store's options: categories, difficulties, tags, region
     * @returns {number}
     * Side effects: none.
     */
    count(filters) {
      const { sql, values } = where(filters);
      return db.prepare(`SELECT COUNT(*) AS n FROM trivia_questions${sql}`).get(...values).n;
    },

    /**
     * Some questions at random, in the API's shape.  It brings back more than asked for, because the store throws away
     * the ones that player has already seen; asking for none brings back none.
     * @param {number} count  how many the store wants
     * @param {object} [filters]  as `count`
     * @returns {object[]} questions, fewest-recently-added first within the random order the database gave them
     * Side effects: none.
     */
    draw(count, filters) {
      if (!Number.isInteger(count) || count < 1) return [];
      const { sql, values } = where(filters);
      const rows = db.prepare(`SELECT * FROM trivia_questions${sql} ORDER BY RANDOM() LIMIT ?`).all(...values, count * DRAW_SPREAD);
      return rows.map(asApi);
    },

    /**
     * Puts questions in, ignoring any whose id is there already.
     * @param {Array<{ id?: string, question: string, correct: string, wrong: string[], category?: string,
     *   difficulty?: string, tags?: string[], regions?: string[] }>} questions  what to add
     * @returns {number} how many were added (a question already held is not one)
     * Side effects: writes rows.
     */
    add(questions) {
      let added = 0;
      for (const q of Array.isArray(questions) ? questions : []) {
        const text = typeof q?.question === 'string' ? q.question.trim() : '';
        const correct = typeof q?.correct === 'string' ? q.correct.trim() : '';
        const wrong = (Array.isArray(q?.wrong) ? q.wrong : []).map((answer) => String(answer).trim()).filter(Boolean);
        if (!text || !correct || !wrong.length) continue;
        const id = String(q.id ?? text);
        const result = insert.run(
          id,
          text,
          correct,
          JSON.stringify(wrong),
          String(q.category ?? ''),
          String(q.difficulty ?? ''),
          JSON.stringify(Array.isArray(q.tags) ? q.tags.map(String) : []),
          JSON.stringify(Array.isArray(q.regions) ? q.regions.map(String) : []),
          now(),
        );
        added += Number(result.changes) > 0 ? 1 : 0;
      }
      return added;
    },
  };
}
