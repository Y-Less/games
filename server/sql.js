// Prepared statements that are compiled once and kept, without tying that compilation to when a service is built.
// node:sqlite compiles the SQL afresh on every prepare(), so a statement prepared inside a function that runs on every
// request is recompiled on every request; most of the server avoids that by preparing into the factory's closure (see
// coins.js and achievements.js).  That is not always possible: a statement naming a column that a migration adds
// (db.js MIGRATIONS) cannot be prepared before the migration has run, and the site builds its services against a
// database that is about to be migrated.  This prepares on first use instead, which is late enough for the migration
// and still only once.
// Depends on: nothing (the database is passed in).

/**
 * A statement cache for one database.
 *
 * @param {import('node:sqlite').DatabaseSync} db  the database to prepare against
 * @returns {(sql: string) => object} call it with the SQL to get the prepared statement, compiled on the first call
 *   with that exact text and kept for every call after.  Pass the SQL as a constant string (or one built from the
 *   code's own values, never from a client's), so the number of distinct statements stays bounded.
 * Side effects: none until the returned function is called, which then prepares against `db`.
 */
export function statements(db) {
  const cache = new Map();
  return (sql) => {
    let statement = cache.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      cache.set(sql, statement);
    }
    return statement;
  };
}
