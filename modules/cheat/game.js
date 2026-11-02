// The rules of Cheat, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error, params? }, where `error` is a code under `errors.` in the
// game's locale file or the site's (see shared/seats.js and shared/messages.js).
//
// Three to seven players, all the cards dealt out. Turns go clockwise and each one has a rank to claim, which runs Ace, 2, 3 ...
// King and round again. On your turn you put one to four cards face down on the pile and say they are all of that rank (they
// need not be: that is the cheating). Anyone else may call "Cheat!" on the last play before the next one is made. If it was
// a lie its player picks up the whole pile; if it was true the caller does. The first player to get rid of every card wins,
// once nobody has caught their last play out.
//
// Seats 0..n-1 run clockwise. A seat holds a human ({ kind: 'human', id: <account id>, name }), a computer player
// ({ kind: 'bot', id: 'bot:<n>', name, ai }), a person who left after the game ended ({ kind: 'gone', name }, kept so the
// final standings still make sense) or null (empty, lobby only).
//
// Depends on the shared card, seat, AI, score, tally and trick helpers in shared/, and on ./ai and ./tally.js.
import { placements, seatScoreboardEntry } from '../../shared/scores.js';
import { RANKS, fullDeck, rankOf, shuffle, sortHand } from '../../shared/cards.js';
import { aiById, assignAIs, describeAI, pickAI } from '../../shared/ai.js';
import { DEFAULT_BOT_NAMES, asHost, botSeats, createSeatRules, emptySeats, fail, freeGoneSeats, goneSeat, hasPlayer, hostInLobby, humanSeats, isBot, isHuman, ok, seatOf } from '../../shared/seats.js';
import { AIS } from './ai/index.js';
import { extrasOf, statsRows } from '../../shared/tally.js';
import { nextSeat as seatAfter } from '../../shared/tricks.js';
import { newTally, PUBLIC_KEYS, STAT_KEYS, tallyCall, tallyCleanGetaway, tallyHand, tallyLieStood, tallyPlay } from './tally.js';

export const MIN_SEATS = 3;
export const MAX_SEATS = 7;
export const DEFAULT_SEATS = 4;
export const MAX_PLAY = 4;
/** The ranks in the order they are claimed: the Ace first. */
export const SEQUENCE = ['A', ...RANKS.filter((rank) => rank !== 'A')];
export { STAT_KEYS };
export const BOT_NAMES = DEFAULT_BOT_NAMES;

/** The phases in which a game is still going on (a finished game is not). */
const LIVE = ['lobby', 'playing', 'check'];

/** Is this room's game still going on (in the lobby, being played or in the final check)? Pure: reads room.phase only. */
export const isLive = (room) => LIVE.includes(room.phase);
export { hasPlayer, humanSeats, isBot, isHuman, seatOf };
/** Is this a table size the game allows (a whole number from MIN_SEATS to MAX_SEATS)? */
export const isSeatCount = (n) => Number.isInteger(n) && n >= MIN_SEATS && n <= MAX_SEATS;
/** The rank to claim on the nth play of the game (0 for the first). */
export const rankFor = (plays) => SEQUENCE[plays % SEQUENCE.length];
/** Six or more players use two packs, so that there are enough cards to go round and to lie with. */
export const decksFor = (seats) => (seats >= 6 ? 2 : 1);
/** The cards for a table of this many seats: one pack, or two for six or more players, unshuffled. */
export const deckFor = (seats) => Array.from({ length: decksFor(seats) }, () => fullDeck()).flat();
/**
 * The seat after this one, clockwise (wrapping round the table).
 *
 * @param {object} room  not changed
 * @param {number} seat  the seat to count on from
 * @returns {number} the next seat index
 * Side effects: none.
 */
const nextSeat = (room, seat) => seatAfter(seat, room.seats.length);

