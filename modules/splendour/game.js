// The rules of Splendour, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
//
// Tokens are arrays of six counts: Diamond, Sapphire, Emerald, Ruby, Onyx, then Gold (index 5). A seat holds a human
// ({ kind: 'human', id: <account id>, name }), a computer player ({ kind: 'bot', id: 'bot:<n>', name }) or null
// (empty, lobby only). Seat order is turn order; it is shuffled when the game starts.
//
// The numbers every part of Splendour agrees on (the token limit, the supply, the cost calculation...) are in rules.js;
// the seat and lobby rules (joining, leaving, kicking, computer players) are the shared ones in shared/seats.js.
import { placements, seatScoreboardEntry } from '../../shared/scores.js';
import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { AIS } from './ai/index.js';
import { extrasOf, statsRows } from '../../shared/tally.js';
import { newTally, STAT_KEYS, tallyBuy, tallyNoble, tallyNobleChoice, tallyReserve, tallyReturn, tallyTurn } from './tally.js';
import { asHost, botSeats, createSeatRules, fail, hasPlayer, hostInLobby, humanSeats, isBot, isHuman, ok, seatOf } from '../../shared/seats.js';
import { CARD_BY_ID, LEVELS, NOBLES, NOBLE_BY_ID, cardsOfLevel, isCardId, isNobleId } from './cards.js';
import { GOLD, GOLD_SUPPLY, MAX_RESERVED, MAX_TOKENS, needOf, quoteFor, supplyPerColour } from './rules.js';

export const SEAT_COUNTS = [2, 3, 4];
export const TARGETS = [10, 15, 20];
export const DEFAULT_SETTINGS = { target: 15, seats: 4 };
export { MAX_TOKENS, MAX_RESERVED, GOLD_SUPPLY, supplyPerColour, needOf };
const BOARD_SLOTS = 4;
export const MAX_ROUNDS = 100; // a safety net: a game nobody can win ends after this many rounds
export { STAT_KEYS };
export const BOT_NAMES = ['Aurelia', 'Cormac', 'Thessaly', 'Ludo', 'Perpetua', 'Ansel', 'Odile', 'Marcus', 'Wren', 'Isidore'];
// Re-exported for the server, the computer players and the tests, which import them from here.
export { hasPlayer, humanSeats, isBot, isHuman, seatOf };

/** The phases in which a room is still going (a finished game is not resumed). */
const LIVE = ['lobby', 'playing'];

/**
 * Is this room still in play (the lobby or a game being played)? A person can be in only one such room at a time.
 *
 * Side effects: none.
 *
 * @param {object} room
 * @returns {boolean}
 */
export const isLive = (room) => LIVE.includes(room.phase);

/**
 * Adds up a list of numbers.
 *
 * Side effects: none.
 *
 * @param {number[]} list
 * @returns {number}
 */
const sum = (list) => list.reduce((a, b) => a + b, 0);

/**
 * A fresh set of empty tokens: five colours and Gold, all zero.
 *
 * Side effects: none.
 *
 * @returns {number[]} six zeros
 */
const emptyTokens = () => [0, 0, 0, 0, 0, 0];

/**
 * Is this a sensible token count (a whole number from 0 to 1000)? Used to validate what a client sends.
 *
 * Side effects: none.
 *
 * @param {unknown} n
 * @returns {boolean}
 */
const isCount = (n) => Number.isInteger(n) && n >= 0 && n <= 1000;

/**
 * Is this a list of six sensible token counts? Used to validate payments and returned tokens a client sends.
 *
 * Side effects: none.
 *
 * @param {unknown} a
 * @returns {boolean}
 */
const isTokenArray = (a) => Array.isArray(a) && a.length === 6 && a.every(isCount);

/**
 * The discounts a player has earned: how many bought cards of each colour.
 *
 * Side effects: none.
 *
 * @param {{ bought: string[] }} player  a player of the room
 * @returns {number[]} five counts
 */
export function bonusesOf(player) {
  const bonuses = [0, 0, 0, 0, 0];
  for (const id of player.bought) bonuses[CARD_BY_ID[id].bonus]++;
  return bonuses;
}
/**
 * A player's prestige: the points of the cards bought plus the points of the nobles who have visited.
 *
 * Side effects: none.
 *
 * @param {{ bought: string[], nobles: string[] }} player
 * @returns {number}
 */
export const prestigeOf = (player) => sum(player.bought.map((id) => CARD_BY_ID[id].points)) + sum(player.nobles.map((id) => NOBLE_BY_ID[id].points));
/**
 * How many tokens (of any kind, Gold included) a player holds.
 *
 * Side effects: none.
 *
 * @param {{ tokens: number[] }} player
 * @returns {number}
 */
