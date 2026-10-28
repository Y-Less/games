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
  const history = db.prepare('SELECT amount, reason, result_id AS resultId, created_at AS createdAt FROM coin_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?');

  return {
    /** The user's current number of coins. */
    balance: (userId) => sum.get(userId).balance,

    /** Their latest ledger rows, newest first. */
    history: (userId, limit = 20) => history.all(userId, limit),

    /** Pays one player for one recorded game (once only: a repeat for the same result is ignored). Returns the coins paid. */
    awardPlacement(userId, resultId, player) {
      const amount = prizeFor(player);
      if (!amount) return 0;
      return Number(insert.run(userId, amount, 'placement', resultId, Date.now()).changes) ? amount : 0;
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
