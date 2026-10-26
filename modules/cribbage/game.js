// The rules of Cribbage as pure functions over a plain, JSON-friendly room object (no sockets, no files).
// Seats are numbered in clockwise order from 0; a seat holds a person (userId) or a computer player (bot: true).
// Functions that can fail return { ok: false, error }; the rest return { ok: true, ... }.
import { fullDeck, isCard, rankOf, shuffle } from '../../shared/cards.js';
import { AIS } from './ai/index.js';
import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { placements } from '../../shared/scores.js';
import { pipValue, scoreHand, scorePlay } from './scoring.js';

export const TARGETS = [61, 121];
export const MIN_SEATS = 2;
export const MAX_SEATS = 4;
export const MAX_NAME_LENGTH = 24;
export const BOT_NAMES = ['Robin', 'Sam', 'Jo', 'Max', 'Kit', 'Lee', 'Pat', 'Ash', 'Bea', 'Fen'];
/** A winner "skunks" an opponent who finishes below this. */
export const SKUNK_LINE = { 61: 31, 121: 91 };
const LOG_LIMIT = 60;

const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });

/** Cards each player is dealt, how many of them go to the crib, and how many extra cards the deck adds to the crib. */
export const dealRules = (players) => ({ dealt: players === 2 ? 6 : 5, discards: players === 2 ? 2 : 1, extraToCrib: players === 3 ? 1 : 0 });

const PIPS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const byRank = (a, b) => PIPS.indexOf(rankOf(a)) - PIPS.indexOf(rankOf(b)) || a.slice(-1).localeCompare(b.slice(-1));
export const sortCards = (cards) => [...cards].sort(byRank);

export function createRoom({ code, hostId, name, target = 121, seats = 2, now = Date.now() }) {
  const room = {
    code,
    hostId,
    target: TARGETS.includes(target) ? target : 121,
    seatCount: Math.min(MAX_SEATS, Math.max(MIN_SEATS, seats)),
    phase: 'lobby',
    seats: [],
    botsMade: 0,
    dealer: 0,
    handNo: 0,
    deck: [],
    hands: [],
    kept: [],
    crib: [],
    starter: null,
    play: null,
    show: null,
    log: [],
    history: [],
    handDeltas: {},
    winner: null,
    recorded: false,
    createdAt: now,
    updatedAt: now,
  };
  addHuman(room, hostId, name);
  return room;
}

export const isLive = (room) => room.phase !== 'finished';
export const seatOf = (room, userId) => room.seats.findIndex((s) => s.userId === userId && !s.left);
export const hasPlayer = (room, userId) => seatOf(room, userId) !== -1;
const humanSeats = (room) => room.seats.filter((s) => !s.bot && !s.left);