export const tokenTotal = (player) => sum(player.tokens);

/**
 * What buying a card would take: null if it cannot be afforded, else the default payment and the range of Gold. (The cost
 * calculation itself is the shared one in rules.js.)
 *
 * Side effects: none.
 *
 * @param {{ tokens: number[], bought: string[] }} player  a player of the room
 * @param {{ cost: number[] }} card
 * @returns {{ need: number[], pay: number[], minGold: number, maxGold: number } | null} `need` is the cost after discounts,
 *   `pay` the default payment (coloured tokens first), `minGold` the Gold that payment uses and `maxGold` the most Gold the
 *   player could usefully spend instead
 */
export function payment(player, card) {
  const quote = quoteFor(player.tokens, bonusesOf(player), card);
  if (!quote) return null;
  const short = quote.pay[GOLD];
  return { need: quote.need, pay: quote.pay, minGold: short, maxGold: Math.min(player.tokens[GOLD], sum(quote.need)) };
}

/**
 * Checks the settings a client asked for and merges them over the current ones.
 *
 * Side effects: none.
 *
 * @param {{ target?: number, seats?: number } | undefined} input  what was asked for (missing fields keep their value)
 * @param {{ target: number, seats: number }} current
 * @returns {{ ok: true, settings: object } | { ok: false, error: string }} never mutates its arguments
 */
export function normaliseSettings(input, current = DEFAULT_SETTINGS) {
  const next = { ...current };
  if (input?.target !== undefined) {
    if (!TARGETS.includes(input.target)) return fail(`The target prestige must be ${TARGETS.slice(0, -1).join(', ')} or ${TARGETS.at(-1)}.`);
    next.target = input.target;
  }
  if (input?.seats !== undefined) {
    if (!SEAT_COUNTS.includes(input.seats)) return fail('A game is for 2, 3 or 4 players.');
    next.seats = input.seats;
  }
  return ok({ settings: next });
}

/**
 * Makes a new room in the lobby with its host seated.
 *
 * Side effects: none.
 *
 * @param {object} args
 * @param {string} args.code      the invite code
 * @param {number} args.hostId    the host's account id
 * @param {string} args.hostName
 * @param {object} [args.settings]  { target, seats }; invalid settings throw
 * @param {number} args.now     the creation time in milliseconds
 * @returns {object} the room
 */
export function createRoom({ code, hostId, hostName, settings = {}, now }) {
  const normalised = normaliseSettings(settings);
  if (!normalised.ok) throw new Error(normalised.error);
  const room = {
    code,
    hostId,
    phase: 'lobby',
    settings: normalised.settings,
    seats: [{ kind: 'human', id: hostId, name: hostName }, ...Array(normalised.settings.seats - 1).fill(null)],
    nextBot: 1,
    createdAt: now,
    updatedAt: now,
  };
  resetGame(room);
  return room;
}

/**
 * Puts everything that belongs to one game back to its empty state (the seats, host and settings are kept).
 *
 * Side effects: mutates `room`.
 *
 * @param {object} room
 */
function resetGame(room) {
  Object.assign(room, {
    players: [],
    ais: {}, // bot id -> the id of the AI it plays with, chosen when the game starts
    supply: emptyTokens(),
    decks: { 1: [], 2: [], 3: [] },
    board: { 1: [], 2: [], 3: [] },
    nobles: [],
    turn: null,
    round: 1,
    pending: null,
    finalRound: false,
    triggeredBy: null,
    passStreak: 0,
    history: [],
    roundDeltas: [],
    roundNotes: [],
    log: [],
    winners: null,
    endReason: null,
    recorded: false,
  });
}

// ---- seats and settings ----

/**
 * The seat rules (join, leave, kick, computer players) are the shared ones. In Splendour a person who leaves mid-game is
 * replaced by a computer player, and that computer player picks its AI there and then (recorded in room.ais).
 */
const seats = createSeatRules({
  isMidGame: (room) => room.phase === 'playing',
  botNames: BOT_NAMES,
  /**
   * The computer player taking over a seat gets an AI of its own, recorded under its id.
   *
   * Side effects: mutates room.ais (adds an entry for the bot).
   *
   * @param {object} room
   * @param {object} bot   the new computer-player seat entry
   * @param {number} seat  the seat it takes over
   * @param {() => number} rng  random numbers in [0, 1)
   * @returns {object} the bot, unchanged
   */
  takeOver: (room, bot, seat, rng) => {
    (room.ais ??= {})[bot.id] = pickAI(AIS, rng).id;
    return bot;
  },
});
export const { addHuman, addBot, removeBot, fillWithBots, kick, removeHuman } = seats;

