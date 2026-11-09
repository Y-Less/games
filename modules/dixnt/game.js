// Pure game rules for the Dixnt game.  No networking in here, so it is easy to test.
//
// Round flow:  word -> picking -> voting -> results -> (next round) word ...
//   word        the chooser types a word or phrase
//   picking     everyone except the chooser plays a card; one random player (the imposter) sees "???"
//   voting      all cards and the real word are shown.  The group talks, and anyone can vote at any time
//               (changing their vote until the last vote is in).  The round ends once everyone has voted.
//   results     the imposter is revealed and points are awarded
//
// Three play styles (the 'judging' setting), chosen by the host in the lobby:
//   'everyone'  every player votes.  The group is correct only if the imposter has strictly the most votes (a tie
//               counts as wrong).  If correct, each player who voted for the imposter scores POINTS_PER_VOTE.  If
//               wrong, the imposter scores POINTS_PER_VOTE for each other player who didn't vote for them.
//   'chooser'   only the word-chooser votes.  If they spot the imposter the chooser scores
//               CHOOSER_CORRECT_POINTS; if they are fooled the imposter scores CHOOSER_FOOLED_POINTS.
//   'favourite' no imposter: everybody sees the word, and the chooser just picks the card they like best.  The
//               player who played it scores FAVOURITE_POINTS.
//
// The deck is built from the categories the host selects (cards come in categories; see getCategories below).
//
// Length: the game ends once every player has chosen the word `roundsEach` times (a round only counts as a turn
// once it has been completed).  Then the phase becomes 'finished' and the host can start a new game from the lobby.
//
// A ROOM is a plain object that can be saved as JSON, exactly as in every other game on the site, and the lobby —
// joining, leaving, the host's removals, and the computer players — is the shared player-list code of
// shared/roster.js, driven by shared/roomServer.js.  A person's id in a room IS their account id; a computer
// player's is 'bot:<n>'.  Somebody who leaves a game under way is replaced by a computer player in their place
// (keeping their hand, score, turns, card and vote), and somebody arriving at a game under way — a friend slow to
// open the invitation, or the leaver coming back — takes a computer player's place the same way round.
//
// Randomness: nothing in this file calls Math.random.  Every random choice (shuffles, the imposter, the AIs'
// fallbacks) goes through the `rng` the caller passes, so a test can make a whole game deterministic.
//
// The rules that need to know which cards exist, or what the chooser may be offered, are built by
// createRules({ getCategories, hints }): those come from the server's disk, not from the room.
//
// Depends on: shared/input.js, shared/ai.js, shared/messages.js, shared/scores.js, shared/seats.js,
// shared/roster.js (the lobby and player-list rules), shared/tally.js, ./ai/index.js and ./tally.js.
import { numberFrom, textFrom } from '../../shared/input.js';
import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { msg } from '../../shared/messages.js';
import { standingsOf, winnersOf } from '../../shared/scores.js';
import { fail, hostInLobby, ok } from '../../shared/seats.js';
import { createRosterRules, hasPlayer, historyView, humans, isBot, isHuman, migratePlayers, seatOf, withSlot } from '../../shared/roster.js';
import { statsRows } from '../../shared/tally.js';
import { AIS, buildCardInfo } from './ai/index.js';
import { newCounters, statsExtras, tallyRound } from './tally.js';

export const POINTS_PER_VOTE = 1;
export const CHOOSER_CORRECT_POINTS = 1;
export const CHOOSER_FOOLED_POINTS = 5;
export const FAVOURITE_POINTS = 2;
export const JUDGING_MODES = ['everyone', 'chooser', 'favourite'];
export const MIN_ROUNDS_EACH = 1;
export const MAX_ROUNDS_EACH = 10;
export const DEFAULT_ROUNDS_EACH = 2;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;
export const MIN_HAND_SIZE = 3;
export const MAX_HAND_SIZE = 12;
export const DEFAULT_HAND_SIZE = 8;
export const MAX_WORD_LENGTH = 60;

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kit', 'Luna'];
/** Used only if the word list is empty, so a computer chooser can always give a word. */
const FALLBACK_WORDS = ['Journey', 'Secret', 'Midnight', 'Garden'];

/** The phases in which a round is under way (or its results are showing). */
const ROUND_PHASES = ['word', 'picking', 'voting', 'results'];
/** Every phase but 'finished': the lobby counts as live, because people are still arriving. */
const LIVE = ['lobby', ...ROUND_PHASES];

/**
 * A table keyed by player id, keyed by slot instead: what the scoreboard history is written with.
 *
 * Object keys are text, and a person's id is a number while a computer player's is a string, so the comparison is
 * made on the text of both.  Anybody no longer at the table is left out.
 *
 * @param {object} room   not changed
 * @param {object} table  a table keyed by player id
 * @returns {object} the same values, keyed by slot
 * Side effects: none.
 */
function bySlot(room, table) {
  const slotOfId = new Map(room.players.map((p) => [String(p.id), p.slot]));
  return Object.fromEntries(Object.entries(table ?? {}).flatMap(([id, value]) => (slotOfId.has(id) ? [[slotOfId.get(id), value]] : [])));
}

// The player-list vocabulary (who is in the room, and who is a person) is shared with Just One, Wavelength and Tints
// and Hints.
export { hasPlayer, humans, isBot, isHuman, seatOf };

/**
 * Is the game still going (or still in the lobby)?
 *
 * @param {object} room  not changed
 * @returns {boolean} false once it has finished
 * Side effects: none.
 */
export const isLive = (room) => LIVE.includes(room.phase);

/**
 * Shuffles an array in place (Fisher-Yates).
 *
 * @param {any[]} items        the array to shuffle
 * @param {() => number} rng   a random number generator returning [0, 1); there is no default, so a game's rules can
 *                             never reach for Math.random behind a test's back
 * @returns {any[]} the same array, shuffled
 * Side effects: reorders `items`.
 */
export function shuffle(items, rng) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * The player with this id, or undefined.
 *
 * @param {object} room  not changed
 * @param {number | string} id  an account id or a computer player's id
 * @returns {object | undefined} the player
 * Side effects: none.
 */
export const playerOf = (room, id) => room.players.find((p) => p.id === id);

/**
 * Players who play a card this round: everyone except the chooser.
 *
 * @param {object} room  not changed
 * @returns {object[]} the players
 * Side effects: none.
 */
export const cardPlayers = (room) => room.players.filter((p) => p.id !== room.chooserId);

