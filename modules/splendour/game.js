// The rules of Splendour, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
//
// Tokens are arrays of six counts: Diamond, Sapphire, Emerald, Ruby, Onyx, then Gold (index 5). A seat holds a human
// ({ kind: 'human', id: <account id>, name }), a computer player ({ kind: 'bot', id: 'bot:<n>', name }) or null
// (empty, lobby only). Seat order is turn order; it is shuffled when the game starts.
import { placements } from '../../shared/scores.js';
import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { AIS } from './ai/index.js';
import { CARD_BY_ID, LEVELS, NOBLES, NOBLE_BY_ID, GOLD, cardsOfLevel, isCardId, isNobleId } from './cards.js';

export const SEAT_COUNTS = [2, 3, 4];
export const TARGETS = [10, 15, 20];
export const DEFAULT_SETTINGS = { target: 15, seats: 4 };
export const MAX_TOKENS = 10;
export const MAX_RESERVED = 3;
export const BOARD_SLOTS = 4;
export const GOLD_SUPPLY = 5;
export const MAX_ROUNDS = 100; // a safety net: a game nobody can win ends after this many rounds
export const STAT_KEYS = ['cardsBought', 'noblesVisited', 'reservedCards', 'turnsTaken'];
export const BOT_NAMES = ['Aurelia', 'Cormac', 'Thessaly', 'Ludo', 'Perpetua', 'Ansel', 'Odile', 'Marcus', 'Wren', 'Isidore'];

const LIVE = ['lobby', 'playing'];
const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });

export const isLive = (room) => LIVE.includes(room.phase);
export const isHuman = (seat) => seat?.kind === 'human';
export const isBot = (seat) => seat?.kind === 'bot';
export const seatOf = (room, userId) => room.seats.findIndex((s) => isHuman(s) && s.id === userId);
export const hasPlayer = (room, userId) => seatOf(room, userId) !== -1;
export const humanSeats = (room) => room.seats.flatMap((s, i) => (isHuman(s) ? [i] : []));
export const supplyPerColour = (players) => ({ 2: 4, 3: 5, 4: 7 })[players];

const sum = (list) => list.reduce((a, b) => a + b, 0);
export const emptyTokens = () => [0, 0, 0, 0, 0, 0];
const freshTally = () => Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
const isCount = (n) => Number.isInteger(n) && n >= 0 && n <= 1000;
const isTokenArray = (a) => Array.isArray(a) && a.length === 6 && a.every(isCount);

export function bonusesOf(player) {
  const bonuses = [0, 0, 0, 0, 0];
  for (const id of player.bought) bonuses[CARD_BY_ID[id].bonus]++;
  return bonuses;
}
export const prestigeOf = (player) => sum(player.bought.map((id) => CARD_BY_ID[id].points)) + sum(player.nobles.map((id) => NOBLE_BY_ID[id].points));
export const tokenTotal = (player) => sum(player.tokens);
export const needOf = (card, bonuses) => card.cost.map((c, i) => Math.max(0, c - bonuses[i]));

/** What buying a card would take: null if it cannot be afforded, else the default payment and the range of gold. */
export function payment(player, card) {
  const need = needOf(card, bonusesOf(player));
  const pay = emptyTokens();
  let short = 0;
  for (let c = 0; c < 5; c++) {
    pay[c] = Math.min(need[c], player.tokens[c]);
    short += need[c] - pay[c];
  }
  if (short > player.tokens[GOLD]) return null;
  pay[GOLD] = short;
  return { need, pay, minGold: short, maxGold: Math.min(player.tokens[GOLD], sum(need)) };
}

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