/**
 * The host changes the target prestige or the number of seats (lobby only). Shrinking the table keeps everyone seated,
 * packed to the front, and refuses if too many are seated.
 *
 * Side effects: mutates room.settings and, if the seat count changes, room.seats.
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @param {{ target?: number, seats?: number }} input
 * @returns {{ ok: boolean, error?: string }}
 */
export function setSettings(room, userId, input) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  const next = normaliseSettings(input, room.settings);
  if (!next.ok) return next;
  if (next.settings.seats !== room.seats.length) {
    const occupied = room.seats.filter(Boolean);
    if (occupied.length > next.settings.seats) return fail(`There are already ${occupied.length} players seated. Remove someone first.`);
    room.seats = [...occupied, ...Array(next.settings.seats - occupied.length).fill(null)];
  }
  room.settings = next.settings;
  return ok();
}

// ---- starting ----

/**
 * A shuffled copy of a list (Fisher-Yates); the original is left alone.
 *
 * Side effects: advances `rng` (one draw per element but the first); the list itself is not changed.
 *
 * @param {unknown[]} list
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {unknown[]}
 */
export function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The host starts the game: shuffles the seats (so the host is not always first), deals the board and nobles, and gives
 * every computer player an AI.
 *
 * Side effects: mutates `room` (resets the game, then sets seats, players, supply, decks, board, nobles, ais, phase).
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 */
export function start(room, userId, rng) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail('Every seat needs a player. Add computer players to fill the empty ones.');
  if (!humanSeats(room).length) return fail('At least one person has to play.');
  resetGame(room);
  room.seats = shuffle(room.seats, rng); // so that the first player is not always the host
  const n = room.seats.length;
  room.players = room.seats.map(() => ({ tokens: emptyTokens(), reserved: [], bought: [], nobles: [], tally: newTally() }));
  room.supply = [...Array(5).fill(supplyPerColour(n)), GOLD_SUPPLY]; // each colour by table size, then Gold
  for (const level of LEVELS) {
    room.decks[level] = shuffle(cardsOfLevel(level).map((c) => c.id), rng);
    room.board[level] = Array.from({ length: BOARD_SLOTS }, () => room.decks[level].pop() ?? null);
  }
  room.nobles = shuffle(NOBLES.map((x) => x.id), rng).slice(0, n + 1);
  room.ais = assignAIs(AIS, botSeats(room).map((i) => room.seats[i].id), rng); // after the deal, so the deal is unchanged
  room.roundDeltas = Array(n).fill(0);
  room.roundNotes = Array.from({ length: n }, () => []);
  room.turn = 0;
  room.phase = 'playing';
  return ok();
}

// ---- turns ----

/**
 * Adds an entry to the game log (which keeps only the latest 60).
 *
 * Side effects: mutates room.log.
 *
 * @param {object} room
 * @param {number} seat   who did it
 * @param {object} entry  what happened, e.g. { kind: 'take', colours }
 */
function logEntry(room, seat, entry) {
  room.log.push({ seat, round: room.round, ...entry });
  if (room.log.length > 60) room.log.splice(0, room.log.length - 60);
}

/**
 * Is this seat allowed to start an action now? It must be playing, on turn, with nothing pending.
 *
 * Side effects: none.
 *
 * @param {object} room
 * @param {number} seat
 * @returns {{ ok: false, error: string } | null} the refusal, or null if the seat may act
 */
function checkTurn(room, seat) {
  if (room.phase !== 'playing') return fail('The game is not being played.');
  if (room.turn !== seat) return fail('It is not your turn.');
  if (room.pending) return fail(room.pending.type === 'return' ? 'You must return tokens first.' : 'You must choose a noble first.');
  return null;
}

/**
 * Credits points to a seat for this round (shown in the score table).
 *
 * Side effects: mutates room.roundDeltas.
 *
 * @param {object} room
 * @param {number} seat    the seat that scored
 * @param {number} points  prestige gained (a card's points or a noble's)
 * @returns {void}
 */
const givePoints = (room, seat, points) => {
  room.roundDeltas[seat] += points;
};
/**
 * Adds a note about what a seat did this round (shown in the score table).
 *
 * Side effects: mutates room.roundNotes.
 *
 * @param {object} room
 * @param {number} seat   the seat the note is about
 * @param {string} text   the note, for example the name of a card bought
 * @returns {number} the new length of that seat's notes (the result of push; callers ignore it)
 */
