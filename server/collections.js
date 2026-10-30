// Collections: for each player and id, which numbered things (cards, say) they have had so far, kept as a bit for every
// number: number n is bit n of the blob. A collection of a few thousand numbers is a few hundred bytes to a few kilobytes
// per player, and a number that has been seen already is answered from memory without touching the database.

const MAX_ITEM = 1_000_000; // a number bigger than this is not a thing in any collection, and would make a huge blob

const bitCount = (byte) => {
  let count = 0;
  for (let rest = byte; rest; rest >>= 1) count += rest & 1;
  return count;
};

/** @param {import('node:sqlite').DatabaseSync} db */
export function createCollections(db) {
  const read = db.prepare('SELECT bits FROM achievement_sets WHERE user_id = ? AND id = ?');
  const write = db.prepare(
    `INSERT INTO achievement_sets (user_id, id, bits) VALUES (?, ?, ?)
     ON CONFLICT (user_id, id) DO UPDATE SET bits = excluded.bits`,
  );
  const loaded = new Map(); // "userId:id" -> { bits: Uint8Array, count }

  function load(userId, id) {
    const key = `${userId}:${id}`;
    let set = loaded.get(key);
    if (!set) {
      const bits = Uint8Array.from(read.get(userId, id)?.bits ?? []);
      set = { bits, count: bits.reduce((sum, byte) => sum + bitCount(byte), 0) };
      loaded.set(key, set);
    }
    return set;
  }

  /** Adds numbers to a player's collection. Returns how many different numbers it now holds. */
  function add(userId, id, items) {
    const set = load(userId, id);
    let changed = false;
    for (const item of items) {
      if (!Number.isInteger(item) || item < 0 || item > MAX_ITEM) continue;
      const byte = item >> 3;
      const bit = 1 << (item & 7);
      if (set.bits[byte] !== undefined && set.bits[byte] & bit) continue;
      if (byte >= set.bits.length) {
        const grown = new Uint8Array(byte + 1);
        grown.set(set.bits);
        set.bits = grown;
      }
      set.bits[byte] |= bit;
      set.count++;
      changed = true;
    }
    if (changed) write.run(userId, id, set.bits);
    return set.count;
  }

  /** How many different numbers a player's collection holds. */
  const count = (userId, id) => load(userId, id).count;

  return { add, count };
}