/**
 * Makes a new room in the lobby with the host in seat 0 and the other seats empty.
 *
 * @param {object} args
 * @param {string} args.code      the invite code
 * @param {number} args.hostId    the host's account id
 * @param {string} args.hostName  the host's name
 * @param {{ seats?: number }} [args.settings]  the number of seats (default DEFAULT_SEATS)
 * @param {number} args.now     the creation time in milliseconds
 * @returns {object} the room
 * @throws {Error} if the number of seats is not allowed
 * Side effects: none outside the new room it builds.
 */
export function createRoom({ code, hostId, hostName, settings = {}, now }) {
  const seatCount = settings.seats ?? DEFAULT_SEATS;
  if (!isSeatCount(seatCount)) throw new Error(`A game has ${MIN_SEATS} to ${MAX_SEATS} players.`);
  const room = {
    code,
    hostId,
    phase: 'lobby',
    seats: [{ kind: 'human', id: hostId, name: hostName }, ...emptySeats(seatCount - 1)],
    nextBot: 1,
    createdAt: now,
    updatedAt: now,
  };
  resetGame(room);
  return room;
}

/**
 * Clears everything about a game in progress (hands, pile, turn, tallies...), sized for the current number of seats.
 * Side effects: mutates room. Used when a room is created, resized, started and played again.
 *
 * @param {object} room  the room to reset in place
 * @returns {void}
 */
function resetGame(room) {
  const n = room.seats.length;
  Object.assign(room, {
    hands: Array.from({ length: n }, () => []),
    pile: [], // every card played since the last pick-up, face down
    plays: 0, // plays made in the game: this decides the rank to claim
    turn: null,
    last: null, // the play that can still be called: { seat, count, rank, cards, lie }
    lastCall: null, // what the last call turned up, public until the next play
    decided: [], // computer seats that have decided about the last play (and, in the final check, everyone who has accepted it)
    winner: null,
    cardsLeft: null,
    tally: Array.from({ length: n }, newTally),
    recorded: false,
  });
}

// ---- seats and settings ----

/**
 * The seat rules (join, leave, kick, computer players) are the shared ones. In Cheat a person who leaves mid-game (while
 * it is being played or in the final check) is replaced by a computer player that gets its own AI; nothing else needs to
 * happen when somebody leaves.
 * Side effects: none at definition; the returned rules mutate the room they are given.
 */
const seats = createSeatRules({
  isMidGame: (room) => ['playing', 'check'].includes(room.phase),
  botNames: BOT_NAMES,
  takeOver: (room, bot, seat, rng) => ({ ...bot, ai: pickAI(AIS, rng).id }),
  finishedSeat: goneSeat,
});
export const { addHuman, addBot, removeBot, fillWithBots, kick, removeHuman } = seats;

/**
 * The host changes the lobby settings (just the number of seats). Everyone stays seated (see resizeSeats).
 * Side effects: mutates room.
 *
 * @param {object} room
 * @param {number} userId  the account asking; must be the host
 * @param {{ seats?: number }} input  the new settings
 * @returns {{ ok: boolean, error?: string, params?: object }} ok, or the refusal's code (and its values)
 */
export function setSettings(room, userId, input) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (input?.seats !== undefined) {
    if (!isSeatCount(input.seats)) return fail('playersRange', { min: MIN_SEATS, max: MAX_SEATS });
    const seated = room.seats.filter(Boolean).length;
    if (input.seats < seated) return fail('removePlayerFirst');
    resizeSeats(room, input.seats);
  }
  return ok();
}

/**
 * Grows or shrinks the table. Shrinking keeps everyone seated, closing up the gaps in turn order if it has to.
 * Side effects: mutates room (its seats, and resets the game state).
 *
 * @param {object} room  the room to resize in place
 * @param {number} count  the new number of seats (already checked to be allowed and not fewer than the people seated)
 * @returns {void}
 */
function resizeSeats(room, count) {
  if (count < room.seats.length && room.seats.slice(count).some(Boolean)) room.seats = room.seats.filter(Boolean);
  room.seats = [...room.seats.slice(0, count), ...emptySeats(Math.max(0, count - room.seats.length))];
  resetGame(room);
}