/**
 * The players whose votes are needed before the round can end: everybody, or the chooser alone.
 *
 * @param {object} room  not changed
 * @returns {object[]} the players
 * Side effects: none.
 */
export const voters = (room) => (room.judging === 'everyone' ? room.players : room.players.filter((p) => p.id === room.chooserId));

/**
 * Is the round waiting for this player to do something?  The chooser while the word is chosen, everybody still to play
 * a card, then everybody still to vote.  The scoreboard shows it as `current` and the site's `global.slow` clock
 * reads it, so it must mean "it is your move", not "it is your round".
 *
 * @param {object} room  not changed
 * @param {object} p  a player
 * @returns {boolean}
 * Side effects: none.
 */
export function mustAct(room, p) {
  if (room.phase === 'word') return p.id === room.chooserId;
  if (room.phase === 'picking') return p.id !== room.chooserId && !(p.id in room.picks);
  if (room.phase === 'voting') return voters(room).some((x) => x.id === p.id) && !(p.id in room.votes);
  return false;
}

/**
 * Everyone sharing the highest score.
 *
 * @param {object} room  not changed
 * @returns {Array<number | string>} player ids
 * Side effects: none.
 */
export function winnerIds(room) {
  // winnersOf gives back the keys of the table it was handed, which are text; the players carry the real ids.
  const best = winnersOf(Object.fromEntries(room.players.map((p) => [p.id, p.score])));
  return room.players.filter((p) => best.includes(String(p.id))).map((p) => p.id);
}

/**
 * Players best first; tied scores share a placement and every tied leader wins.
 *
 * @param {object} room  not changed
 * @returns {object[]} copies of the players with `placement` and `winner`
 * Side effects: none.
 */
export const standings = (room) => standingsOf(room.players);

/**
 * The statistics for a finished game, in the shape of ctx.stats.record.  Computer players are not accounts: people only.
 * The counters are kept on the players themselves, so a person who left (and whose place a computer player took) is
 * simply not there, exactly as their score is not.
 *
 * @param {object} room  a finished room (not changed)
 * @returns {{ userId: number, outcome: string, placement: number, score: number, extras: object }[]}
 * Side effects: none.
 */
export function statsPlayers(room) {
  return statsRows(standings(room), (p) => ({
    outcome: p.winner ? 'win' : 'loss',
    placement: p.placement,
    score: p.score,
    extras: statsExtras(p, { players: room.players.length, score: p.score }),
  }));
}

/**
 * Builds the rules that need to know what is on disk: which cards exist (grouped into categories) and the word
 * suggestions the chooser may be offered.  Everything else in this file is a plain function of the room.
 *
 * @param {object} [options]
 * @param {() => {key: string, label: *, description?: string, ids: number[]}[]} [options.getCategories]  the cards
 *        currently available, grouped into categories
 * @param {() => number[]} [options.getCardIds]  shortcut for a single category holding every card
 * @param {string[]} [options.hints]  word and phrase suggestions for the chooser
 * @returns {object} the rules module shared/roomServer.js drives, plus Dixnt's own actions
 * Side effects: none (the rules it returns mutate the rooms they are given).
 */
