// Coins: the site's own currency. They are earned by finishing a game in the top three and spent in the shop; they can
// never be bought or given between players. Every change is a row in coin_ledger, and the balance is the sum of a
// user's rows, so there is always a record of where each coin came from.

/** Coins for a finished game, by placement (1 = best). Tied players share a placement, so they share its prize. */
export const PLACEMENT_PRIZES = { 1: 500, 2: 200, 3: 100 };

/** What a recorded player earns: by placement, or as 1st when the game reports a win without a placement. */
export function prizeFor({ placement, outcome }) {
  const place = Number.isInteger(placement) ? placement : outcome === 'win' ? 1 : null;
  return PLACEMENT_PRIZES[place] ?? 0;
}

/** The coin operations on a database. None of them opens a transaction, so callers may group them with other writes. */
export function createCoins(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO coin_ledger (user_id, amount, reason, result_id, created_at) VALUES (?, ?, ?, ?, ?)');
  const sum = db.prepare('SELECT COALESCE(SUM(amount), 0) AS balance FROM coin_ledger WHERE user_id = ?');
  const spentSum = db.prepare('SELECT COALESCE(-SUM(amount), 0) AS spent FROM coin_ledger WHERE user_id = ? AND amount < 0');
  const history = db.prepare('SELECT amount, reason, result_id AS resultId, created_at AS createdAt FROM coin_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?');

  return {
    /** The user's current number of coins. */
    balance: (userId) => sum.get(userId).balance,

    /** The total number of coins the user has ever spent. */
    spent: (userId) => spentSum.get(userId).spent,

    /** Their latest ledger rows, newest first. */
    history: (userId, limit = 20) => history.all(userId, limit),

    /** Pays one player for one recorded game (once only: a repeat for the same result is ignored). Returns the coins paid. */
    awardPlacement(userId, resultId, player) {
      const amount = prizeFor(player);
      if (!amount) return 0;
      return Number(insert.run(userId, amount, 'placement', resultId, Date.now()).changes) ? amount : 0;
    },

    /**
     * The start-up step for a site that had games before coins: pays every person (not computer accounts) for the games
     * already recorded that they were not paid for, dated when each game finished. Safe to run on every start: a game that
     * has paid is skipped, so it only ever adds what is missing. Returns { games, coins }.
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

    /** Pays coins for something that happens once (the reason is unique per user, so a repeat is ignored). Returns the coins paid. */
    award(userId, amount, reason) {
      if (!Number.isInteger(amount) || amount <= 0) return 0;
      return Number(insert.run(userId, amount, reason, null, Date.now()).changes) ? amount : 0;
    },

    /** Takes coins for a purchase. Throws when the balance would go below zero. */
    spend(userId, amount, reason) {
      if (!Number.isInteger(amount) || amount < 0) throw new Error('A price must be a whole number of coins.');
      if (amount === 0) return;
      if (sum.get(userId).balance < amount) throw new Error('Not enough coins.');
      insert.run(userId, -amount, reason, null, Date.now());
    },
  };
}