const note = (room, seat, text) => room.roundNotes[seat].push(text);

/**
 * After any action: too many tokens, then nobles, then the end of the turn.
 *
 * Side effects: mutates `room` (sets a pending return, or visits nobles and may end the turn).
 *
 * @param {object} room
 * @param {number} seat  who has just acted
 */
function afterAction(room, seat) {
  const over = tokenTotal(room.players[seat]) - MAX_TOKENS;
  if (over > 0) {
    room.pending = { type: 'return', seat, count: over };
    return;
  }
  visitNobles(room, seat);
}

/**
 * The nobles whose requirements a player's card bonuses meet.
 *
 * Side effects: none.
 *
 * @param {object} room
 * @param {number} seat
 * @returns {string[]} noble ids still on the table
 */
export function qualifyingNobles(room, seat) {
  const bonuses = bonusesOf(room.players[seat]);
  return room.nobles.filter((id) => Object.entries(NOBLE_BY_ID[id].requires).every(([colour, count]) => bonuses[colour] >= count));
}

/**
 * Lets nobles visit a seat: one visits at once, several make the player choose (a pending choice), none do nothing.
 *
 * Side effects: mutates `room`; ends the turn unless a choice is pending.
 *
 * @param {object} room
 * @param {number} seat
 */
function visitNobles(room, seat) {
  const options = qualifyingNobles(room, seat);
  if (options.length > 1) {
    tallyNobleChoice(room.players[seat].tally);
    room.pending = { type: 'noble', seat, options };
    return;
  }
  if (options.length === 1) takeNoble(room, seat, options[0]);
  endTurn(room, seat);
}

/**
 * A noble visits a player: it leaves the table, joins the player and scores its points.
 *
 * Side effects: mutates room.nobles, the player, the round points, the notes and the log.
 *
 * @param {object} room
 * @param {number} seat
 * @param {string} id  the noble's id
 */
function takeNoble(room, seat, id) {
  room.nobles = room.nobles.filter((n) => n !== id);
  const player = room.players[seat];
  player.nobles.push(id);
  tallyNoble(player.tally);
  givePoints(room, seat, NOBLE_BY_ID[id].points);
  note(room, seat, 'noble visited');
  logEntry(room, seat, { kind: 'noble', noble: id });
}

/**
 * Ends a seat's turn: marks the final round if the target has been reached, passes the turn on and, after the last seat,
 * records the round and finishes the game if it is over (target reached, stalemate or the round limit).
 *
 * Side effects: mutates `room` (pending, finalRound, turn, history, round, and possibly the phase).
 *
 * @param {object} room
 * @param {number} seat  whose turn has just ended
 */
function endTurn(room, seat) {
  const n = room.seats.length;
  room.pending = null;
  tallyTurn(room.players[seat].tally);
  if (!room.finalRound && prestigeOf(room.players[seat]) >= room.settings.target) {
    room.finalRound = true;
    room.triggeredBy = seat;
  }
  if (seat < n - 1) {
    room.turn = seat + 1;
    return;
  }
  // The round is complete: every player has had one turn.
  room.history.push({
    label: `Round ${room.round}`,
    deltas: Object.fromEntries(room.roundDeltas.map((points, i) => [i, points])),
    notes: Object.fromEntries(room.roundNotes.map((texts, i) => [i, texts.join(', ')])),
  });
  room.roundDeltas = Array(n).fill(0);
  room.roundNotes = Array.from({ length: n }, () => []);
  const stalled = room.passStreak >= n;
  if (room.finalRound || stalled || room.round >= MAX_ROUNDS) {
    room.endReason = room.finalRound ? 'target' : stalled ? 'stalled' : 'limit';
    finish(room);
    return;
  }
  room.round++;
  room.turn = 0;
}

/**
 * Ranking key: prestige, then fewer purchased cards (a higher key places higher).
 *
 * Side effects: none.
 *
 * @param {object} player
 * @returns {number}
 */
const rankKey = (player) => prestigeOf(player) * 1000 - player.bought.length;

/**
 * Ends the game and decides the winners (everyone tied for first place).
 *
 * Side effects: mutates room.phase, turn, pending and winners.
 *
 * @param {object} room
 */
function finish(room) {
  room.phase = 'finished';
  room.turn = null;
  room.pending = null;
  const keys = Object.fromEntries(room.players.map((p, i) => [i, rankKey(p)]));
  room.winners = Object.entries(placements(keys)).filter(([, place]) => place === 1).map(([i]) => Number(i));
}