export function createRules({ getCategories, getCardIds, hints = [] } = {}) {
  const categoriesOf = getCategories ?? (() => [{ key: 'all', label: msg('lobby.allCards'), description: '', ids: getCardIds ? getCardIds() : [] }]);

  // The suggestions not yet given out, one pool per room so that two tables are not offered the same word at once.
  // It is held here rather than in the room because it is worth nothing after a restart and would bloat every save;
  // a room that is forgotten takes its pool with it.
  const hintPools = new WeakMap();

  // ---------- the deck ----------

  /**
   * The categories the host has selected, in the standard order.
   * @param {object} room  not changed
   * @returns {object[]} the categories
   * Side effects: none.
   */
  const selectedCategories = (room) => categoriesOf().filter((c) => room.categories.includes(c.key));

  /**
   * Ids of every card in the selected categories.
   * @param {object} room  not changed
   * @returns {number[]} the card ids, each one once
   * Side effects: none.
   */
  const availableIds = (room) => [...new Set(selectedCategories(room).flatMap((c) => c.ids))];

  /**
   * Makes sure the saved settings are valid for the categories that exist now.
   * @param {object} room  the room to tidy
   * @returns {void}
   * Side effects: may reset room.judging and room.categories.
   */
  function normaliseSettings(room) {
    if (!JUDGING_MODES.includes(room.judging)) room.judging = 'everyone';
    const known = categoriesOf().map((c) => c.key);
    const chosen = Array.isArray(room.categories) ? room.categories.filter((key) => known.includes(key)) : [];
    room.categories = chosen.length ? chosen : known;
  }

  /**
   * Keeps the deck in step with the cards on disk: new cards join the draw pile, missing ones vanish.
   * @param {object} room  the room to tidy
   * @param {() => number} rng  random source for the shuffle
   * @returns {void}
   * Side effects: edits the draw pile, discard pile, and every hand; may shuffle the draw pile.
   */
  function syncCards(room, rng) {
    const available = new Set(availableIds(room));
    const known = new Set();
    // Keeps a card only if it is still available and not already seen in another pile or hand (drops duplicates).
    const keep = (id) => available.has(id) && !known.has(id) && known.add(id);
    room.draw = room.draw.filter(keep);
    room.discard = room.discard.filter(keep);
    for (const p of room.players) p.hand = p.hand.filter(keep);
    const fresh = [...available].filter((id) => !known.has(id));
    if (room.phase !== 'lobby' && fresh.length) {
      room.draw.push(...fresh);
      shuffle(room.draw, rng);
    }
  }

  /**
   * Deals a player cards until their hand is full, reshuffling the discard pile if the draw pile runs out.
   * @param {object} room  the room to change
   * @param {object} player  the player to deal to
   * @param {() => number} rng  random source for the reshuffle
   * @returns {void}
   * Side effects: moves cards from the draw (and discard) pile into the hand.
   */
  function drawUp(room, player, rng) {
    while (player.hand.length < room.handSize) {
      if (!room.draw.length) {
        if (!room.discard.length) return; // nothing left anywhere
        room.draw = shuffle(room.discard, rng);
        room.discard = [];
      }
      player.hand.push(room.draw.pop());
    }
  }

  // ---------- the room ----------

  /**
   * Gives a bare player ({ kind, id, name }) the fields Dixnt keeps for everybody: the score, how many rounds they
   * have chosen the word for, their hand, and the statistics counters.
   *
   * @param {object} room  not changed (part of the shared makePlayer contract)
   * @param {object} base  { kind: 'human' | 'bot', id, name? }
   * @returns {object} the player
   * Side effects: none.
   */
  const makePlayer = (room, base) => ({ ...base, score: 0, turns: 0, hand: [], ...newCounters() });

  /**
   * Makes a new room with the host in it.
   *
   * @param {object} args
   * @param {string} args.code        the invite code
   * @param {number} args.hostId      the host's account id
   * @param {string} [args.hostName]  the host's display name
   * @param {object} [args.settings]  settings the host chose when creating it; invalid ones are ignored
   * @param {number} args.now         the time to stamp it with
   * @returns {object} the room, in the lobby
   * Side effects: none outside the new room (an invalid setting is silently left at its default).
   */
  function createRoom({ code, hostId, hostName, settings = {}, now }) {
    const room = {
      code,
      hostId,
      phase: 'lobby',
      players: [],
      nextBot: 1, // computer players are players with kind 'bot', an id 'bot:<n>', a name, and (once started) an ai id
      handSize: DEFAULT_HAND_SIZE,
      judging: 'everyone',
      categories: [], // the selected category keys; normaliseSettings fills in "all of them"
      roundsEach: DEFAULT_ROUNDS_EACH, // how many times every player chooses the word
      completed: 0, // rounds finished so far (abandoned rounds don't count)
      // One entry per completed round, oldest first: { label, deltas: { playerId: points }, notes: { playerId: text } }.
      // Shown to everyone as the standard scoreboard.
      history: [],
      pointScale: 1, // 1 when points are the small numbers of today; a game saved with hundreds has none and is scaled down
      round: 0,
      nextChooserIdx: 0,
      chooserId: null,
      draw: [],
      discard: [],
      word: null,
      imposterId: null,
      picks: {}, // playerId -> cardId
      tableOrder: [], // playerIds, shuffled once all cards are in
      votes: {}, // playerId -> playerId
      results: null,
      collectedRound: -1, // the round whose hands have been reported to the `art` achievement (-1: none yet)
      recorded: false,
      createdAt: now,
      updatedAt: now,
    };
    normaliseSettings(room);
    room.players.push(withSlot(room, makePlayer(room, typeof hostName === 'string' ? { kind: 'human', id: hostId, name: hostName } : { kind: 'human', id: hostId })));
    setSettings(room, hostId, settings); // a setting the host got wrong is simply left at its default
    return room;
  }

  /**
   * Brings a saved room up to date: the player list (shared/roster.js), the fields added since it was written, and
   * the deck, which is rebuilt from the cards that are on disk now.  A player left without a hand by an older
   * version (Dixnt used to seat a latecomer as a spectator) is dealt one, so the round cannot stall waiting for a
   * card they could never play.
   *
   * @param {object} room  the room to bring up to date
   * @param {(id: number) => (string | undefined)} [nameOf]  looks up an account's display name
   * @param {() => number} [rng]  random source for the shuffles (Math.random is never used here)
   * @returns {object} the same room
   * Side effects: mutates the room.  Running it twice changes nothing more.
   */
  function migrate(room, nameOf, rng = () => 0.5) {
    migratePlayers(room, nameOf);
    const hadHistory = Array.isArray(room.history);
    if (room.phase === 'discussion') room.phase = 'voting'; // saved by an older version that had a separate step
    delete room.ready; // and by one that waited for everybody to close the scores
    room.picks ??= {};
    room.votes ??= {};
    room.tableOrder ??= [];
    room.draw ??= [];
    room.discard ??= [];
    room.collectedRound ??= -1;
    room.handSize ??= DEFAULT_HAND_SIZE;
    room.roundsEach ??= DEFAULT_ROUNDS_EACH;
    room.completed ??= 0;
    room.round ??= 0;
    room.nextChooserIdx ??= 0;
    if (!Array.isArray(room.history)) room.history = [];
    for (const p of room.players) {
      p.hand ??= [];
      p.score ??= 0;
      p.turns ??= 0;
      delete p.waiting; // a latecomer now takes a computer player's place instead of sitting the round out
      delete p.token; // a person's id is their account id, and a computer player's is 'bot:<n>'
    }
    // A game saved when a vote was worth 100 points (it has no pointScale) is scaled down to the points of today.
    if (room.pointScale === undefined && room.phase !== 'lobby') {
      const scale = (points) => Math.round(points / 100);
      for (const p of room.players) p.score = scale(p.score);
      for (const entry of room.history) for (const id of Object.keys(entry.deltas ?? {})) entry.deltas[id] = scale(entry.deltas[id]);
    }
    room.pointScale = 1;
    // A game saved before the history existed shows the scores it already has as one "Earlier rounds" row.
    if (!hadHistory && room.phase !== 'lobby' && room.players.some((p) => p.score)) {
      room.history.push({ label: msg('round.earlier'), deltas: Object.fromEntries(room.players.map((p) => [p.slot, p.score])), notes: {} });
    }
    normaliseSettings(room);
    syncCards(room, rng);
    if (ROUND_PHASES.includes(room.phase)) for (const p of room.players) drawUp(room, p, rng);
    return room;
  }

  // ---------- the lobby ----------

  /**
   * Renames one player's id everywhere this game writes one down: who is choosing the word, who the imposter is, who
   * played which card, the order the cards lie in, every vote (both who cast it and who it names), and the results
   * on show.  A place changes hands in both directions — a computer player takes a person's, and a latecomer takes a
   * computer player's — and both are this same renaming.
   *
   * The scoreboard history is deliberately not among them: it is written by slot, and the slot goes with the place,
   * so a finished round is never rewritten.
   *
   * @param {object} room  the room to change
   * @param {number | string} from  the id leaving
   * @param {number | string} to  the id taking its place
   * @returns {void}
   * Side effects: mutates the room's own fields and its scoreboard history.
   */
  function renameId(room, from, to) {
    const renamed = (x) => (x === from ? to : x);
    // An object keyed by player id has string keys, so the id is matched by its text and put back as it is given.
    const rekey = (table, mapValue = (v) => v) => {
      const out = {};
      for (const [key, value] of Object.entries(table ?? {})) out[String(key) === String(from) ? to : key] = mapValue(value);
      return out;
    };
    room.chooserId = renamed(room.chooserId);
    room.imposterId = renamed(room.imposterId);
    room.tableOrder = room.tableOrder.map(renamed);
    room.picks = rekey(room.picks);
    room.votes = rekey(room.votes, renamed);
    if (room.results) {
      room.results.imposterId = renamed(room.results.imposterId);
      if ('accusedId' in room.results) room.results.accusedId = renamed(room.results.accusedId);
      if ('winnerId' in room.results) room.results.winnerId = renamed(room.results.winnerId);
      room.results.tally = rekey(room.results.tally);
      room.results.deltas = rekey(room.results.deltas);
      room.results.votes = rekey(room.results.votes, renamed);
    }
  }

  /**
   * Dixnt's part of a computer player taking the place of a person who left a game under way (the roster has already
   * put it in the list, with the person's hand, score, turns and counters): it gets an AI, and everything that named
   * the person now names it, so the card they played and the vote they cast still stand.  Whatever it now has to do
   * is picked up by pendingBotAction.
   *
   * @param {object} room  the room to change
   * @param {number} oldId  the account id of the person who left
   * @param {object} bot  the computer player now in their place
   * @param {() => number} rng  random source for the AI
   * @returns {void}
   * Side effects: mutates the room (the bot, and every field that named the person).
   */
  function takeOver(room, oldId, bot, rng) {
    bot.ai = pickAI(AIS, rng).id;
    renameId(room, oldId, bot.id);
  }

  /**
   * The mirror of takeOver: somebody arriving has taken a computer player's place, so the game is theirs to play from
   * here.  The roster has already taken the AI off; everything the computer player's id was written in now names them.
   *
   * @param {object} room  the room to change
   * @param {string} botId  the computer player whose place was taken
   * @param {object} person  the newcomer, already in its place in the list
   * @returns {void}
   * Side effects: mutates the room (as renameId).
   */
  function handOver(room, botId, person) {
    renameId(room, botId, person.id);
  }

  /**
   * The lobby, joining, leaving, and computer-player rules, from shared/roster.js.
   * Side effects: each rule it provides mutates the room's player list.
   */
  const roster = createRosterRules({
    isLive,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    botNames: BOT_NAMES,
    makePlayer,
    takeOver,
    handOver,
  });

  // ---------- settings ----------

  /**
   * The host changes the settings.  Only the settings that are given are changed, and the first one that is wrong
   * stops the lot, so the room is never left half changed.
   *
   * @param {object} room  the room to change
   * @param {number} id  who is asking (must be the host)
   * @param {object} [settings]  { handSize?, roundsEach?, judging?, categories? }
   * @returns {{ ok: boolean, error?: string, params?: object }}
   * Side effects: may change room.handSize, room.roundsEach, room.judging and room.categories.
   */
  function setSettings(room, id, settings = {}) {
    const refused = hostInLobby(room, id);
    if (refused) return refused;
    const wanted = {};
    if (settings.handSize !== undefined) {
      const n = Math.round(numberFrom(settings.handSize));
      if (!(n >= MIN_HAND_SIZE && n <= MAX_HAND_SIZE)) return fail('handSizeRange', { min: MIN_HAND_SIZE, max: MAX_HAND_SIZE });
      wanted.handSize = n;
    }
    if (settings.roundsEach !== undefined) {
      const n = Math.round(numberFrom(settings.roundsEach));
      if (!(n >= MIN_ROUNDS_EACH && n <= MAX_ROUNDS_EACH)) return fail('turnsEach', { min: MIN_ROUNDS_EACH, max: MAX_ROUNDS_EACH });
      wanted.roundsEach = n;
    }
    if (settings.judging !== undefined) {
      if (!JUDGING_MODES.includes(settings.judging)) return fail('unknownJudging');
      wanted.judging = settings.judging;
    }
    if (settings.categories !== undefined) {
      const known = categoriesOf();
      const keys = [...new Set(Array.isArray(settings.categories) ? settings.categories : [])];
      if (keys.some((key) => !known.some((c) => c.key === key))) return fail('unknownCategory');
      if (!keys.length) return fail('needCategory');
      wanted.categories = known.filter((c) => keys.includes(c.key)).map((c) => c.key); // keep the standard order
    }
    Object.assign(room, wanted);
    return ok();
  }

  // ---------- starting and ending ----------

  /**
   * The host starts the game: builds and shuffles the deck, resets everyone, deals the computer players their AIs,
   * and begins the first round.
   *
   * @param {object} room  the room to change
   * @param {number} id  who is asking (must be the host)
   * @param {() => number} rng  random source for the deck, the AIs and the imposter
   * @returns {{ ok: boolean, error?: string, params?: object }}
   * Side effects: resets scores, turns, hands, counters, history, and the deck, and enters the 'word' phase.
   */
  function start(room, id, rng) {
    if (id !== room.hostId) return fail('hostOnlyStart');
    if (room.phase !== 'lobby') return fail('alreadyStarted');
    if (room.players.length < MIN_PLAYERS) return fail('minPlayers', { min: MIN_PLAYERS });
    normaliseSettings(room);
    const cardIds = availableIds(room);
    if (cardIds.length < room.players.length * room.handSize) return fail('notEnoughCards');
    room.draw = shuffle([...cardIds], rng);
    room.discard = [];
    for (const p of room.players) Object.assign(p, { hand: [], score: 0, turns: 0 }, newCounters());
    room.history = [];
    room.round = 0;
    room.completed = 0;
    room.nextChooserIdx = 0;
    room.recorded = false;
    room.collectedRound = -1;
    // Every computer player gets an AI for the whole game.
    const bots = room.players.filter(isBot);
    const picks = assignAIs(AIS, bots.map((p) => p.id), rng);
    for (const p of bots) p.ai = picks[p.id];
    startRound(room, rng);
    return ok();
  }

  /**
   * Sends everyone back to the lobby, clearing the game (the settings and the players are kept).  It is the shared
   * "play again" event, and the host's "End the game" button is the same thing in the middle of one.
   *
   * @param {object} room  the room to change
   * @param {number | null} [id]  who is asking (must be the host); null when the rules do it themselves
   * @returns {{ ok: boolean, error?: string }}
   * Side effects: resets the round, the deck, scores, hands, counters, and history.
   */
  function playAgain(room, id = null) {
    if (id !== null && id !== room.hostId) return fail('hostOnlyEnd');
    if (room.phase === 'lobby') return fail('alreadyInLobby');
    Object.assign(room, {
      phase: 'lobby',
      round: 0,
      completed: 0,
      history: [],
      chooserId: null,
      draw: [],
      discard: [],
      word: null,
      imposterId: null,
      picks: {},
      tableOrder: [],
      votes: {},
      results: null,
      recorded: false,
      collectedRound: -1,
    });
    for (const p of room.players) {
      Object.assign(p, { hand: [], turns: 0, score: 0 }, newCounters());
      if (isBot(p)) delete p.ai; // a new AI is dealt at the next start
    }
    return ok();
  }

  // ---------- round flow ----------

  /**
   * Begins a round: the next chooser is picked and everybody's hand is topped up.
   *
   * @param {object} room  the room to change
   * @param {() => number} rng  random source for the shuffles
   * @returns {void}
   * Side effects: increments room.round, picks room.chooserId, clears the table, and enters the 'word' phase.
   */
  function startRound(room, rng) {
    syncCards(room, rng);
    room.round++;
    // Normally just the next player in join order; anyone who has already had all their turns is skipped while
    // somebody else still owes some (this happens after skipped rounds).
    const owes = (player) => (player.turns ?? 0) < room.roundsEach;
    const someoneOwes = room.players.some(owes);
    let idx = room.nextChooserIdx % room.players.length;
    for (let step = 0; step < room.players.length; step++) {
      const candidate = (room.nextChooserIdx + step) % room.players.length;
      if (!someoneOwes || owes(room.players[candidate])) {
        idx = candidate;
        break;
      }
    }
    room.chooserId = room.players[idx].id;
    room.nextChooserIdx = idx + 1;
    Object.assign(room, { word: null, imposterId: null, picks: {}, tableOrder: [], votes: {}, results: null });
    for (const p of room.players) drawUp(room, p, rng);
    room.phase = 'word';
  }

  /**
   * Abandons the current round without scoring or discarding, and moves to the next chooser.
   *
   * @param {object} room  the room to change
   * @param {number} id  who is asking (must be the host)
   * @param {() => number} rng  random source for the next round
   * @returns {{ ok: boolean, error?: string }}
   * Side effects: starts a new round.
   */
  function abortRound(room, id, rng) {
    if (id !== room.hostId) return fail('hostOnlySkip');
    if (!['word', 'picking', 'voting'].includes(room.phase)) return fail('noRoundToSkip');
    startRound(room, rng);
    return ok();
  }

  /**
   * Suggestions for the chooser, without repeats until the list has been used up.
   *
   * @param {object} room  the room they are for (its pool is kept here, not saved with it)
   * @param {number} count  how many to give
   * @param {() => number} rng  random source for the shuffle
   * @returns {string[]} up to `count` hints (fewer if the list is shorter)
   * Side effects: takes the hints out of the room's pool, refilling (and shuffling) it when it runs low.
   */
  function nextHints(room, count, rng) {
    let pool = hintPools.get(room) ?? [];
    if (pool.length < count) pool = shuffle([...hints], rng);
    const taken = pool.splice(-count, count);
    hintPools.set(room, pool);
    return taken;
  }

  /**
   * The chooser gives the word; the imposter is picked (except in the favourite style) and card-playing begins.
   *
   * @param {object} room  the room to change
   * @param {number | string} id  who is asking (must be the chooser)
   * @param {string} word  the word or phrase
   * @param {() => number} rng  random source for the imposter
   * @returns {{ ok: boolean, error?: string, params?: object }}
   * Side effects: sets room.word and room.imposterId and enters the 'picking' phase (nothing is changed on a refusal).
   */
  function submitWord(room, id, word, rng) {
    if (room.phase !== 'word') return fail('notTimeToChooseWord');
    if (id !== room.chooserId) return fail('chooserOnlyWord');
    const clean = textFrom(word).trim().replace(/\s+/g, ' ');
    if (!clean) return fail('typeWord');
    if (clean.length > MAX_WORD_LENGTH) return fail('wordTooLong', { max: MAX_WORD_LENGTH });
    const candidates = cardPlayers(room);
    if (!candidates.length) return fail('nobodyToPlay');
    room.word = clean;
    // In the favourite style nobody is kept in the dark, so there is no imposter.
    room.imposterId = room.judging === 'favourite' ? null : candidates[Math.floor(rng() * candidates.length)].id;
    room.phase = 'picking';
    return ok();
  }

  /**
   * A player puts a card from their hand on the table.  When the last card is down, voting opens.
   *
   * @param {object} room  the room to change
   * @param {number | string} id  who is playing
   * @param {number} cardId  the card to play
   * @param {() => number} rng  random source for the order the cards are laid out in
   * @returns {{ ok: boolean, error?: string }}
   * Side effects: records the pick (a player may change it until the last card is in) and may open voting.
   */
  function playCard(room, id, cardId, rng) {
    if (room.phase !== 'picking') return fail('notTimeToPlay');
    const player = playerOf(room, id);
    if (!player) return fail('notInGame');
    if (id === room.chooserId) return fail('notPlayingThisRound');
    if (!player.hand.includes(cardId)) return fail('notInHand');
    room.picks[id] = cardId;
    if (cardPlayers(room).every((p) => p.id in room.picks)) openVoting(room, rng);
    return ok();
  }

  /**
   * Lays the cards out in a random order and opens voting.
   *
   * @param {object} room  the room to change
   * @param {() => number} rng  random source for the order
   * @returns {void}
   * Side effects: sets room.tableOrder, clears room.votes, and enters the 'voting' phase.
   */
  function openVoting(room, rng) {
    room.tableOrder = shuffle(cardPlayers(room).map((p) => p.id), rng);
    room.votes = {};
    room.phase = 'voting';
  }

  /**
   * A player votes (or changes their vote).  When the last needed vote is in, the round is resolved.
   *
   * @param {object} room  the room to change
   * @param {number | string} id  the voter
   * @param {number | string} targetId  whose card they suspect (or, when favouring, like best)
   * @returns {{ ok: boolean, error?: string }}
   * Side effects: records the vote and may resolve the round.
   */
  function vote(room, id, targetId) {
    if (room.phase !== 'voting') return fail('notTimeToVote');
    if (!playerOf(room, id)) return fail('notInGame');
    if (room.judging !== 'everyone' && id !== room.chooserId) return fail('chooserOnlyVotes');
    if (id === targetId) return fail('voteSelf');
    if (!cardPlayers(room).some((p) => p.id === targetId)) return fail('voteCardPlayer');
    room.votes[id] = targetId;
    if (voters(room).every((p) => p.id in room.votes)) resolveVotes(room);
    return ok();
  }

  /**
   * Scores the round according to the play style (everyone, chooser, or favourite) and shows the results.
   *
   * @param {object} room  the room to change
   * @returns {void}
   * Side effects: changes scores, room.results, the counters, the history, the chooser's turns, and enters 'results'.
   */
  function resolveVotes(room) {
    if (room.judging === 'chooser') return resolveChooserVerdict(room);
    if (room.judging === 'favourite') return resolveFavourite(room);
    const tally = Object.fromEntries(cardPlayers(room).map((p) => [p.id, 0]));
    for (const target of Object.values(room.votes)) tally[target]++;

    const imposterVotes = tally[room.imposterId];
    // Read off the players rather than the table's keys, which are text: the id itself is a number for a person.
    const bestOther = Math.max(0, ...cardPlayers(room).filter((p) => p.id !== room.imposterId).map((p) => tally[p.id]));
    const groupCorrect = imposterVotes > bestOther;

    const deltas = Object.fromEntries(room.players.map((p) => [p.id, 0]));
    const guessers = room.players.filter((p) => p.id !== room.imposterId);
    if (groupCorrect) {
      for (const guesser of guessers) {
        if (room.votes[guesser.id] === room.imposterId) deltas[guesser.id] = POINTS_PER_VOTE;
      }
    } else {
      const fooled = guessers.filter((v) => room.votes[v.id] !== room.imposterId).length;
      deltas[room.imposterId] = fooled * POINTS_PER_VOTE;
    }
    for (const p of room.players) p.score += deltas[p.id];

    const notes = roundNotes(room, { judging: 'everyone', groupCorrect });
    room.results = { judging: 'everyone', imposterId: room.imposterId, groupCorrect, tally, deltas, votes: { ...room.votes } };
    completeRound(room, notes);
  }

  /**
   * Chooser-only judging: spot the imposter and the chooser scores; get fooled and the imposter scores big.
   *
   * @param {object} room  the room to change
   * @returns {void}
   * Side effects: as resolveVotes.
   */
  function resolveChooserVerdict(room) {
    const accusedId = room.votes[room.chooserId];
    const groupCorrect = accusedId === room.imposterId; // here it means "the judge was correct"
    const deltas = Object.fromEntries(room.players.map((p) => [p.id, 0]));
    if (groupCorrect) deltas[room.chooserId] = CHOOSER_CORRECT_POINTS;
    else deltas[room.imposterId] = CHOOSER_FOOLED_POINTS;
    for (const p of room.players) p.score += deltas[p.id];

    const notes = roundNotes(room, { judging: 'chooser', groupCorrect });
    const tally = Object.fromEntries(cardPlayers(room).map((p) => [p.id, p.id === accusedId ? 1 : 0]));
    room.results = { judging: 'chooser', imposterId: room.imposterId, accusedId, groupCorrect, tally, deltas, votes: { ...room.votes } };
    completeRound(room, notes);
  }

  /**
   * Favourite style: the chooser's favourite card scores, and nobody was bluffing.
   *
   * @param {object} room  the room to change
   * @returns {void}
   * Side effects: as resolveVotes.
   */
  function resolveFavourite(room) {
    const winnerId = room.votes[room.chooserId];
    const deltas = Object.fromEntries(room.players.map((p) => [p.id, 0]));
    deltas[winnerId] = FAVOURITE_POINTS;
    for (const p of room.players) p.score += deltas[p.id];

    const notes = roundNotes(room, { judging: 'favourite', winnerId });
    const tally = Object.fromEntries(cardPlayers(room).map((p) => [p.id, p.id === winnerId ? 1 : 0]));
    room.results = { judging: 'favourite', imposterId: null, winnerId, groupCorrect: null, tally, deltas, votes: { ...room.votes } };
    completeRound(room, notes);
  }

  /**
   * Short public remarks for the scoreboard: who chose the word, who was the imposter and how it went.
   *
   * @param {object} room  not changed
   * @param {object} outcome
   * @param {string} outcome.judging         the play style
   * @param {boolean} [outcome.groupCorrect] whether the imposter was caught
   * @param {*} [outcome.winnerId]           the favourite style's winner
   * @returns {Object<string, object>} playerId -> remark (a message, see shared/messages.js)
   * Side effects: none.
   */
  function roundNotes(room, { judging, groupCorrect, winnerId }) {
    const notes = {};
    if (room.chooserId !== null) notes[room.chooserId] = msg('notes.chooser');
    if (judging === 'favourite') {
      // The chooser never plays a card, so the only remark the winner can already have is the chooser's own.
      if (winnerId !== undefined && winnerId !== null) notes[winnerId] = notes[winnerId] ? msg('notes.chooserCardPicked') : msg('notes.cardPicked');
    } else if (room.imposterId !== null) {
      notes[room.imposterId] = msg(groupCorrect ? 'notes.imposterCaught' : 'notes.imposterFooledAll');
      if (judging === 'chooser') notes[room.chooserId] = msg(groupCorrect ? 'notes.chooserSpotted' : 'notes.chooserFooled');
    }
    return notes;
  }

  /**
   * Records a finished round (abandoned rounds never get here): it counts as a turn for the chooser, is counted
   * towards everybody's statistics, goes into the scoreboard history, and the results are shown.
   *
   * @param {object} room  the room to change
   * @param {Object<string, object>} [notes]  the scoreboard remarks from roundNotes (messages)
   * @returns {void}
   * Side effects: increments the chooser's turns and room.completed, bumps the counters, adds a history row, and
   * enters 'results'.
   */
  function completeRound(room, notes = {}) {
    const chooser = playerOf(room, room.chooserId);
    if (chooser) chooser.turns = (chooser.turns ?? 0) + 1;
    countRound(room);
    room.completed++;
    // `room.results` is the round on show and stays keyed by player id, because that is what the table is drawing and
    // renameId keeps it straight.  The history row is keyed by slot instead, so that it is written once and never
    // touched again; viewFor sends it back out by id (shared/roster.js historyView).
    room.history.push({ label: msg('round.label', { n: room.completed }), deltas: bySlot(room, room.results.deltas), notes: bySlot(room, notes) });
    room.phase = 'results';
  }

  /**
   * Counts the round just resolved towards each person's statistics.  Everything is read off the players, so the ids
   * handed to the tally are the real ones (a table keyed by player id has text keys, and a person's id is a number).
   *
   * @param {object} room  the room whose counters are bumped
   * @returns {void}
   * Side effects: increments the counters on the people in the room (computer players keep none).
   */
  function countRound(room) {
    // The counters live on the player; a computer player's are not recorded, so it is told to skip them.
    const counterOf = (id) => {
      const player = playerOf(room, id);
      return player && !isBot(player) ? player : null;
    };
    const pickers = room.players.filter((p) => p.id in room.picks).map((p) => p.id);
    const votes = room.players.filter((p) => p.id in room.votes).map((p) => [p.id, room.votes[p.id]]);
    tallyRound(counterOf, { pickers, votes, results: room.results });
  }

  /**
   * Leaves the results: the played cards are discarded and the next round (or the end of the game) begins.
   *
   * @param {object} room  the room to change
   * @param {number | string} id  who is asking (anybody in the room)
   * @param {() => number} rng  random source for the next round
   * @returns {{ ok: boolean, error?: string }}
   * Side effects: moves cards to the discard pile, then starts a round or finishes the game.
   */
  function nextRound(room, id, rng) {
    if (room.phase !== 'results') return fail('roundNotOver');
    if (!playerOf(room, id)) return fail('notInGame');
    // Played cards go to the discard pile; startRound() then tops everyone's hand back up.
    for (const p of room.players) {
      const cardId = room.picks[p.id];
      if (cardId === undefined) continue;
      p.hand = p.hand.filter((c) => c !== cardId);
      room.discard.push(cardId);
    }
    if (allDone(room)) room.phase = 'finished';
    else startRound(room, rng);
    return ok();
  }

  // ---------- computer players ----------

  /**
   * The next thing a computer player has to do, or null: { type: 'word' | 'card' | 'vote', id }.  Computer players
   * never start the game or move on from the results: the host does that, so they can never hold a game up.
   *
   * @param {object} room  not changed
   * @returns {{ type: 'word' | 'card' | 'vote', id: number | string } | null}
   * Side effects: none.
   */
  function pendingBotAction(room) {
    if (room.phase === 'word') {
      const chooser = playerOf(room, room.chooserId);
      return chooser && isBot(chooser) ? { type: 'word', id: chooser.id } : null;
    }
    if (room.phase === 'picking') {
      const bot = cardPlayers(room).find((p) => isBot(p) && !(p.id in room.picks) && p.hand.length);
      return bot ? { type: 'card', id: bot.id } : null;
    }
    if (room.phase === 'voting') {
      const bot = voters(room).find((p) => isBot(p) && !(p.id in room.votes));
      return bot ? { type: 'vote', id: bot.id } : null;
    }
    return null;
  }

  /**
   * Asks the AI, and if it answers with something that is not a legal option, makes a random legal choice instead.
   *
   * @param {object} room  not changed
   * @param {object} player  the computer player
   * @param {string} decision  the AI's method to call ('chooseWord', 'playCard' or 'vote')
   * @param {any[]} options  the legal answers
   * @param {object} input  what the AI is told (the game adds the cards, round and judging style)
   * @param {() => number} rng  random source for the AI and the fallback
   * @returns {any} one of `options`
   * Side effects: calls the AI; nothing in the room is changed.
   */
  function botDecide(room, player, decision, options, input, rng) {
    let answer;
    try {
      answer = aiById(AIS, player.ai)[decision]({ ...input, cards: buildCardInfo({ categories: categoriesOf() }), round: room.round, judging: room.judging }, rng);
    } catch {
      answer = undefined; // a broken AI must not stop the game
    }
    return options.includes(answer) ? answer : options[Math.floor(rng() * options.length)];
  }

  /**
   * Plays one pending computer move.  Each decision is made from that player's own view (viewFor), so a computer
   * player knows only what a person in the same place would: its hand, the clue (unless it is the imposter), the table.
   *
   * @param {object} room  the room to change
   * @param {() => number} rng  random source handed to the AI
   * @param {{ type: string, id: number | string } | null} [action]  the move to play (default: whatever is pending)
   * @returns {boolean} false if there was nothing to do
   * Side effects: submits a word, plays a card, or votes, as that player.
   */
  function runBotAction(room, rng, action = pendingBotAction(room)) {
    if (!action) return false;
    const player = playerOf(room, action.id);
    const view = viewFor(room, action.id);
    if (action.type === 'word') {
      const suggestions = nextHints(room, 3, rng);
      const options = suggestions.length ? suggestions : FALLBACK_WORDS;
      return submitWord(room, action.id, botDecide(room, player, 'chooseWord', options, { hints: options, hand: view.me.hand }, rng), rng).ok;
    }
    if (action.type === 'card') {
      const cardId = botDecide(room, player, 'playCard', view.me.hand, { word: view.word, hand: view.me.hand }, rng);
      return playCard(room, action.id, cardId, rng).ok;
    }
    const targetId = botDecide(
      room,
      player,
      'vote',
      view.voteTargets,
      {
        word: view.word,
        table: view.table,
        targets: view.voteTargets,
        me: action.id,
        imposter: room.imposterId === action.id, // it saw ??? instead of the clue, so it knows
        chooser: view.me.isChooser,
        scores: Object.fromEntries(view.players.map((p) => [p.id, p.score])),
      },
      rng,
    );
    return vote(room, action.id, targetId).ok;
  }

  // ---------- what each player is allowed to see ----------

  /**
   * The word as one player may see it: everybody but the imposter sees it while cards are being played, and
   * everybody sees it once the voting starts.
   *
   * @param {object} room  not changed
   * @param {number | string} id  the viewer
   * @param {boolean} member  is the viewer in the room?  Somebody who is not never sees a word still being played for
   * @returns {string | null} the word, or null when this player may not know it (yet)
   * Side effects: none.
   */
  function wordView(room, id, member) {
    const revealed = ['voting', 'results'].includes(room.phase);
    return room.word !== null && (revealed || (room.phase === 'picking' && member && id !== room.imposterId)) ? room.word : null;
  }

  /**
   * The categories the host can pick from, with how many cards each holds and whether it is selected.
   *
   * @param {object} room  not changed
   * @returns {{ key: string, label: *, description: string, count: number, selected: boolean }[]}
   * Side effects: none.
   */
  const categoriesView = (room) =>
    categoriesOf().map((c) => ({ key: c.key, label: c.label, description: c.description ?? '', count: c.ids.length, selected: room.categories.includes(c.key) }));

  /**
   * The viewer's own place: their hand, pick, and vote, and whether they were the imposter (only once that is revealed).
   *
   * @param {object} room  not changed
   * @param {object | undefined} me  the viewer's player, or undefined for somebody who is not in the room
   * @returns {object}
   * Side effects: none.
   */
  function meView(room, me) {
    if (!me) return { id: null, isChooser: false, hand: [], myPick: null, myVote: null, isImposter: false };
    return {
      id: me.id,
      isChooser: me.id === room.chooserId,
      hand: ['lobby', 'finished'].includes(room.phase) ? [] : me.hand,
      myPick: room.picks[me.id] ?? null,
      myVote: room.votes[me.id] ?? null,
      isImposter: room.phase === 'results' && me.id === room.imposterId,
    };
  }

  /**
   * Every player as the table shows them to everybody.
   *
   * @param {object} room  not changed
   * @param {(id: number | string) => boolean} online  is this person connected?
   * @returns {object[]}
   * Side effects: none.
   */
  function playersView(room, online) {
    const inPlay = ['picking', 'voting', 'results'].includes(room.phase);
    return room.players.map((p) => ({
      id: p.id,
      slot: p.slot, // how the client names this place when it asks for somebody to be removed (shared/layout.js)
      name: p.name,
      score: p.score,
      turns: p.turns ?? 0,
      connected: isBot(p) || online(p.id),
      bot: isBot(p), // the client's word for it; the player itself says kind: 'bot'
      ai: p.ai ? aiView(p.ai) : null, // computer players only
      isChooser: p.id === room.chooserId,
      hasPlayed: inPlay && p.id in room.picks,
      hasVoted: room.phase === 'voting' ? p.id in room.votes : false,
    }));
  }

  /**
   * @param {string} aiId  an AI id; one that no longer exists falls back to the first AI
   * @returns {{ id: string, name: string }} how an AI is shown to the players
   * Side effects: none.
   */
  function aiView(aiId) {
    const { id, name } = aiById(AIS, aiId);
    return { id, name };
  }

  /**
   * The standard scoreboard (shared/scores.js): the chooser has the turn.
   *
   * @param {object} room  not changed
   * @param {number | string} id  the viewer
   * @param {(id: number | string) => boolean} online  is this person connected?
   * @returns {object}
   * Side effects: none.
   */
  function scoreboardView(room, id, online) {
    return {
      // A person's id IS their account, which the site needs for name styles and avatars; a computer player has none.
      players: room.players.map((p) => ({
        id: p.id,
        slot: p.slot, // how the client names this place when it asks for somebody to be removed (shared/layout.js)
        name: p.name,
        userId: isBot(p) ? undefined : p.id,
        score: p.score,
        isMe: p.id === id,
        bot: isBot(p),
        current: mustAct(room, p),
        away: !isBot(p) && !online(p.id),
      })),
      rounds: historyView(room),
      lowIsBetter: false,
    };
  }

  /**
   * The cards face up on the table (none while the cards are still being picked) and who this player may vote for.
   *
   * @param {object} room  not changed
   * @param {number | string} id  the viewer
   * @returns {{ table: object[], voteTargets: Array<number | string> }}
   * Side effects: none.
   */
  function tableView(room, id) {
    return {
      table: room.phase === 'picking' ? [] : room.tableOrder.map((pid) => ({ playerId: pid, cardId: room.picks[pid] })),
      voteTargets:
        room.phase === 'voting' && voters(room).some((v) => v.id === id)
          ? cardPlayers(room).filter((p) => p.id !== id).map((p) => p.id)
          : [],
    };
  }

  /**
   * How many more rounds are needed before everyone has had all their turns.
   *
   * @param {object} room  not changed
   * @returns {number}
   * Side effects: none.
   */
  const roundsRemaining = (room) => room.players.reduce((sum, p) => sum + Math.max(0, room.roundsEach - (p.turns ?? 0)), 0);

  /**
   * Has every player chosen the word as many times as the host asked for?
   *
   * @param {object} room  not changed
   * @returns {boolean}
   * Side effects: none.
   */
  const allDone = (room) => room.players.every((p) => (p.turns ?? 0) >= room.roundsEach);

  /**
   * What one player is allowed to see of the game: their own hand, the word (unless they are the imposter while cards
   * are being played), and only the public parts of everything else.
   *
   * @param {object} room  not changed
   * @param {number | string} id  the viewer
   * @param {{ online?: (id: number | string) => boolean }} [options]  who is connected
   * @returns {object} the view sent to that person
   * Side effects: none.
   */
  function viewFor(room, id, { online = () => true } = {}) {
    const me = playerOf(room, id);
    const { table, voteTargets } = tableView(room, id);
    return {
      code: room.code,
      phase: room.phase,
      round: room.round,
      roundsEach: room.roundsEach,
      completedRounds: room.completed,
      totalRounds: room.completed + roundsRemaining(room),
      winners: room.phase === 'finished' ? winnerIds(room) : [],
      handSize: room.handSize,
      chooserId: room.chooserId,
      hostId: room.hostId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      pointsPerVote: POINTS_PER_VOTE,
      pointsChooserCorrect: CHOOSER_CORRECT_POINTS,
      pointsFooledChooser: CHOOSER_FOOLED_POINTS,
      pointsFavourite: FAVOURITE_POINTS,
      judging: room.judging,
      categories: categoriesView(room),
      availableCards: availableIds(room).length,
      drawCount: room.draw.length,
      discardCount: room.discard.length,
      word: wordView(room, id, Boolean(me)),
      wordHidden: room.phase === 'picking' && id === room.imposterId,
      me: meView(room, me),
      players: playersView(room, online),
      scoreboard: scoreboardView(room, id, online),
      table,
      voteTargets,
      results: room.phase === 'results' ? room.results : null,
    };
  }

  return {
    // What shared/roomServer.js asks of a game.
    createRoom,
    migrate,
    viewFor,
    statsPlayers,
    standings,
    isLive,
    isHuman,
    isBot,
    hasPlayer,
    humans,
    seatOf,
    setSettings,
    start,
    playAgain,
    ...roster,
    // Dixnt's own actions and what the server needs to drive its computer players.
    abortRound,
    allDone,
    availableIds,
    cardPlayers,
    mustAct,
    nextHints,
    nextRound,
    pendingBotAction,
    playCard,
    playerOf,
    renameId, // the server needs it to bring games saved before rooms.json over to account ids
    roundsRemaining,
    runBotAction,
    startRound,
    submitWord,
    syncCards, // the deck follows the cards on disk; the tests drive it directly
    vote,
    voters,
    winnerIds,
  };
}
