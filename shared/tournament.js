// What a tournament is, as arithmetic: how big a table is, who meets whom, and how everybody stands at the end.
//
// A tournament is an ordinary lobby with a setting turned on.  Once it starts, the room stops being a table and
// becomes the keeper of a list of them: its people are dealt out into tables of `humans` people and `bots` computer
// players, each table is a real room in the same game, and when every table of a round has finished the next
// combination is dealt out, until every combination of that many people has played once.
//
// Nothing here knows about rooms, sockets, or any particular game: it is given a list of ids and answers with lists
// of ids, so the whole shape of an evening can be tested without opening anything.  shared/tournamentRoom.js is what
// holds it against a room, and shared/roomServer.js is what runs it.
//
// Depends on: nothing.

/**
 * How many people a table holds when a tournament is first switched on.  Two, whatever the game is for: a tournament
 * is people playing each other, so the pair is the shape of it, and the computer players are only the numbers.
 */
export const DEFAULT_HUMANS = 2;
/** How big a table is when the game has not said what a normal one is for it (the same four shared/members.js assumes). */
export const DEFAULT_TABLE = 4;
/** The most people one tournament may hold.  Chosen with MAX_TABLES: sixteen in pairs is exactly a hundred and twenty tables. */
export const MAX_ENTRANTS = 16;
/** The most tables a tournament may play in all.  Every combination of a large table is a very great many games. */
export const MAX_TABLES = 120;

/**
 * How many places a tournament table has: the people and the computer players that make the numbers up.
 * @param {{ humans: number, bots: number }} tournament  the setting
 * @returns {number}
 * Side effects: none.
 */
export const tableSize = (tournament) => tournament.humans + tournament.bots;

/**
 * The table a game would start a tournament with: two people, and enough computer players to make the table up to a
 * normal one *of that game* — which is four at Hearts and two at Cribbage, since a normal game of Cribbage is two.
 * That is the game's own "fill up with computer players" number, not a figure chosen here, so a tournament's first
 * offer is always a table the game would have dealt anyway.
 *
 * The two people are two whatever the game says: a game that can be played by one is still a tournament of pairs, and
 * one whose normal table is two is simply two people and no computer player at all.  Only a game that cannot seat two
 * gets fewer.
 *
 * @param {{ min: number, max: number, fillTo?: number }} limits  the game's own table: the fewest it can be played
 *   with, the most it allows, and how many a normal one is for
 * @returns {{ on: boolean, humans: number, bots: number }} the setting, switched off
 * Side effects: none.
 */
export function defaultTable(limits) {
  const usual = Math.min(Math.max(limits.fillTo ?? DEFAULT_TABLE, limits.min), limits.max);
  const humans = Math.max(1, Math.min(DEFAULT_HUMANS, limits.max));
  return { on: false, humans, bots: Math.max(0, usual - humans) };
}

/**
 * Checks a table the host has asked for.
 *
 * A table must hold at least one person (a tournament of computer players is nobody's evening), no more people than
 * a tournament may hold at all, and altogether as many players as the game it is a tournament of allows.
 *
 * @param {{ humans: number, bots: number }} table  what was asked for
 * @param {{ min: number, max: number }} limits  the game's own minPlayers and maxPlayers
 * @returns {{ ok: true } | { ok: false, error: string, params?: object }} the refusal a client would be sent
 * Side effects: none.
 */
export function checkTable(table, limits) {
  const whole = (n) => Number.isInteger(n) && n >= 0;
  if (!whole(table.humans) || !whole(table.bots)) return { ok: false, error: 'tournamentTable' };
  if (table.humans < 1 || table.humans > MAX_ENTRANTS) return { ok: false, error: 'tournamentPeople', params: { max: MAX_ENTRANTS } };
  const size = tableSize(table);
  if (size < limits.min || size > limits.max) return { ok: false, error: 'tournamentSize', params: { min: limits.min, max: limits.max } };
  return { ok: true };
}