// ---- the kinds of turn ----

/**
 * Take up to three gems of different colours (three if at least three colours are available).
 *
 * Side effects: mutates `room` when it succeeds.
 *
 * @param {object} room
 * @param {number} seat
 * @param {number[]} colours  colour indexes 0-4
 * @returns {{ ok: boolean, error?: string }}
 */
export function takeGems(room, seat, colours) {
  const problem = checkTurn(room, seat);
  if (problem) return problem;
  if (!Array.isArray(colours) || colours.length < 1 || colours.length > 3) return fail('Take up to three gems of different colours.');
  if (!colours.every((c) => Number.isInteger(c) && c >= 0 && c < 5)) return fail('That is not a gem colour.');
  if (new Set(colours).size !== colours.length) return fail('Gems taken together must all be different colours.');
  if (colours.some((c) => room.supply[c] < 1)) return fail('There are none of that colour left.');
  const available = [0, 1, 2, 3, 4].filter((c) => room.supply[c] > 0).length;
  if (available >= 3 && colours.length !== 3) return fail('Take three gems of three different colours.');
  const player = room.players[seat];
  for (const c of colours) {
    room.supply[c]--;
    player.tokens[c]++;
  }
  room.passStreak = 0;
  note(room, seat, `took ${colours.length} ${colours.length === 1 ? 'gem' : 'gems'}`);
  logEntry(room, seat, { kind: 'take', colours: [...colours] });
  afterAction(room, seat);
  return ok();
}

/**
 * Take two gems of one colour (only if at least four are left).
 *
 * Side effects: mutates `room` when it succeeds.
 *
 * @param {object} room
 * @param {number} seat
 * @param {number} colour  a colour index 0-4
 * @returns {{ ok: boolean, error?: string }}
 */
export function takeTwo(room, seat, colour) {
  const problem = checkTurn(room, seat);
  if (problem) return problem;
  if (!Number.isInteger(colour) || colour < 0 || colour >= 5) return fail('That is not a gem colour.');
  if (room.supply[colour] < 4) return fail('You can only take two of a colour when at least four are left.');
  room.supply[colour] -= 2;
  room.players[seat].tokens[colour] += 2;
  room.passStreak = 0;
  note(room, seat, 'took 2 gems');
  logEntry(room, seat, { kind: 'take2', colour });
  afterAction(room, seat);
  return ok();
}

/**
 * Reserves a face-up card ({ card }) or the top card of a deck, unseen ({ level }); the player also gets a Gold if any is left.
 *
 * Side effects: mutates `room` when it succeeds.
 *
 * @param {object} room
 * @param {number} seat
 * @param {{ card?: string, level?: number }} target
 * @returns {{ ok: boolean, error?: string }}
 */
export function reserveCard(room, seat, target) {
  const problem = checkTurn(room, seat);
  if (problem) return problem;
  const player = room.players[seat];
  if (player.reserved.length >= MAX_RESERVED) return fail(`You can only reserve ${MAX_RESERVED} cards.`);
  let entry;
  let level;
  if (target?.card !== undefined) {
    if (!isCardId(target.card)) return fail('That is not a card.');
    level = CARD_BY_ID[target.card].level;
    const slot = room.board[level].indexOf(target.card);
    if (slot === -1) return fail('That card is not on the table.');
    room.board[level][slot] = room.decks[level].pop() ?? null;
    entry = { card: target.card, blind: false };
  } else {
    level = target?.level;
    if (!LEVELS.includes(level)) return fail('Choose a card or a level.');
    if (!room.decks[level].length) return fail('That pile is empty.');
    entry = { card: room.decks[level].pop(), blind: true };
  }
  player.reserved.push(entry);
  tallyReserve(player.tally);
  const gold = room.supply[GOLD] > 0;
  if (gold) {
    room.supply[GOLD]--;
    player.tokens[GOLD]++;
  }
  room.passStreak = 0;
  note(room, seat, `reserved a level ${level} card`);
  logEntry(room, seat, { kind: 'reserve', level, card: entry.blind ? null : entry.card, gold });
  afterAction(room, seat);
  return ok();
}

/**
 * Buys a face-up card or one of your own reserved cards. `pay` (six counts) is optional: coloured tokens are used first by default.
 *
 * Side effects: mutates `room` when it succeeds.
 *
 * @param {object} room
 * @param {number} seat
 * @param {string} id     the card's id
 * @param {number[]} [pay]  how to pay, if not the default
 * @returns {{ ok: boolean, error?: string }}
 */