function uniqueName(room, raw) {
  const base = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH) || 'Player';
  const taken = (name) => room.seats.some((s) => s.name.toLowerCase() === name.toLowerCase());
  for (let n = 1; n < 100; n++) {
    const suffix = n === 1 ? '' : ` (${n})`;
    const name = `${base.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!taken(name)) return name;
  }
  return base;
}

const freshStats = () => ({ handsPlayed: 0, bestHand: 0, pegPoints: 0 });
const newSeat = (fields) => ({ userId: null, bot: false, name: '', score: 0, back: 0, ready: false, discarded: false, stats: freshStats(), ...fields });

export function addHuman(room, userId, name) {
  if (room.phase !== 'lobby') return fail('That game has already started.');
  if (hasPlayer(room, userId)) return ok();
  if (room.seats.length >= room.seatCount) return fail('That game is full.');
  room.seats.push(newSeat({ userId, name: uniqueName(room, name) }));
  return ok();
}

const requireHost = (room, userId) => (room.hostId === userId ? null : fail('Only the host can do that.'));

function makeBot(room) {
  room.botsMade++;
  const unused = BOT_NAMES.filter((n) => !room.seats.some((s) => s.name.toLowerCase() === n.toLowerCase()));
  return newSeat({ bot: true, botId: `bot:${room.botsMade}`, name: unused[0] ?? `Computer ${room.botsMade}` });
}

/** Checks that the host is changing the lobby; returns an error result or null. */
function lobbyEdit(room, userId) {
  return requireHost(room, userId) ?? (room.phase === 'lobby' ? null : fail('The game has already started.'));
}

export function addBot(room, userId) {
  const problem = lobbyEdit(room, userId);
  if (problem) return problem;
  if (room.seats.length >= room.seatCount) return fail('Every seat is taken.');
  room.seats.push(makeBot(room));
  return ok();
}

export function fillBots(room, userId) {
  const problem = lobbyEdit(room, userId);
  if (problem) return problem;
  while (room.seats.length < room.seatCount) room.seats.push(makeBot(room));
  return ok();
}

export function removeBot(room, userId, seat) {
  const problem = lobbyEdit(room, userId);
  if (problem) return problem;
  if (!room.seats[seat]?.bot) return fail('That seat has no computer player.');
  room.seats.splice(seat, 1);
  return ok();
}

export function setSettings(room, userId, { target, seats }) {
  const problem = lobbyEdit(room, userId);
  if (problem) return problem;
  if (target !== undefined && !TARGETS.includes(target)) return fail('Play to 61 or 121.');
  if (seats !== undefined) {
    if (!Number.isInteger(seats) || seats < MIN_SEATS || seats > MAX_SEATS) return fail('A game has 2 to 4 seats.');
    if (seats < room.seats.length) return fail('Remove a player first: that would leave too few seats.');
    room.seatCount = seats;
  }
  if (target !== undefined) room.target = target;
  return ok();
}

// ---- leaving ----

/**
 * A person leaves. In the lobby the seat is simply given up, after the game it is marked as left, and in a game in
 * progress a computer player takes the seat over. `empty` is true when no people remain: the room should be dropped.
 */
export function removeHuman(room, userId, rng = Math.random) {
  const index = seatOf(room, userId);
  if (index === -1) return fail('That player is not in the game.');
  if (room.phase === 'lobby') room.seats.splice(index, 1);
  else if (room.phase === 'finished') room.seats[index].left = true;
  else {
    room.botsMade++;
    Object.assign(room.seats[index], { userId: null, bot: true, botId: `bot:${room.botsMade}`, replaced: true, ai: pickAI(AIS, rng).id });
  }
  const humans = humanSeats(room);
  if (room.hostId === userId && humans.length) room.hostId = humans[0].userId;
  if (!humans.length) return ok({ empty: true });
  advanceIfReady(room, rng);
  return ok({ empty: false });
}

/** The host removes someone from the lobby, or (in a game) someone who has gone away: a computer player takes over. */
export function kick(room, hostId, seat, { away = false, rng } = {}) {
  const problem = requireHost(room, hostId);
  if (problem) return problem;
  const target = room.seats[seat];
  if (!target || target.bot || target.left) return fail('That player is not in the game.');
  if (target.userId === hostId) return fail('You cannot remove yourself: use Leave.');
  if (!['lobby', 'finished'].includes(room.phase) && !away) return fail('You can only remove a player who has left the game page.');
  const { userId } = target;
  const result = removeHuman(room, userId, rng);
  return result.ok ? ok({ userId, empty: result.empty }) : result;
}

// ---- scoring and the log ----

function log(room, seat, text, points = 0) {
  room.log.push({ seat, text, points });
  if (room.log.length > LOG_LIMIT) room.log.splice(0, room.log.length - LOG_LIMIT);
}

/** Closes the hand's entry in the history: what each seat scored in it (pegging, heels, hands and crib). */
function commitHand(room) {
  room.history.push({ label: `Hand ${room.handNo}`, deltas: room.handDeltas });
  room.handDeltas = {};
}

function finish(room, seat) {
  room.phase = 'finished';
  room.winner = seat;
  room.play = null;
  commitHand(room);
}

/**
 * Pegs points for a seat. The back peg moves to where the front peg was; the game ends the moment the target is
 * reached, and any remaining entries are not scored.
 */
function award(room, seat, entries, { pegging = false, quiet = false } = {}) {
  const s = room.seats[seat];
  s.back = s.score;
  for (const entry of entries) {
    if (room.phase === 'finished' || entry.points <= 0) continue;
    const before = s.score;
    s.score = Math.min(room.target, s.score + entry.points);
    room.handDeltas[seat] = (room.handDeltas[seat] ?? 0) + s.score - before;
    if (pegging) s.stats.pegPoints += entry.points;
    if (!quiet) log(room, seat, `${s.name}: ${entry.label.toLowerCase()} for ${entry.points}`, entry.points);
    if (s.score >= room.target) finish(room, seat);
  }
}

// ---- dealing ----

function deal(room, rng) {
  const { dealt, extraToCrib } = dealRules(room.seats.length);
  room.deck = shuffle(fullDeck(), rng);
  room.hands = room.seats.map(() => sortCards(room.deck.splice(0, dealt)));
  room.crib = room.deck.splice(0, extraToCrib);
  room.kept = [];
  room.starter = null;
  room.play = null;
  room.show = null;
  room.log = [];
  room.handDeltas = {};
  room.handNo++;
  room.phase = 'discard';
  for (const s of room.seats) {
    s.ready = false;
    s.discarded = false;
    s.stats.handsPlayed++;
  }
}

export function start(room, userId, rng = Math.random) {
  const problem = lobbyEdit(room, userId);
  if (problem) return problem;
  if (room.seats.length !== room.seatCount) return fail('Fill every seat first (add computer players if you like).');
  if (!humanSeats(room).length) return fail('At least one person must play.');
  for (const s of room.seats) Object.assign(s, { score: 0, back: 0 });
  room.winner = null;
  room.handNo = 0;
  room.history = [];
  room.handDeltas = {};
  room.dealer = Math.floor(rng() * room.seats.length);
  deal(room, rng);
  assignBotAIs(room, rng);
  return ok();
}

/** Every computer player picks the AI it will play this game with (kept on the seat, so it survives a restart). */
function assignBotAIs(room, rng) {
  const bots = room.seats.flatMap((s, i) => (s.bot ? [i] : []));
  const chosen = assignAIs(AIS, bots, rng);
  room.seats.forEach((s, i) => {
    if (s.bot) s.ai = chosen[i];
    else delete s.ai;
  });
}

/** From the finished game back to the lobby, with the same seats (people who have gone are dropped). */
export function returnToLobby(room, userId, present = () => true) {
  const problem = requireHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('The game is not over yet.');
  room.seats = room.seats.filter((s) => s.bot || (!s.left && present(s.userId)));
  for (const s of room.seats) {
    Object.assign(s, { score: 0, back: 0, ready: false, discarded: false, stats: freshStats() });
    delete s.ai;
  }
  Object.assign(room, { phase: 'lobby', winner: null, recorded: false, hands: [], kept: [], crib: [], deck: [], starter: null, play: null, show: null, log: [], history: [], handDeltas: {}, handNo: 0 });
  return ok();
}

export function discard(room, seat, cards, rng = Math.random) {
  if (room.phase !== 'discard') return fail('It is not time to discard.');
  const s = room.seats[seat];
  const { discards } = dealRules(room.seats.length);
  if (s.discarded) return fail('You have already discarded.');
  if (!Array.isArray(cards) || cards.length !== discards) return fail(`Choose ${discards} card${discards === 1 ? '' : 's'} for the crib.`);
  if (!cards.every(isCard) || new Set(cards).size !== cards.length || !cards.every((c) => room.hands[seat].includes(c))) return fail('Those cards are not in your hand.');
  room.hands[seat] = room.hands[seat].filter((c) => !cards.includes(c));
  room.crib.push(...cards);
  s.discarded = true;
  if (room.seats.every((x) => x.discarded)) beginPlay(room, rng);
  return ok();
}

function beginPlay(room, rng) {
  room.crib = sortCards(room.crib);
  room.kept = room.hands.map((h) => [...h]);
  room.starter = room.deck.splice(Math.floor(rng() * room.deck.length), 1)[0];
  room.phase = 'play';
  room.play = { count: 0, sequence: [], turn: (room.dealer + 1) % room.seats.length, last: null, said: [], previous: [] };
  if (rankOf(room.starter) === 'J') award(room, room.dealer, [{ label: 'His heels', points: 2 }]);
}

// ---- the play (pegging) ----

const hasCards = (room, seat) => room.hands[seat].length > 0;
export const playableCards = (room, seat) => (room.play ? room.hands[seat].filter((c) => room.play.count + pipValue(c) <= 31) : []);

function resetSequence(room) {
  const p = room.play;
  p.previous = p.sequence.map((x) => x.card);
  Object.assign(p, { count: 0, sequence: [], said: [], last: null });
}

export function playCard(room, seat, card) {
  if (room.phase !== 'play') return fail('It is not time to play a card.');
  const p = room.play;
  if (p.turn !== seat) return fail('It is not your turn.');
  if (!isCard(card) || !room.hands[seat].includes(card)) return fail('That card is not in your hand.');
  if (p.count + pipValue(card) > 31) return fail('That would take the count over 31.');
  room.hands[seat] = room.hands[seat].filter((c) => c !== card);
  p.sequence.push({ seat, card });
  p.count += pipValue(card);
  p.last = seat;
  award(room, seat, scorePlay(p.sequence.map((x) => x.card)).items, { pegging: true });
  if (room.phase !== 'finished') afterPlay(room, seat);
  return ok();
}

/** Decides who plays next after `from` played: a player with no playable card says go, and the play ends when due. */
function afterPlay(room, from) {
  const p = room.play;
  const n = room.seats.length;

  if (p.count === 31) {
    resetSequence(room);
  } else {
    for (let k = 1; k <= n; k++) {
      const seat = (from + k) % n;
      if (!hasCards(room, seat)) continue;
      if (playableCards(room, seat).length) {
        p.turn = seat;
        return;
      }
      if (!p.said.includes(seat) && seat !== p.last) {
        p.said.push(seat);
        log(room, seat, `${room.seats[seat].name}: go`);
      }
    }
    const anyLeft = room.seats.some((_, seat) => hasCards(room, seat));
    award(room, p.last, [{ label: anyLeft ? 'Go' : 'Last card', points: 1 }], { pegging: true });
    if (room.phase === 'finished') return;
    resetSequence(room);
  }
  for (let k = 1; k <= n; k++) {
    const seat = (from + k) % n;
    if (hasCards(room, seat)) {
      p.turn = seat;
      return;
    }
  }
  startShow(room);
}

// ---- the show ----

function startShow(room) {
  const n = room.seats.length;
  const order = Array.from({ length: n }, (_, k) => ({ kind: 'hand', seat: (room.dealer + 1 + k) % n }));
  order.push({ kind: 'crib', seat: room.dealer });
  room.phase = 'show';
  room.play = null;
  room.show = { entries: [] };
  for (const { kind, seat } of order) {
    const cards = kind === 'crib' ? room.crib : room.kept[seat];
    const { total, items } = scoreHand(cards, room.starter, { crib: kind === 'crib' });
    if (kind === 'hand') room.seats[seat].stats.bestHand = Math.max(room.seats[seat].stats.bestHand, total);
    award(room, seat, [{ label: kind, points: total }], { quiet: true });
    room.show.entries.push({ kind, seat, cards, items, total, after: room.seats[seat].score });
    if (room.phase === 'finished') return;
  }
  commitHand(room);
}

function advanceIfReady(room, rng) {
  if (room.phase !== 'show' || !room.seats.every((s) => s.bot || s.ready)) return;
  room.dealer = (room.dealer + 1) % room.seats.length;
  deal(room, rng);
}

export function ready(room, seat, rng = Math.random) {
  if (room.phase !== 'show') return fail('There is nothing to be ready for.');
  room.seats[seat].ready = true;
  advanceIfReady(room, rng);
  return ok();
}

// ---- computer players ----

/** The computer player who has something to do now, if any: { seat, kind: 'discard' | 'play' }. */
export function pendingBot(room) {
  if (room.phase === 'discard') {
    const seat = room.seats.findIndex((s) => s.bot && !s.discarded);
    return seat === -1 ? null : { seat, kind: 'discard' };
  }
  if (room.phase === 'play' && room.seats[room.play.turn].bot) return { seat: room.play.turn, kind: 'play' };
  return null;
}

/** The AI a computer player plays with; rooms saved before AIs existed fall back to the first one. */
export const aiOf = (room, seat) => aiById(AIS, room.seats[seat].ai);

/** Everything an AI may know when choosing what to discard: plain data about its own hand and the table. */
function discardContext(room, seat, rng) {
  const { discards } = dealRules(room.seats.length);
  return { hand: room.hands[seat], discardCount: discards, isDealer: seat === room.dealer, players: room.seats.length, me: seat, scores: room.seats.map((s) => s.score), target: room.target, rng };
}

/** The same for a card to play: the count, the cards played so far, and how many each player still holds. */
function playContext(room, seat, rng) {
  const p = room.play;
  const played = room.kept.flatMap((kept, i) => kept.filter((c) => !room.hands[i].includes(c)));
  return {
    hand: room.hands[seat],
    count: p.count,
    sequence: p.sequence.map((x) => x.card),
    played,
    starter: room.starter,
    players: room.seats.length,
    me: seat,
    isDealer: seat === room.dealer,
    cardsLeft: room.hands.map((h) => h.length),
    scores: room.seats.map((s) => s.score),
    target: room.target,
    rng,
  };
}

/** Makes the pending computer player's move. An AI that answers illegally is overruled by the standard one. */
export function botMove(room, rng = Math.random) {
  const pending = pendingBot(room);
  if (!pending) return fail('No computer player has a move.');
  const { seat, kind } = pending;
  const ai = aiOf(room, seat);
  if (kind === 'discard') {
    const context = discardContext(room, seat, rng);
    let cards = ai.discard(context);
    const valid = Array.isArray(cards) && cards.length === context.discardCount && new Set(cards).size === cards.length && cards.every((c) => context.hand.includes(c));
    if (!valid) cards = AIS[0].discard(context);
    return discard(room, seat, cards, rng);
  }
  const context = playContext(room, seat, rng);
  let card = ai.play(context);
  if (!playableCards(room, seat).includes(card)) card = AIS[0].play(context);
  return playCard(room, seat, card);
}

// ---- views and statistics ----

const seatPlacements = (room) => Object.values(placements(Object.fromEntries(room.seats.map((s, i) => [i, s.score]))));

const aiSummary = ({ id, name }) => ({ id, name });

/** What one person may see. Other players' hands and discards stay hidden until the show. */
export function viewFor(room, userId, { online = () => true } = {}) {
  const me = seatOf(room, userId);
  const live = room.phase === 'discard' || room.phase === 'play';
  const p = room.play;
  const { discards } = dealRules(room.seats.length);
  return {
    code: room.code,
    phase: room.phase,
    target: room.target,
    seatCount: room.seatCount,
    you: me,
    isHost: room.hostId === userId,
    handNo: room.handNo,
    dealer: room.phase === 'lobby' ? null : room.dealer,
    limits: { targets: TARGETS, minSeats: MIN_SEATS, maxSeats: MAX_SEATS },
    skunkLine: SKUNK_LINE[room.target],
    seats: room.seats.map((s, i) => ({
      seat: i,
      name: s.name,
      bot: s.bot,
      replaced: Boolean(s.replaced),
      ai: s.bot && room.phase !== 'lobby' ? aiSummary(aiOf(room, i)) : null,
      host: s.userId !== null && s.userId === room.hostId,
      online: s.bot || (s.userId !== null && online(s.userId)),
      left: Boolean(s.left),
      score: s.score,
      back: s.back,
      cards: live ? room.hands[i].length : 0,
      discarded: room.phase === 'discard' ? s.discarded : false,
      ready: room.phase === 'show' ? s.bot || s.ready : false,
    })),
    hand: live && me !== -1 ? room.hands[me] : [],
    need: room.phase === 'discard' && me !== -1 && !room.seats[me].discarded ? discards : 0,
    cribCount: live || room.phase === 'show' ? room.crib.length : 0,
    deckCount: live ? room.deck.length : 0,
    starter: room.starter,
    play: p ? { count: p.count, sequence: p.sequence, previous: p.previous, turn: p.turn, playable: p.turn === me ? playableCards(room, me) : [] } : null,
    show: room.show,
    log: room.log.slice(-40),
    winner: room.winner,
    placements: room.phase === 'finished' ? seatPlacements(room) : null,
    scoreboard: {
      players: room.seats.map((s, i) => ({ id: i, name: s.name, score: s.score, isMe: i === me, away: !s.bot && !s.left && !online(s.userId) })),
      rounds: room.history,
      lowIsBetter: false,
      target: room.target,
    },
  };
}

/** The result of a finished game for ctx.stats.record: people only (computer players and replaced people are left out). */
export function statsPlayers(room) {
  const skunked = room.seats.some((s, i) => i !== room.winner && s.score < SKUNK_LINE[room.target]);
  return room.seats.flatMap((s, i) =>
    s.bot || s.userId === null
      ? []
      : [
          {
            userId: s.userId,
            outcome: i === room.winner ? 'win' : 'loss',
            placement: seatPlacements(room)[i],
            score: Math.min(s.score, room.target),
            extras: { handsPlayed: s.stats.handsPlayed, bestHand: s.stats.bestHand, pegPoints: s.stats.pegPoints, skunks: i === room.winner && skunked ? 1 : 0 },
          },
        ],
  );
}