export function createRoom({ code, hostId, hostName, settings = {}, now = Date.now() }) {
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

const firstEmpty = (room) => room.seats.findIndex((s) => s === null);

/** The name, with a "(2)" suffix when someone at the table already has it. */
export function uniqueName(room, name) {
  const used = new Set(room.seats.filter(Boolean).map((s) => s.name));
  let result = name;
  for (let n = 2; used.has(result); n++) result = `${name} (${n})`;
  return result;
}

export function addHuman(room, userId, name) {
  if (hasPlayer(room, userId)) return ok({ seat: seatOf(room, userId) });
  if (room.phase !== 'lobby') return fail('That game has already started.');
  const seat = firstEmpty(room);
  if (seat === -1) return fail('That game is full.');
  room.seats[seat] = { kind: 'human', id: userId, name: uniqueName(room, name) };
  return ok({ seat });
}

function newBot(room) {
  const used = new Set(room.seats.filter(Boolean).map((s) => s.name));
  const base = BOT_NAMES.find((n) => !used.has(n)) ?? 'Computer';
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base} ${n}`;
  return { kind: 'bot', id: `bot:${room.nextBot++}`, name };
}

/**
 * Removes a human. Before the game starts (or after it ends) the seat is freed; mid-game a computer player takes
 * it over (and picks its AI then). `empty` is true when no human is left, so the room should be discarded.
 */
export function removeHuman(room, userId, rng = Math.random) {
  const seat = seatOf(room, userId);
  if (seat === -1) return fail('You are not in this game.');
  const midGame = room.phase === 'playing';
  room.seats[seat] = midGame ? newBot(room) : null;
  if (midGame) (room.ais ??= {})[room.seats[seat].id] = pickAI(AIS, rng).id;
  const humans = humanSeats(room);
  if (!humans.length) return ok({ empty: true, seat });
  if (room.hostId === userId) room.hostId = room.seats[humans[0]].id;
  return ok({ empty: false, seat, replaced: midGame });
}

const asHost = (room, userId) => (room.hostId === userId ? null : fail('Only the host can do that.'));
const inLobby = (room) => (room.phase === 'lobby' ? null : fail('You can only change that before the game starts.'));

export function setSettings(room, userId, input) {
  const problem = asHost(room, userId) ?? inLobby(room);
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

export function addBot(room, userId, seat) {
  const problem = asHost(room, userId) ?? inLobby(room);
  if (problem) return problem;
  const index = seat === undefined ? firstEmpty(room) : seat;
  if (index === -1) return fail('Every seat is taken.');
  if (!Number.isInteger(index) || index < 0 || index >= room.seats.length) return fail('There is no such seat.');
  if (room.seats[index]) return fail('That seat is taken.');
  room.seats[index] = newBot(room);
  return ok({ seat: index });
}

/**
 * The host removes another person, at any time before the game is over: in the lobby their seat is freed, and in a
 * game a computer player takes it over (as when someone leaves). The result names the person so the server can send
 * them home.
 */
export function kick(room, hostId, seat, rng = Math.random) {
  const problem = asHost(room, hostId);
  if (problem) return problem;
  const target = Number.isInteger(seat) ? room.seats[seat] : null;
  if (!isHuman(target) || target.id === hostId) return fail('There is no one else in that seat.');
  if (room.phase === 'finished') return fail('The game is over: there is nobody to remove.');
  const removed = removeHuman(room, target.id, rng);
  return removed.ok ? ok({ userId: target.id, replaced: Boolean(removed.replaced) }) : removed;
}

export function removeBot(room, userId, seat) {
  const problem = asHost(room, userId) ?? inLobby(room);
  if (problem) return problem;
  if (!Number.isInteger(seat) || !isBot(room.seats[seat])) return fail('There is no computer player in that seat.');
  room.seats[seat] = null;
  return ok();
}

export function fillWithBots(room, userId) {
  const problem = asHost(room, userId) ?? inLobby(room);
  if (problem) return problem;
  for (let i = 0; i < room.seats.length; i++) if (!room.seats[i]) room.seats[i] = newBot(room);
  return ok();
}

// ---- starting ----

export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function start(room, userId, rng = Math.random) {
  const problem = asHost(room, userId) ?? inLobby(room);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail('Every seat needs a player. Add computer players to fill the empty ones.');
  if (!humanSeats(room).length) return fail('At least one person has to play.');
  resetGame(room);
  room.seats = shuffle(room.seats, rng); // so that the first player is not always the host
  const n = room.seats.length;
  room.players = room.seats.map(() => ({ tokens: emptyTokens(), reserved: [], bought: [], nobles: [], tally: freshTally() }));
  room.supply = [...Array(5).fill(supplyPerColour(n)), GOLD_SUPPLY];
  for (const level of LEVELS) {
    room.decks[level] = shuffle(cardsOfLevel(level).map((c) => c.id), rng);
    room.board[level] = Array.from({ length: BOARD_SLOTS }, () => room.decks[level].pop() ?? null);
  }
  room.nobles = shuffle(NOBLES.map((x) => x.id), rng).slice(0, n + 1);
  room.ais = assignAIs(AIS, room.seats.filter(isBot).map((s) => s.id), rng); // after the deal, so the deal is unchanged
  room.roundDeltas = Array(n).fill(0);
  room.roundNotes = Array.from({ length: n }, () => []);
  room.turn = 0;
  room.phase = 'playing';
  return ok();
}

// ---- turns ----

function logEntry(room, seat, entry) {
  room.log.push({ seat, round: room.round, ...entry });
  if (room.log.length > 60) room.log.splice(0, room.log.length - 60);
}

function checkTurn(room, seat) {
  if (room.phase !== 'playing') return fail('The game is not being played.');
  if (room.turn !== seat) return fail('It is not your turn.');
  if (room.pending) return fail(room.pending.type === 'return' ? 'You must return tokens first.' : 'You must choose a noble first.');
  return null;
}

const givePoints = (room, seat, points) => {
  room.roundDeltas[seat] += points;
};
const note = (room, seat, text) => room.roundNotes[seat].push(text);

/** After any action: too many tokens, then nobles, then the end of the turn. */
function afterAction(room, seat) {
  const over = tokenTotal(room.players[seat]) - MAX_TOKENS;
  if (over > 0) {
    room.pending = { type: 'return', seat, count: over };
    return;
  }
  visitNobles(room, seat);
}

/** The nobles whose requirements a player's card bonuses meet. */
export function qualifyingNobles(room, seat) {
  const bonuses = bonusesOf(room.players[seat]);
  return room.nobles.filter((id) => Object.entries(NOBLE_BY_ID[id].requires).every(([colour, count]) => bonuses[colour] >= count));
}

function visitNobles(room, seat) {
  const options = qualifyingNobles(room, seat);
  if (options.length > 1) {
    room.pending = { type: 'noble', seat, options };
    return;
  }
  if (options.length === 1) takeNoble(room, seat, options[0]);
  endTurn(room, seat);
}

function takeNoble(room, seat, id) {
  room.nobles = room.nobles.filter((n) => n !== id);
  const player = room.players[seat];
  player.nobles.push(id);
  player.tally.noblesVisited++;
  givePoints(room, seat, NOBLE_BY_ID[id].points);
  note(room, seat, 'noble visited');
  logEntry(room, seat, { kind: 'noble', noble: id });
}

function endTurn(room, seat) {
  const n = room.seats.length;
  room.pending = null;
  room.players[seat].tally.turnsTaken++;
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

/** Ranking key: prestige, then fewer purchased cards. */
const rankKey = (player) => prestigeOf(player) * 1000 - player.bought.length;

function finish(room) {
  room.phase = 'finished';
  room.turn = null;
  room.pending = null;
  const keys = Object.fromEntries(room.players.map((p, i) => [i, rankKey(p)]));
  room.winners = Object.entries(placements(keys)).filter(([, place]) => place === 1).map(([i]) => Number(i));
}

// ---- the kinds of turn ----

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

/** Reserves a face-up card ({ card }) or the top card of a deck, unseen ({ level }). */
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
  player.tally.reservedCards++;
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

/** Buys a face-up card or one of your own reserved cards. `pay` (six counts) is optional: coloured tokens are used first by default. */
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
  player.tally.cardsBought++;
  givePoints(room, seat, card.points);
  room.passStreak = 0;
  note(room, seat, `bought a level ${card.level} card${card.points ? ` (${card.points} ${card.points === 1 ? 'point' : 'points'})` : ''}`);
  logEntry(room, seat, { kind: 'buy', card: id, level: card.level, paid, fromReserve: reservedAt !== -1 });
  afterAction(room, seat);
  return ok();
}

/** Returns tokens after going over the limit of ten (exactly as many as you are over by). */
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
  logEntry(room, seat, { kind: 'return', give: [...give] });
  visitNobles(room, seat);
  return ok();
}

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

/** Every legal move for a seat (objects like { type: 'take', colours }), for computer players and tests. */
export function legalMoves(room, seat) {
  if (room.phase !== 'playing' || room.turn !== seat || room.pending) return [];
  const player = room.players[seat];
  const moves = [];
  const open = [0, 1, 2, 3, 4].filter((c) => room.supply[c] > 0);
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

/** Applies a move object from legalMoves. */
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

export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('The game is not over.');
  resetGame(room);
  room.phase = 'lobby';
  return ok();
}

/** What the statistics should record for a finished game: one entry per human still seated. */
export function statsPlayers(room) {
  const keys = Object.fromEntries(room.players.map((p, i) => [i, rankKey(p)]));
  const places = placements(keys);
  return room.seats.flatMap((seat, i) =>
    isHuman(seat)
      ? [
          {
            userId: seat.id,
            outcome: room.winners.includes(i) ? 'win' : 'loss',
            placement: places[i],
            score: prestigeOf(room.players[i]),
            extras: { ...room.players[i].tally },
          },
        ]
      : [],
  );
}

// ---- what each player may see ----

/**
 * Everything one account may know. The identity of a face-down reserved card is only sent to the player who holds
 * it (until it is bought), and the draw piles are sent as counts only.
 */
export function viewFor(room, userId, { online = () => true } = {}) {
  const me = seatOf(room, userId);
  const started = room.phase !== 'lobby';
  const view = {
    code: room.code,
    phase: room.phase,
    you: me,
    hostSeat: seatOf(room, room.hostId),
    settings: room.settings,
    limits: { targets: TARGETS, seatCounts: SEAT_COUNTS },
    seats: room.seats.map((seat, i) => {
      if (!seat) return null;
      const base = { seat: i, name: seat.name, bot: isBot(seat), online: isBot(seat) || online(seat.id) };
      if (!started) return base;
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
          card: i === me || !r.blind ? r.card : null,
          blind: r.blind,
        })),
      };
    }),
    scoreboard: {
      players: room.seats.flatMap((seat, i) =>
        seat ? [{ id: i, name: seat.name, score: started ? prestigeOf(room.players[i]) : 0, isMe: i === me, bot: isBot(seat), current: room.phase === 'playing' && room.turn === i, away: isHuman(seat) && !online(seat.id) }] : [],
      ),
      rounds: room.history.map(({ label, deltas, notes }) => ({ label, deltas, notes })),
      lowIsBetter: false,
      target: room.settings.target,
    },
    winners: room.winners,
    endReason: room.endReason,
  };
  if (!started) return view;
  view.supply = [...room.supply];
  view.board = { 1: [...room.board[1]], 2: [...room.board[2]], 3: [...room.board[3]] };
  view.decks = { 1: room.decks[1].length, 2: room.decks[2].length, 3: room.decks[3].length };
  view.nobles = [...room.nobles];
  view.turn = room.turn;
  view.round = room.round;
  view.pending = room.pending ? { ...room.pending } : null;
  view.finalRound = room.finalRound;
  view.triggeredBy = room.triggeredBy;
  view.maxRounds = MAX_ROUNDS;
  view.log = room.log.map((e) => ({ ...e }));
  view.standings = room.players.map((p, i) => ({ seat: i, prestige: prestigeOf(p), cards: p.bought.length, nobles: p.nobles.length }));
  if (me !== -1) {
    const player = room.players[me];
    const afford = {};
    const candidates = [...[1, 2, 3].flatMap((l) => room.board[l]).filter(Boolean), ...player.reserved.map((r) => r.card)];
    for (const id of candidates) {
      const quote = payment(player, CARD_BY_ID[id]);
      if (quote) afford[id] = { pay: quote.pay, minGold: quote.minGold, maxGold: quote.maxGold };
    }
    view.afford = afford;
    view.canPass = room.phase === 'playing' && room.turn === me && !room.pending && legalMoves(room, me).length === 0;
  }
  return view;
}