export function buyCard(room, seat, id, pay) {
  const problem = checkTurn(room, seat);
  if (problem) return problem;
  if (!isCardId(id)) return fail('That is not a card.');
  const card = CARD_BY_ID[id];
  const player = room.players[seat];
  const reservedAt = player.reserved.findIndex((r) => r.card === id);
  const slot = room.board[card.level].indexOf(id);
  if (reservedAt === -1 && slot === -1) return fail('That card is not on the table or in your reserve.');
  const quote = payment(player, card);
  if (!quote) return fail('You cannot afford that card.');
  let paid = quote.pay;
  if (pay !== undefined && pay !== null) {
    if (!isTokenArray(pay)) return fail('That is not a valid payment.');
    const shortfall = sum(quote.need.map((n, c) => n - pay[c]));
    const valid = pay.every((p, c) => p <= player.tokens[c]) && quote.need.every((n, c) => pay[c] <= n) && shortfall === pay[GOLD];
    if (!valid) return fail('That payment does not match the cost of the card.');
    paid = [...pay];
  }
  for (let c = 0; c < 6; c++) {
    player.tokens[c] -= paid[c];
    room.supply[c] += paid[c];
  }
  if (reservedAt !== -1) player.reserved.splice(reservedAt, 1);
  else room.board[card.level][slot] = room.decks[card.level].pop() ?? null;
  player.bought.push(id);
  tallyBuy(player.tally, card);
  givePoints(room, seat, card.points);
  room.passStreak = 0;
  note(room, seat, `bought a level ${card.level} card${card.points ? ` (${card.points} ${card.points === 1 ? 'point' : 'points'})` : ''}`);
  logEntry(room, seat, { kind: 'buy', card: id, level: card.level, paid, fromReserve: reservedAt !== -1 });
  afterAction(room, seat);
  return ok();
}

/**
 * Returns tokens after going over the token limit (exactly as many as you are over by).
 *
 * Side effects: mutates `room` when it succeeds (moves the tokens to the supply, then visits nobles).
 *
 * @param {object} room
 * @param {number} seat
 * @param {number[]} give  six counts
 * @returns {{ ok: boolean, error?: string }}
 */
export function returnTokens(room, seat, give) {
  const pending = room.pending;
  if (room.phase !== 'playing' || room.turn !== seat) return fail('It is not your turn.');
  if (pending?.type !== 'return') return fail('You do not have to return any tokens.');
  if (!isTokenArray(give)) return fail('That is not a valid set of tokens.');
  const player = room.players[seat];
  if (give.some((g, c) => g > player.tokens[c])) return fail('You cannot return tokens you do not have.');
  if (sum(give) !== pending.count) return fail(`Return exactly ${pending.count} ${pending.count === 1 ? 'token' : 'tokens'}.`);
  for (let c = 0; c < 6; c++) {
    player.tokens[c] -= give[c];
    room.supply[c] += give[c];
  }
  room.pending = null;
  tallyReturn(player.tally);
  logEntry(room, seat, { kind: 'return', give: [...give] });
  visitNobles(room, seat);
  return ok();
}

/**
 * Chooses which of several visiting nobles to take.
 *
 * Side effects: mutates `room` when it succeeds (the noble visits and the turn ends).
 *
 * @param {object} room
 * @param {number} seat
 * @param {string} id  a noble id from the pending options
 * @returns {{ ok: boolean, error?: string }}
 */
export function chooseNoble(room, seat, id) {
  const pending = room.pending;
  if (room.phase !== 'playing' || room.turn !== seat) return fail('It is not your turn.');
  if (pending?.type !== 'noble') return fail('There is no noble to choose.');
  if (!isNobleId(id) || !pending.options.includes(id)) return fail('That noble is not visiting you.');
  room.pending = null;
  takeNoble(room, seat, id);
  endTurn(room, seat);
  return ok();
}

// ---- legal moves ----

/**
 * Every legal move for a seat (objects like { type: 'take', colours }), for computer players and tests.
 *
 * Side effects: none.
 *
 * @param {object} room
 * @param {number} seat
 * @returns {object[]} empty when it is not the seat's turn, a choice is pending, or the seat has to pass
 */