/**
 * Every way of choosing `k` of a list, in the order the list is in ("abc" by twos: ab, ac, bc).
 * @param {Array<*>} list  what to choose from
 * @param {number} k  how many to choose
 * @returns {Array<Array<*>>} each choice, each in the list's own order
 * Side effects: none.
 */
export function combinations(list, k) {
  if (k <= 0 || k > list.length) return k === 0 ? [[]] : [];
  if (k === list.length) return [[...list]];
  const [first, ...rest] = list;
  return [...combinations(rest, k - 1).map((choice) => [first, ...choice]), ...combinations(rest, k)];
}

/**
 * The rounds of a tournament played in pairs, by the method a chess club would use: everybody is sat in a ring, one
 * of them stays put and the rest rotate, and each round pairs the ring across itself.  Every pair meets exactly once.
 *
 * With an even number nobody ever sits out, and there are one fewer rounds than there are people.  With an odd number
 * a ghost is added to the ring, and whoever is paired with it that round is the one who sits out — so exactly one
 * person sits out of each round, and a different one each time.  That is why this is not simply "deal them into
 * pairs and shuffle": greedy pairing runs out of partners.  Six people paired 1-2, 3-4, 5-6 and then 1-3, 2-4 leaves
 * five and six, who have already met.
 *
 * @param {Array<number|string>} people  the ids, in any order
 * @returns {Array<Array<Array<number|string>>>} the rounds, each a list of pairs
 * Side effects: none.
 */
function pairRounds(people) {
  // The ghost is a place in the ring that nobody holds: whoever faces it sits the round out.
  const ring = people.length % 2 ? [...people, null] : [...people];
  const rounds = [];
  for (let round = 0; round < ring.length - 1; round++) {
    const tables = [];
    for (let i = 0; i < ring.length / 2; i++) {
      const [one, other] = [ring[i], ring[ring.length - 1 - i]];
      if (one !== null && other !== null) tables.push([one, other]);
    }
    rounds.push(tables);
    ring.splice(1, 0, /** @type {number|string} */ (ring.pop())); // everybody but the first moves round one place
  }
  return rounds;
}

/** How long the people of a table have been kept waiting between them, which is what gives a table its turn. */
const waited = (table, missed) => table.reduce((total, id) => total + (missed.get(id) ?? 0), 0);

/**
 * The rounds of a tournament played in threes or more: every combination, packed into rounds of tables that share
 * nobody.  There is no chess-club method for this, so each round takes whichever tables fit, and never plays a
 * combination twice.
 *
 * Which ones fit is decided by who has been sitting out.  Taking them in plain combination order is simpler, and it
 * is what this did first, but it is unkind: the combinations are lexicographic, so the people who come first in the
 * list run out of partners while the rest still have plenty, and then sit out round after round at the end — with
 * nine people in threes, somebody sat out seventeen rounds running.  Giving the round to the tables whose people
 * have waited longest spends everybody's combinations at about the same rate instead: the same nine people now sit
 * out two rounds running at the very worst, and the evening is seven rounds shorter into the bargain.
 *
 * Everybody plays the same number of games either way — each person is in the same number of combinations — so this
 * is about when they play, not how often.  The sort is stable, so tables whose people have waited equally keep the
 * order the combinations came in, and the same people always draw the same evening.
 *
 * @param {Array<number|string>} people  the ids
 * @param {number} perTable  how many people are at a table
 * @returns {Array<Array<Array<number|string>>>} the rounds, each a list of tables
 * Side effects: none.
 */
function packedRounds(people, perTable) {
  let left = combinations(people, perTable);
  const missed = new Map(people.map((id) => [id, 0]));
  const rounds = [];
  while (left.length) {
    const busy = new Set();
    const taken = new Set();
    for (const table of [...left].sort((one, other) => waited(other, missed) - waited(one, missed))) {
      if (table.some((id) => busy.has(id))) continue;
      for (const id of table) busy.add(id);
      taken.add(table);
    }
    for (const id of people) if (!busy.has(id)) missed.set(id, (missed.get(id) ?? 0) + 1);
    // The round itself is kept in combination order, so that a round reads the way the list of them does.
    rounds.push(left.filter((table) => taken.has(table)));
    left = left.filter((table) => !taken.has(table));
  }
  return rounds;
}