// ---- starting ----

/**
 * The host deals the cards and starts the game. Every empty seat must be filled, and at least one person must be playing.
 * Computer players choose their AI after the deal, so the deal itself does not depend on it.
 * Side effects: mutates room (hands, turn, phase 'playing', each bot's ai).
 *
 * @param {object} room
 * @param {number} userId  the account asking; must be the host
 * @param {() => number} rng  random numbers for the shuffle and the AI picks
 * @returns {{ ok: boolean, error?: string }} ok, or the reason it was refused
 */
export function start(room, userId, rng) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail('allSeatsNeedPlayers', { seats: room.seats.length });
  if (!humanSeats(room).length) return fail('needPerson');
  resetGame(room);
  const n = room.seats.length;
  const deck = shuffle(deckFor(n), rng);
  const hands = Array.from({ length: n }, () => []);
  deck.forEach((card, i) => hands[i % n].push(card));
  room.hands = hands.map(sortHand);
  room.turn = Math.max(0, room.hands.findIndex((hand) => hand.includes('AS'))); // the Ace of Spades starts, as the Ace is claimed first
  room.phase = 'playing';
  // Every computer player picks its AI for the whole game (after the deal, so the deal itself is unchanged).
  const bots = botSeats(room);
  const picks = assignAIs(AIS, bots, rng);
  for (const i of bots) room.seats[i].ai = picks[i];
  return ok();
}

// ---- playing ----

/**
 * Puts one to four cards face down on the pile, claiming they are all of the rank of the turn (they need not be). A player
 * who plays their last card moves the game to the final check instead of winning straight away.
 * Side effects: mutates room (hand, pile, last, tallies, turn, phase).
 *
 * @param {object} room
 * @param {number} seat  the seat playing
 * @param {string[]} cards  the cards played, each from that seat's hand
 * @returns {{ ok: boolean, error?: string }} ok, or the reason it was refused
 */
export function playCards(room, seat, cards) {
  if (room.phase !== 'playing') return fail('notPlaying');
  if (room.turn !== seat) return fail('notYourTurn');
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > MAX_PLAY) return fail('playBetween', { max: MAX_PLAY });
  const hand = [...room.hands[seat]];
  for (const card of cards) {
    const at = typeof card === 'string' ? hand.indexOf(card) : -1;
    if (at === -1) return fail('playFromHand');
    hand.splice(at, 1);
  }
  const rank = rankFor(room.plays);
  const lie = cards.some((card) => rankOf(card) !== rank);
  room.hands[seat] = hand;
  room.pile.push(...cards);
  if (room.last?.lie) tallyLieStood(room.tally[room.last.seat]); // nobody called the play before this one
  room.last = { seat, count: cards.length, rank, cards: [...cards], lie };
  room.plays++;
  room.decided = [];
  room.lastCall = null;
  tallyPlay(room.tally[seat], { count: cards.length, lie });
  if (hand.length === 0) {
    room.phase = 'check'; // out of cards: they win unless this last play is caught out
    room.turn = null;
  } else room.turn = nextSeat(room, seat);
  return ok();
}

/**
 * Calls "Cheat!" on the last play. Whoever is wrong picks up the pile. In the final check a true call ends the game with
 * the accused player winning, and a caught lie sends the game back to play.
 * Side effects: mutates room (hands, pile, lastCall, tallies, perhaps the phase).
 *
 * @param {object} room
 * @param {number} seat  the seat calling
 * @returns {{ ok: boolean, lie?: boolean, error?: string }} `lie` says whether the play was a lie
 */