export function legalMoves(room, seat) {
  if (room.phase !== 'playing' || room.turn !== seat || room.pending) return [];
  const player = room.players[seat];
  const moves = [];
  const open = [0, 1, 2, 3, 4].filter((c) => room.supply[c] > 0);
  /**
   * Every way of choosing k items from the list, as lists (gem colours here, since a "take" move names its colours).
   *
   * Side effects: none.
   *
   * @param {number[]} list  the items to choose from
   * @param {number} k       how many to choose
   * @returns {number[][]} every combination, in list order
   */
  const choose = (list, k) => (k === 0 ? [[]] : list.flatMap((x, i) => choose(list.slice(i + 1), k - 1).map((rest) => [x, ...rest])));
  if (open.length >= 3) for (const colours of choose(open, 3)) moves.push({ type: 'take', colours });
  else for (let k = 1; k <= open.length; k++) for (const colours of choose(open, k)) moves.push({ type: 'take', colours });
  for (let c = 0; c < 5; c++) if (room.supply[c] >= 4) moves.push({ type: 'takeTwo', colour: c });
  if (player.reserved.length < MAX_RESERVED) {
    for (const level of LEVELS) {
      for (const card of room.board[level]) if (card) moves.push({ type: 'reserve', card });
      if (room.decks[level].length) moves.push({ type: 'reserve', level });
    }
  }
  const buyable = [...LEVELS.flatMap((l) => room.board[l]).filter(Boolean), ...player.reserved.map((r) => r.card)];
  for (const id of buyable) if (payment(player, CARD_BY_ID[id])) moves.push({ type: 'buy', card: id });
  return moves;
}

/**
 * Passes the turn (only when there is nothing else to do).
 *
 * Side effects: mutates `room` when it succeeds.
 *
 * @param {object} room
 * @param {number} seat
 * @returns {{ ok: boolean, error?: string }}
 */
export function passTurn(room, seat) {
  const problem = checkTurn(room, seat);
  if (problem) return problem;
  if (legalMoves(room, seat).length) return fail('You can only pass when there is nothing else you can do.');
  room.passStreak++;
  note(room, seat, 'passed');
  logEntry(room, seat, { kind: 'pass' });
  afterAction(room, seat);
  return ok();
}

/**
 * Applies a move object from legalMoves.
 *
 * Side effects: mutates `room` when it succeeds.
 *
 * @param {object} room
 * @param {number} seat
 * @param {object} move  { type: 'take' | 'takeTwo' | 'reserve' | 'buy' | 'pass', ... }
 * @returns {{ ok: boolean, error?: string }}
 */
export function applyMove(room, seat, move) {
  switch (move.type) {
    case 'take':
      return takeGems(room, seat, move.colours);
    case 'takeTwo':
      return takeTwo(room, seat, move.colour);
    case 'reserve':
      return reserveCard(room, seat, move.card !== undefined ? { card: move.card } : { level: move.level });
    case 'buy':
      return buyCard(room, seat, move.card, move.pay);
    case 'pass':
      return passTurn(room, seat);
    default:
      return fail('Unknown move.');
  }
}

/**
 * The host sends everyone back to the lobby after a finished game.
 *
 * Side effects: mutates `room` (resets the game, phase becomes 'lobby').
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @returns {{ ok: boolean, error?: string }}
 */
export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('The game is not over.');
  resetGame(room);
  room.phase = 'lobby';
  return ok();
}

/**
 * What the statistics should record for a finished game: one entry per human still seated.
 *
 * Side effects: none.
 *
 * @param {object} room  a finished room
 * @returns {{ userId: number, outcome: string, placement: number, score: number, extras: object }[]}
 */
export function statsPlayers(room) {
  const keys = Object.fromEntries(room.players.map((p, i) => [i, rankKey(p)]));
  const places = placements(keys);
  return statsRows(room.seats, (seat, i) => ({
    outcome: room.winners.includes(i) ? 'win' : 'loss',
    placement: places[i],
    score: prestigeOf(room.players[i]),
    extras: { ...extrasOf(room.players[i].tally, STAT_KEYS), pipped: room.triggeredBy === i && !room.winners.includes(i) ? 1 : 0 },
  }));
}

// ---- what each player may see ----

/**
 * One occupied seat as the table shows it. Before the game starts that is just who is sitting there; afterwards it includes
 * tokens, bonuses, nobles and reserved cards (a reserved card is face down to everybody but its owner).
 *
 * Side effects: none.
 *
 * @param {object} room  not changed
 * @param {number} i  the seat's index
 * @param {number} me  the viewer's seat, or -1
 * @param {(id: number) => boolean} online  says who is connected
 * @returns {object}
 */
