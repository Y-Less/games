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

/** How many people a table holds when a tournament is first switched on, before the game's own limits are applied. */
export const DEFAULT_HUMANS = 2;
/** How many computer players a table holds, likewise. */
export const DEFAULT_BOTS = 2;
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
 * The table a game would start a tournament with: two people and two computer players, brought inside the game's own
 * limits.  A game for two (Cribbage) ends up with two people and none; a game that needs five has its computer
 * players made up to five.
 *
 * @param {{ min: number, max: number }} limits  the game's own minPlayers and maxPlayers
 * @returns {{ on: boolean, humans: number, bots: number }} the setting, switched off
 * Side effects: none.
 */
export function defaultTable(limits) {
  const humans = Math.max(1, Math.min(DEFAULT_HUMANS, limits.max));
  const bots = Math.max(0, Math.min(DEFAULT_BOTS, limits.max - humans), limits.min - humans);
  return { on: false, humans, bots };
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

/**
 * The rounds of a tournament played in threes or more: every combination, taken in order, and packed into rounds of
 * tables that share nobody.  There is no chess-club method for this, so it is simply the first combination that fits,
 * again and again — which may use a round more than the fewest possible, and never plays a combination twice.
 *
 * @param {Array<number|string>} people  the ids
 * @param {number} perTable  how many people are at a table
 * @returns {Array<Array<Array<number|string>>>} the rounds, each a list of tables
 * Side effects: none.
 */
function packedRounds(people, perTable) {
  const left = combinations(people, perTable);
  const rounds = [];
  while (left.length) {
    const busy = new Set();
    const tables = [];
    for (let i = 0; i < left.length; ) {
      if (left[i].some((id) => busy.has(id))) {
        i++;
        continue;
      }
      for (const id of left[i]) busy.add(id);
      tables.push(left[i]);
      left.splice(i, 1);
    }
    rounds.push(tables);
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