export function callCheat(room, seat) {
  if (!['playing', 'check'].includes(room.phase) || !room.last) return fail('nothingToCall');
  if (!Number.isInteger(seat) || !room.seats[seat]) return fail('notInGame');
  if (seat === room.last.seat) return fail('callOwnPlay');
  const { seat: accused, rank, count, cards, lie } = room.last;
  const picker = lie ? accused : seat;
  const pileSize = room.pile.length;
  const held = room.hands[picker];
  room.hands[picker] = sortHand([...held, ...room.pile]);
  tallyHand(room.tally[picker], held, room.hands[picker]);
  room.pile = [];
  room.lastCall = { caller: seat, accused, rank, count, cards: [...cards], lie, picker, pileSize };
  tallyCall(room.tally[seat], room.tally[accused], lie);
  room.last = null;
  room.decided = [];
  if (room.phase === 'check') {
    if (lie) {
      room.phase = 'playing';
      room.turn = nextSeat(room, accused);
    } else finish(room, accused);
  }
  return ok({ lie });
}

/**
 * In the final check, a person says they believe the last play, so that the player who went out can win.
 * Side effects: mutates room (decided; may finish the game).
 *
 * @param {object} room  the room in the final check
 * @param {number} seat  the seat accepting
 * @returns {{ ok: boolean, error?: string }} ok, or the reason it was refused
 */
export function accept(room, seat) {
  if (room.phase !== 'check' || !room.last) return fail('nothingToAccept');
  if (!Number.isInteger(seat) || !room.seats[seat]) return fail('notInGame');
  if (seat === room.last.seat) return fail('acceptOwnPlay');
  if (!room.decided.includes(seat)) room.decided.push(seat);
  settleCheck(room);
  return ok();
}

/**
 * The player who went out wins once everybody else has accepted their last play. Does nothing before that.
 * Side effects: may mutate room (tallies, and finishes the game).
 *
 * @param {object} room  the room to settle
 * @returns {void}
 */
function settleCheck(room) {
  if (room.phase !== 'check' || !room.last) return;
  const others = room.seats.map((_, i) => i).filter((i) => i !== room.last.seat);
  if (!others.every((i) => room.decided.includes(i))) return;
  if (room.last.lie) {
    tallyLieStood(room.tally[room.last.seat]);
    tallyCleanGetaway(room.tally[room.last.seat]);
  }
  finish(room, room.last.seat);
}

/**
 * Ends the game with this winner and records how many cards everyone still held.
 * Side effects: mutates room.
 *
 * @param {object} room
 * @param {number} winner  the winning seat
 * @returns {void}
 */
function finish(room, winner) {
  room.phase = 'finished';
  room.winner = winner;
  room.turn = null;
  room.last = null;
  room.cardsLeft = room.hands.map((hand) => hand.length);
}

/**
 * The host sends a finished game back to the lobby with the same people, ready for another.
 * Side effects: mutates room (resets the game state, phase 'lobby').
 *
 * @param {object} room
 * @param {number} userId  the account asking; must be the host
 * @returns {{ ok: boolean, error?: string }} ok, or the reason it was refused
 */
export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('notOver');
  freeGoneSeats(room);
  resetGame(room);
  room.phase = 'lobby';
  return ok();
}

/**
 * What the statistics should record for a finished game: one entry per human still seated.
 *
 * @param {object} room  a finished room
 * @returns {object[]} entries of { userId, outcome, placement, score, extras }
 * Side effects: none.
 */
export function statsPlayers(room) {
  const left = room.cardsLeft ?? room.hands.map((hand) => hand.length);
  const places = placements(Object.fromEntries(left.map((count, seat) => [seat, count])), { lowIsBetter: true });
  return statsRows(room.seats, (seat, i) => ({
    outcome: room.winner === i ? 'win' : 'loss',
    placement: places[i],
    score: left[i],
    extras: { ...extrasOf(room.tally[i], STAT_KEYS), honestWins: room.winner === i && !room.tally[i].liesTold ? 1 : 0 },
  }));
}

// ---- computer players ----

/**
 * The AI a computer seat plays with. Seats without one get the first, standard AI.
 *
 * @param {object} room  not changed
 * @param {number} seat  the computer seat
 * @returns {object} the AI definition
 * Side effects: none.
 */
export const aiOf = (room, seat) => aiById(AIS, room.seats[seat]?.ai);