function seatView(room, i, me, online) {
  const seat = room.seats[i];
  const base = { seat: i, name: seat.name, bot: isBot(seat), online: isBot(seat) || online(seat.id) };
  if (room.phase === 'lobby') return base;
  const p = room.players[i];
  if (isBot(seat)) {
    const ai = aiById(AIS, room.ais?.[seat.id]);
    base.ai = { id: ai.id, name: ai.name };
  }
  return {
    ...base,
    tokens: [...p.tokens],
    bonuses: bonusesOf(p),
    prestige: prestigeOf(p),
    bought: p.bought.length,
    nobles: [...p.nobles],
    reserved: p.reserved.map((r) => ({
      level: CARD_BY_ID[r.card].level,
      card: i === me ? r.card : null, // only the owner is sent the card; computer players are told the face-up ones (bot.js)
      blind: r.blind, // how it was reserved (everyone saw that), not whether you can see it
    })),
  };
}

/**
 * The standard scoreboard (shared/scores.js): prestige is the score.
 *
 * Side effects: none.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @param {(id: number) => boolean} online
 * @returns {object}
 */
function scoreboardView(room, me, online) {
  const started = room.phase !== 'lobby';
  const player = (seat, i) => seatScoreboardEntry(seat, i, { score: started ? prestigeOf(room.players[i]) : 0, me, current: room.phase === 'playing' && room.turn === i, online });
  return {
    players: room.seats.flatMap((seat, i) => (seat ? [player(seat, i)] : [])),
    rounds: room.history.map(({ label, deltas, notes }) => ({ label, deltas, notes })),
    lowIsBetter: false,
    target: room.settings.target,
  };
}

/**
 * The public table once the game has started: tokens, the cards on show, the sizes of the draw piles (never their order),
 * nobles, the turn, the log and the standings.
 *
 * Side effects: none.
 *
 * @param {object} room  not changed
 * @returns {object} fields to add to the view when the game has started
 */
function tableView(room) {
  return {
    supply: [...room.supply],
    board: { 1: [...room.board[1]], 2: [...room.board[2]], 3: [...room.board[3]] },
    decks: { 1: room.decks[1].length, 2: room.decks[2].length, 3: room.decks[3].length },
    nobles: [...room.nobles],
    turn: room.turn,
    round: room.round,
    pending: room.pending ? { ...room.pending } : null,
    finalRound: room.finalRound,
    triggeredBy: room.triggeredBy,
    maxRounds: MAX_ROUNDS,
    log: room.log.map((e) => ({ ...e })),
    standings: room.players.map((p, i) => ({ seat: i, prestige: prestigeOf(p), cards: p.bought.length, nobles: p.nobles.length })),
  };
}

/**
 * What a seated viewer can afford and whether they must pass.
 *
 * Side effects: none.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat (not -1)
 * @returns {object} `afford` (what each affordable card costs, by card id) and `canPass`
 */
function affordView(room, me) {
  const player = room.players[me];
  const afford = {};
  const candidates = [...[1, 2, 3].flatMap((l) => room.board[l]).filter(Boolean), ...player.reserved.map((r) => r.card)];
  for (const id of candidates) {
    const quote = payment(player, CARD_BY_ID[id]);
    if (quote) afford[id] = { pay: quote.pay, minGold: quote.minGold, maxGold: quote.maxGold };
  }
  return { afford, canPass: room.phase === 'playing' && room.turn === me && !room.pending && legalMoves(room, me).length === 0 };
}

/**
 * Everything one account may know. A reserved card is only ever sent to the player who holds it (until it is bought): to
 * everyone else it is face down, showing only its level. (Computer players are told the face-up ones too, as a person could
 * remember them: see bot.js.)
 * The draw piles are sent as counts only.
 *
 * Side effects: none.
 *
 * @param {object} room
 * @param {number} userId  the account the view is for (may be a spectator, who gets seat -1)
 * @param {{ online?: (id: number) => boolean }} options  says who is connected, so the view can show who is away
 * @returns {object} plain data for the client
 */
export function viewFor(room, userId, { online = () => true } = {}) {
  const me = seatOf(room, userId);
  const view = {
    code: room.code,
    phase: room.phase,
    you: me,
    hostSeat: seatOf(room, room.hostId),
    settings: room.settings,
    limits: { targets: TARGETS, seatCounts: SEAT_COUNTS },
    seats: room.seats.map((seat, i) => (seat ? seatView(room, i, me, online) : null)),
    scoreboard: scoreboardView(room, me, online),
    winners: room.winners,
    endReason: room.endReason,
  };
  if (room.phase === 'lobby') return view;
  Object.assign(view, tableView(room));
  if (me !== -1) Object.assign(view, affordView(room, me));
  return view;
}