/**
 * The whole evening, worked out before a single table is opened: every combination of `perTable` of these people,
 * dealt into rounds of tables that can be played at the same time because they share nobody.
 *
 * Fewer people than a table holds is one table of all of them (the computer players make the numbers up), rather than
 * nothing at all.
 *
 * @param {Array<number|string>} people  the ids of everybody taking part
 * @param {number} perTable  how many people are at a table
 * @returns {Array<Array<Array<number|string>>>} the rounds, each a list of tables, each a list of ids
 * Side effects: none.
 */
export function schedule(people, perTable) {
  if (!people.length || perTable < 1) return [];
  if (perTable === 1) return [people.map((id) => [id])];
  if (people.length <= perTable) return [[[...people]]];
  return perTable === 2 ? pairRounds(people) : packedRounds(people, perTable);
}

/**
 * How many tables a tournament of this many people would play in all, for a lobby that says so before anybody starts
 * it, and for the refusal when it is a great many.
 * @param {number} entrants  how many people are in the lobby
 * @param {number} perTable  how many people are at a table
 * @returns {number}
 * Side effects: none.
 */
export function tableCount(entrants, perTable) {
  if (entrants <= perTable) return entrants ? 1 : 0;
  if (perTable === 1) return entrants;
  // The number of combinations, which is what the schedule holds however it is packed into rounds.
  let total = 1;
  for (let i = 0; i < perTable; i++) total = (total * (entrants - i)) / (i + 1);
  return Math.round(total);
}

/**
 * Takes in a finished table's result.  The rows are the game's own `statsPlayers`, which every room-based game
 * already answers for the statistics: one row per person, with where they came and whether they won.  A computer
 * player has no row, which is right — the tournament is between the people.
 *
 * @param {object} standings  the running totals, keyed by account id (changed in place)
 * @param {Array<{ userId: number, outcome?: string, placement?: number, score?: number }>} rows  the finished table's
 * @returns {object} the same standings
 * Side effects: changes `standings`.
 */
export function recordTable(standings, rows) {
  for (const row of rows ?? []) {
    const player = (standings[row.userId] ??= { played: 0, wins: 0, places: 0, score: 0 });
    player.played += 1;
    if (row.outcome === 'win') player.wins += 1;
    player.places += Number.isFinite(row.placement) ? row.placement : 0;
    player.score += Number.isFinite(row.score) ? row.score : 0;
  }
  return standings;
}

/**
 * The standings in the order they are read out: most tables won first, then whoever came higher on average, then
 * whoever played more (somebody who sat out more rounds has had fewer chances), and ties are left in the order the
 * people are given in, so the answer never depends on an account id.
 *
 * @param {object} standings  the running totals from `recordTable`
 * @param {Array<{ id: number, name: string }>} people  everybody taking part, in the room's own order
 * @returns {Array<{ id: number, name: string, played: number, wins: number, places: number, score: number, place: number }>}
 *   every person, in order, each with the place they are in (people level on everything share a place)
 * Side effects: none.
 */
export function ranking(standings, people) {
  const rows = people.map((person) => ({
    id: person.id,
    name: person.name,
    played: 0,
    wins: 0,
    places: 0,
    score: 0,
    ...standings[person.id],
    place: 0,
  }));
  // Somebody who has played nothing yet has no average, and is put last rather than first.
  const average = (row) => (row.played ? row.places / row.played : Number.MAX_SAFE_INTEGER);
  const order = [...rows].sort((a, b) => b.wins - a.wins || average(a) - average(b) || b.played - a.played);
  let place = 0;
  let previous = null;
  for (const [index, row] of order.entries()) {
    const level = previous && previous.wins === row.wins && average(previous) === average(row) && previous.played === row.played;
    place = level ? place : index + 1;
    row.place = place;
    previous = row;
  }
  return order;
}