/**
 * The plain data an AI decides from: its own hand and what everyone can see, never other hands or what was really played.
 *
 * @param {object} room
 * @param {number} seat  the computer seat deciding
 * @param {() => number} rng  random numbers for the AI
 * @returns {object} a fresh object, so an AI cannot change the room
 * Side effects: none.
 */
export function aiContext(room, seat, rng) {
  return {
    seat,
    hand: [...room.hands[seat]],
    rank: rankFor(room.plays),
    plays: room.plays,
    pileSize: room.pile.length,
    handSizes: room.hands.map((hand) => hand.length),
    decks: decksFor(room.seats.length),
    maxPlay: MAX_PLAY,
    last: room.last ? { seat: room.last.seat, count: room.last.count, rank: room.last.rank } : null,
    final: room.phase === 'check',
    rng,
  };
}

/**
 * The cards a computer player plays: always one to four cards from its hand, chosen by its own AI. If the AI throws or
 * suggests something illegal, the first card of the hand is played instead.
 *
 * @param {object} room  not changed
 * @param {number} seat  the computer seat playing
 * @param {() => number} rng  random numbers for the AI
 * @returns {string[]} the cards to play (validated)
 * Side effects: advances the rng; the room is not changed.
 */
export function botPlay(room, seat, rng) {
  const hand = room.hands[seat];
  // Is this a legal play: one to MAX_PLAY cards, each really in the hand (duplicates need duplicates)?
  const valid = (cards) => {
    if (!Array.isArray(cards) || cards.length < 1 || cards.length > MAX_PLAY) return false;
    const rest = [...hand];
    return cards.every((card) => {
      const at = rest.indexOf(card);
      if (at === -1) return false;
      rest.splice(at, 1);
      return true;
    });
  };
  let cards;
  try {
    cards = aiOf(room, seat).play(aiContext(room, seat, rng));
  } catch {
    cards = undefined; // a broken AI must not stop the game
  }
  return valid(cards) ? cards : [hand[0]];
}

/**
 * Whether a computer player calls "Cheat!" on the last play (false if its AI throws).
 *
 * @param {object} room  not changed
 * @param {number} seat  the computer seat deciding
 * @param {() => number} rng  random numbers for the AI
 * @returns {boolean} true to call
 * Side effects: advances the rng; the room is not changed.
 */
export function botCalls(room, seat, rng) {
  try {
    return aiOf(room, seat).call(aiContext(room, seat, rng)) === true;
  } catch {
    return false;
  }
}

/**
 * The next thing a computer player has to do, or null when the game waits for a person. A decision about the last play
 * comes before a play.
 *
 * @param {object} room  not changed
 * @returns {{ type: 'decide' | 'play', seat: number, key: string } | null} the action, or null when waiting for a person;
 *   `key` names it and stays the same while unrelated things happen (a person accepting the final play, say), so the
 *   server's timer for it is not restarted by them
 * Side effects: none.
 */
export function pendingAction(room) {
  if (!['playing', 'check'].includes(room.phase)) return null;
  if (room.last) {
    const seat = room.seats.findIndex((s, i) => isBot(s) && i !== room.last.seat && !room.decided.includes(i));
    if (seat !== -1) return { type: 'decide', seat, key: `decide:${seat}:${room.plays}` };
  }
  if (room.phase === 'playing' && isBot(room.seats[room.turn])) return { type: 'play', seat: room.turn, key: `play:${room.turn}:${room.plays}` };
  return null;
}

/**
 * Performs a pending action.
 * Side effects: mutates room (a call, a decision or a play).
 *
 * @param {object} room  the room to act on
 * @param {() => number} rng  random numbers for the AI
 * @returns {{ type: string, seat: number } | null} the action done, or null if there was nothing to do
 * @throws {Error} if a computer player's move turns out to be illegal
 */
export function runPending(room, rng) {
  const action = pendingAction(room);
  if (!action) return null;
  let result;
  if (action.type === 'decide') {
    if (botCalls(room, action.seat, rng)) result = callCheat(room, action.seat);
    else {
      room.decided.push(action.seat);
      settleCheck(room);
      result = ok();
    }
  } else result = playCards(room, action.seat, botPlay(room, action.seat, rng));
  if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  return action;
}

