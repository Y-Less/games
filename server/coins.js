// Coins: the site's own currency.  They are earned by finishing a game in the top three and spent in the shop; they can
// never be bought or given between players.  Every change is a row in coin_ledger, and the balance is the sum of a
// user's rows, so there is always a record of where each coin came from.
// Depends on: the coin_ledger, result_players, results, and users tables (see db.js).

/** Coins for a finished game, by placement (1 = best).  Tied players share a placement, so they share its prize. */
const PLACEMENT_PRIZES = { 1: 100, 2: 50, 3: 20 };

/**
 * What a recorded player earns: by placement, or as 1st when the game reports a win without a placement.
 * @param {{ placement?: number | null, outcome?: string }} player  the recorded result for one player
 * @returns {number} the coins due (0 outside the top three)
 * Side effects: none.
 */
export function prizeFor({ placement, outcome }) {
  const place = Number.isInteger(placement) ? placement : outcome === 'win' ? 1 : null;
  return PLACEMENT_PRIZES[place] ?? 0;
}

/**
 * The coin operations on a database.  None of them opens a transaction, so callers may group them with other writes.
 * @param {import('node:sqlite').DatabaseSync} db  the site database
 * @returns {object} balance, spent, history, awardPlacement, creditPastResults, award, and spend (documented below)
 * Side effects: prepares statements; the returned operations write rows to coin_ledger (balance, spent, and history only read).
 */
export function createCoins(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO coin_ledger (user_id, amount, reason, result_id, created_at) VALUES (?, ?, ?, ?, ?)');
  const sum = db.prepare('SELECT COALESCE(SUM(amount), 0) AS balance FROM coin_ledger WHERE user_id = ?');
  const spentSum = db.prepare('SELECT COALESCE(-SUM(amount), 0) AS spent FROM coin_ledger WHERE user_id = ? AND amount < 0');
  const history = db.prepare('SELECT amount, reason, result_id AS resultId, created_at AS createdAt FROM coin_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?');

  return {
    /**
     * The user's current number of coins (the sum of their ledger).
     * @param {number} userId  the user
     * @returns {number} the balance
     * Side effects: none.
     */
    balance: (userId) => sum.get(userId).balance,

    /**
     * The total number of coins the user has ever spent.
     * @param {number} userId  the user
     * @returns {number} the sum of their negative ledger rows, as a positive number
     * Side effects: none.
     */
    spent: (userId) => spentSum.get(userId).spent,

    /**
     * Their latest ledger rows, newest first.
     * @param {number} userId  the user
     * @param {number} [limit]  the most rows to return (20 by default)
     * @returns {Array<{ amount: number, reason: string, resultId: number | null, createdAt: number }>} the rows
     * Side effects: none.
     */
    history: (userId, limit = 20) => history.all(userId, limit),

    /**
     * Pays one player for one recorded game (once only: a repeat for the same result is ignored).
     * @param {number} userId  the player
     * @param {number} resultId  the recorded game
     * @param {{ placement?: number | null, outcome?: string }} player  their result, which decides the prize
     * @returns {number} the coins paid (0 if none are due or it was paid already)
     * Side effects: may insert a coin_ledger row.
     */
    awardPlacement(userId, resultId, player) {
      const amount = prizeFor(player);
      if (!amount) return 0;
      return Number(insert.run(userId, amount, 'placement', resultId, Date.now()).changes) ? amount : 0;
    },

    /**
     * The start-up step for a site that had games before coins: pays every person (not computer accounts) for the games
     * already recorded that they were not paid for, dated when each game finished.  Safe to run on every start: a game that
     * has paid is skipped, so it only ever adds what is missing.
     * @returns {{ games: number, coins: number }} how many payments were made and their total
     * Side effects: inserts coin_ledger rows.
     */
    creditPastResults() {
      const unpaid = db
        .prepare(
          `SELECT rp.result_id AS resultId, rp.user_id AS userId, rp.placement AS placement, rp.outcome AS outcome, r.finished_at AS finishedAt
           FROM result_players rp
           JOIN results r ON r.id = rp.result_id
           JOIN users u ON u.id = rp.user_id
           WHERE u.is_bot = 0
             AND NOT EXISTS (SELECT 1 FROM coin_ledger l WHERE l.user_id = rp.user_id AND l.result_id = rp.result_id AND l.reason = 'placement')
           ORDER BY r.finished_at, rp.result_id`,
        )
        .all();
      const paid = { games: 0, coins: 0 };
      for (const row of unpaid) {
        const amount = prizeFor(row);
        if (amount && Number(insert.run(row.userId, amount, 'placement', row.resultId, row.finishedAt).changes)) {
          paid.games++;
          paid.coins += amount;
        }
      }
      return paid;
    },

    /**
     * Pays coins for something that happens once (the reason is unique per user, so a repeat is ignored).
     * @param {number} userId  the user
     * @param {number} amount  a positive whole number of coins
     * @param {string} reason  what it was for; the once-only key
     * @returns {number} the coins paid (0 if the amount is invalid or the reason was paid before)
     * Side effects: may insert a coin_ledger row.
     */
    award(userId, amount, reason) {
      if (!Number.isInteger(amount) || amount <= 0) return 0;
      return Number(insert.run(userId, amount, reason, null, Date.now()).changes) ? amount : 0;
    },

    /**
     * Takes coins for a purchase.  Throws when the balance would go below zero.
     * @param {number} userId  the buyer
     * @param {number} amount  the price, a whole number (0 does nothing)
     * @param {string} reason  what it was for, recorded in the ledger
     * @returns {void}
     * Side effects: inserts a negative coin_ledger row.
     */
    spend(userId, amount, reason) {
      if (!Number.isInteger(amount) || amount < 0) throw new Error('A price must be a whole number of gold.');
      if (amount === 0) return;
      if (sum.get(userId).balance < amount) throw new Error('Not enough gold.');
      insert.run(userId, -amount, reason, null, Date.now());
    },
  };
}