// ---- what each player may see ----

/**
 * One occupied seat as the table shows it to everybody.
 *
 * @param {object} room  not changed
 * @param {number} i  the seat's index
 * @param {(id: number) => boolean} online  says who is connected
 * @returns {object} the seat's public details
 * Side effects: none.
 */
function seatView(room, i, online) {
  const seat = room.seats[i];
  const started = room.phase !== 'lobby';
  return {
    seat: i,
    name: seat.name,
    bot: isBot(seat),
    ...(isBot(seat) && started ? { ai: describeAIBrief(aiOf(room, i)) } : {}),
    online: isBot(seat) || (isHuman(seat) && online(seat.id)), // a person who left the finished game is away
    cards: room.hands[i].length,
    ...(started ? { stats: extrasOf(room.tally[i], PUBLIC_KEYS) } : {}),
  };
}

/**
 * The standard scoreboard (shared/scores.js): cards left are the score, so fewer is better, and there are no rounds.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @param {(id: number) => boolean} online  says who is connected
 * @returns {object} the scoreboard
 * Side effects: none.
 */
function scoreboardView(room, me, online) {
  const player = (seat, i) => seatScoreboardEntry(seat, i, { score: room.hands[i].length, me, current: room.phase === 'playing' && room.turn === i, online });
  return { players: room.seats.flatMap((seat, i) => (seat ? [player(seat, i)] : [])), rounds: [], lowIsBetter: true };
}

/**
 * The viewer's hand, the pile (only its size) and the last play and call: what a viewer may see once the game has started.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @returns {object} fields to add to the view when the game has started
 * Side effects: none.
 */
function playView(room, me) {
  const live = ['playing', 'check'].includes(room.phase);
  return {
    hand: me === -1 ? [] : [...room.hands[me]],
    pile: room.pile.length,
    turn: room.turn,
    plays: room.plays,
    rank: live ? rankFor(room.plays) : null,
    last: room.last ? { seat: room.last.seat, count: room.last.count, rank: room.last.rank } : null,
    lastCall: room.lastCall ? { ...room.lastCall, cards: [...room.lastCall.cards] } : null,
    canPlay: room.phase === 'playing' && room.turn === me && me !== -1,
    canCall: live && Boolean(room.last) && me !== -1 && room.last.seat !== me,
    mustRespond: room.phase === 'check' && Boolean(room.last) && me !== -1 && room.last.seat !== me && !room.decided.includes(me),
  };
}

/**
 * Everything one account may know: its own hand and the table as everybody sees it, never anybody else's cards.
 *
 * @param {object} room
 * @param {number} userId  the account looking (it may be a spectator with no seat)
 * @param {{ online?: (id: number) => boolean }} [options]  says who is connected, so the view can show who is away
 * @returns {object} the view sent to that person
 * Side effects: none.
 */
export function viewFor(room, userId, { online = () => true } = {}) {
  const me = seatOf(room, userId);
  const view = {
    code: room.code,
    phase: room.phase,
    you: me,
    hostSeat: seatOf(room, room.hostId),
    seatCount: room.seats.length,
    decks: decksFor(room.seats.length),
    seats: room.seats.map((seat, i) => (seat ? seatView(room, i, online) : null)),
    scoreboard: scoreboardView(room, me, online),
    winner: room.winner,
    limits: { minSeats: MIN_SEATS, maxSeats: MAX_SEATS, maxPlay: MAX_PLAY },
  };
  if (room.phase !== 'lobby') Object.assign(view, playView(room, me));
  return view;
}

/**
 * The id and name of an AI, which is all the table shows of it.
 *
 * @param {object} ai  an AI definition
 * @returns {{ id: string, name: string }} the public part
 * Side effects: none.
 */
const describeAIBrief = (ai) => {
  const { id, name } = describeAI(ai);
  return { id, name };
};
