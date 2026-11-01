// Pure game rules for the Dixnt game. No networking in here, so it is easy to test.
//
// Round flow:  word -> picking -> voting -> results -> (next round) word ...
//   word        the chooser types a word or phrase
//   picking     everyone except the chooser plays a card; one random player (the imposter) sees "???"
//   voting      all cards and the real word are shown. The group talks, and anyone can vote at any time
//               (changing their vote until the last vote is in). The round ends once everyone has voted.
//   results     the imposter is revealed and points are awarded
//
// Three play styles (the 'judging' setting), chosen by the host in the lobby:
//   'everyone'  every player votes. The group is correct only if the imposter has strictly the most votes (a tie
//               counts as wrong). If correct, each player who voted for the imposter scores POINTS_PER_VOTE. If
//               wrong, the imposter scores POINTS_PER_VOTE for each other player who didn't vote for them.
//   'chooser'   only the word-chooser votes. If they spot the imposter the chooser scores
//               CHOOSER_CORRECT_POINTS; if they are fooled the imposter scores CHOOSER_FOOLED_POINTS.
//   'favourite' no imposter: everybody sees the word, and the chooser just picks the card they like best. The
//               player who played it scores FAVOURITE_POINTS.
//
// The deck is built from the categories the host selects (cards come in categories; see getCategories below).
//
// Length: the game ends once every player has chosen the word `roundsEach` times (a round only counts as a turn
// once it has been completed). Then the phase becomes 'finished' and the host can return everyone to the lobby.
//
// Randomness: nothing in this file calls Math.random. Every random choice (shuffles, the imposter, seat ids, the AIs'
// fallbacks) goes through the `rng` the caller passes to the Game, so a test can make a whole game deterministic.
// The server passes Math.random (or its own injected generator); see server.js.
//
// Seats: a seat is { id, kind, token, name, score, turns, hand, waiting, ai? }. `kind` is 'human' (an account) or
// 'bot' (a computer player). Saves from before `kind` existed marked computer players with `bot: true`; the
// constructor migrates those (see migrateSeats), so old saved rooms keep working. The view sent to clients still
// says `bot: true/false` for each seat, because that is the client's vocabulary.

import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { winnersOf } from '../../shared/scores.js';
import { AIS, buildCardInfo } from './ai/index.js';

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
export const MAX_NAME_LENGTH = 20;
export const MAX_WORD_LENGTH = 60;

/** The two kinds of seat. */
export const KIND_HUMAN = 'human';
export const KIND_BOT = 'bot';

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kit', 'Luna'];
/** Used only if the word list is empty, so a computer chooser can always give a word. */
const FALLBACK_WORDS = ['Journey', 'Secret', 'Midnight', 'Garden'];

/** The phases in which a round is under way (or its results are showing), so a seat taken over has something to play. */
const ROUND_PHASES = ['word', 'picking', 'voting', 'results'];

/** The error the rules throw for anything a player did wrong; its message is safe to show to that player. */
export class GameError extends Error {}

/**
 * Refuses an action by throwing a GameError.
 *
 * @param {string} message  what to tell the player
 * @returns {never}
 * Side effects: always throws.
 */
const fail = (message) => {
  throw new GameError(message);
};

/**
 * Is this seat a computer player?
 *
 * @param {object} seat  an entry of state.players
 * @returns {boolean}
  * Side effects: none.
 */
const isBot = (seat) => seat.kind === KIND_BOT;

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
 * Makes a new id for a seat: eight base-36 characters from `rng`, made unique among the ids already taken.
 * A constant (or badly behaved) generator therefore cannot give two seats the same id or hang this function: a
 * clash just gets a counter added.
 *
 * @param {() => number} rng        a random number generator returning [0, 1)
 * @param {Set<string>} [taken]     ids that must not be reused
 * @returns {string}
  * Side effects: advances `rng` only.
 */
export function newPublicId(rng, taken = new Set()) {
  const base = Math.floor(rng() * 36 ** 8).toString(36).padStart(8, '0');
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * The token that identifies an account's seat in a game (a computer player's is 'bot:<n>', which no account's can match).
 *
 * @param {{ id: number }} user  the signed-in account
 * @returns {string} 'user:<id>'
 * Side effects: none.
 */
export const tokenFor = (user) => `user:${user.id}`;

/**
 * The account id inside a seat token.
 *
 * @param {string} token  a seat token
 * @returns {number | null} the account id, or null for a computer player's token
 * Side effects: none.
 */
export const userIdOf = (token) => (/^user:\d+$/.test(token) ? Number(token.slice(5)) : null);

export class Game {
  /**
   * Builds a game, either brand new (in the lobby) or restored from a save.
   *
   * @param {object} options
   * @param {() => {key: string, label: string, description?: string, ids: number[]}[]} [options.getCategories]
   *        the cards currently available, grouped into categories
   * @param {() => number[]} [options.getCardIds] shortcut for a single category containing every card
   * @param {string[]} options.hints word/phrase suggestions for the chooser
   * @param {() => number} options.rng a random number generator returning [0, 1). Required: the rules never use
   *        Math.random themselves.
   * @param {object} [options.saved] a previously saved state (see toJSON)
   * Side effects: migrates and normalises `saved` in place (older saves are brought up to date).
   */
  constructor({ getCategories, getCardIds, hints = [], rng, saved = null }) {
    if (typeof rng !== 'function') throw new TypeError('A Game needs an rng: the rules never use Math.random themselves.');
    this.getCategories =
      getCategories ?? (() => [{ key: 'all', label: 'All cards', description: '', ids: getCardIds ? getCardIds() : [] }]);
    this.hints = hints;
    this.rng = rng;
    this.hintPool = [];
    this.s = { ...Game.blankState(), ...(saved ?? {}) };
    this.migrateSeats();
    this.rescaleOldPoints(saved);
    this.normaliseHistory(saved);
    if (this.s.phase === 'discussion') this.s.phase = 'voting'; // saved by an older version that had a separate step
    delete this.s.ready;
    this.normaliseSettings();
    this.syncCards();
  }

  /**
   * The state of a game nobody has joined yet.
   *
   * @returns {object} a fresh state object (see toJSON)
    * Side effects: none.
   */
  static blankState() {
    return {
      phase: 'lobby',
      // { id, kind: 'human' | 'bot', token, name, score, turns, hand: number[], waiting: boolean, ai?: string }. A
      // computer player has kind 'bot', no account (its token is 'bot:<n>', which no user token can match) and, once a
      // game starts, the id of its AI.
      players: [],
      nextBot: 1,
      hostId: null,
      handSize: DEFAULT_HAND_SIZE,
      judging: 'everyone',
      categories: null, // selected category keys; null means "all of them"
      roundsEach: DEFAULT_ROUNDS_EACH, // how many times every player chooses the word
      completed: 0, // rounds finished so far (abandoned rounds don't count)
      // One entry per completed round, oldest first: { label, deltas: { playerId: points }, notes: { playerId: text } }.
      // Shown to everyone as the standard scoreboard. A player who leaves is removed from every entry, so the
      // table always adds up to the scores of the players still in the game.
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
    };
  }

  /**
   * Brings the seats of an older save up to date: a seat marked `bot: true` becomes `kind: 'bot'`, and every other
   * seat becomes `kind: 'human'`. Safe to run on seats that are already migrated.
   *
   * @returns {void}
   * Side effects: edits the seat objects in this.s.players (removing the old `bot` flag).
   */
  migrateSeats() {
    for (const p of this.s.players) {
      if ('bot' in p) {
        if (p.bot) p.kind = KIND_BOT;
        delete p.bot;
      }
      p.kind ??= KIND_HUMAN;
    }
  }

  /**
   * A game saved when a vote was worth 100 points (it has no pointScale) is scaled down to the points of today.
   *
   * @param {object | null} saved  the save the game was built from (null for a new game)
   * @returns {void}
   * Side effects: rewrites the scores and the history deltas.
   */
  rescaleOldPoints(saved) {
    if (!saved || saved.pointScale !== undefined || saved.phase === 'lobby') return;
    // Converts an old hundreds-based point total to today's scale.
    const scale = (points) => Math.round(points / 100);
    for (const p of this.s.players) p.score = scale(p.score);
    for (const entry of this.s.history ?? []) for (const id of Object.keys(entry.deltas ?? {})) entry.deltas[id] = scale(entry.deltas[id]);
  }

  /**
   * Older saved games have no history: if they already have scores, show them as one "Earlier rounds" row.
   *
   * @param {object | null} saved  the save the game was built from (null for a new game)
   * @returns {void}
   * Side effects: sets this.s.history.
   */
  normaliseHistory(saved) {
    const s = this.s;
    if (Array.isArray(saved?.history)) return;
    s.history = [];
    if (s.phase !== 'lobby' && s.players.some((p) => p.score)) {
      s.history.push({ label: 'Earlier rounds', deltas: Object.fromEntries(s.players.map((p) => [p.id, p.score])), notes: {} });
    }
  }

  /**
   * What gets saved to disk (JSON.stringify calls this).
   *
   * @returns {object} the live state object, not a copy
    * Side effects: none.
   */
  toJSON() {
    return this.s;
  }

  // ---------- lookups ----------

  /**
   * @param {string} id  a seat id
   * @returns {object | null} the seat, or null if nobody has that id
   * Side effects: none.
   */
  player(id) {
    return this.s.players.find((p) => p.id === id) ?? null;
  }

  /**
   * @param {string} token  an account token ('user:<id>') or a computer player's token
   * @returns {object | null} the seat with that token, or null
    * Side effects: none.
   */
  findByToken(token) {
    return this.s.players.find((p) => p.token === token) ?? null;
  }

  /**
   * @param {string} id  a seat id
   * @returns {object} the seat
   * Side effects: throws a GameError if there is no such seat.
   */
  requirePlayer(id) {
    return this.player(id) ?? fail('You are not in this game.');
  }

  /**
   * @param {string} id  a seat id
   * @returns {boolean} whether that seat belongs to the host
    * Side effects: none.
   */
  isHost(id) {
    return this.s.hostId === id;
  }

  /**
   * Players taking part in the current round (everyone except late joiners).
   *
   * @returns {object[]} seats
    * Side effects: none.
   */
  inRound() {
    return this.s.players.filter((p) => !p.waiting);
  }

  /**
   * Players who play a card this round (everyone in the round except the chooser).
   *
   * @returns {object[]} seats
    * Side effects: none.
   */
  cardPlayers() {
    return this.inRound().filter((p) => p.id !== this.s.chooserId);
  }

  /**
   * Is the round waiting for this player to do something? The chooser while the word is chosen, everybody still to play
   * a card, then everybody still to vote. The scoreboard shows it as `current` and the site's "Take your time" clock
   * reads it, so it must mean "it is your move", not "it is your round".
   *
   * @param {object} p  a seat
   * @returns {boolean}
   * Side effects: none.
   */
  mustAct(p) {
    const s = this.s;
    if (s.phase === 'word') return p.id === s.chooserId;
    if (s.phase === 'picking') return this.cardPlayers().some((x) => x.id === p.id) && !(p.id in s.picks);
    if (s.phase === 'voting') return this.voters().some((x) => x.id === p.id) && !(p.id in s.votes);
    return false;
  }

  // ---------- deck ----------

  /**
   * Makes sure the saved settings are valid for the categories that exist now.
   *
   * @returns {void}
   * Side effects: may reset s.judging and s.categories.
   */
  normaliseSettings() {
    const s = this.s;
    if (!JUDGING_MODES.includes(s.judging)) s.judging = 'everyone';
    const known = this.getCategories().map((c) => c.key);
    const chosen = Array.isArray(s.categories) ? s.categories.filter((key) => known.includes(key)) : [];
    s.categories = chosen.length ? chosen : known;
  }

  /**
   * @returns {object[]} the categories the host has selected, in the standard order
    * Side effects: none.
   */
  selectedCategories() {
    return this.getCategories().filter((c) => this.s.categories.includes(c.key));
  }

  /**
   * Ids of every card in the selected categories.
   *
   * @returns {number[]}
    * Side effects: none.
   */
  availableIds() {
    return [...new Set(this.selectedCategories().flatMap((c) => c.ids))];
  }

  /**
   * Keeps the deck in step with the cards on disk: new cards join the draw pile, missing ones vanish.
   *
   * @returns {void}
   * Side effects: edits the draw pile, discard pile and every hand; may shuffle the draw pile.
   */
  syncCards() {
    const available = new Set(this.availableIds());
    const s = this.s;
    const known = new Set();
    // Filter predicate: keeps a card only if it is still available and not already seen in another pile or hand (drops duplicates).
    const keep = (id) => available.has(id) && !known.has(id) && known.add(id);
    s.draw = s.draw.filter(keep);
    s.discard = s.discard.filter(keep);
    for (const p of s.players) p.hand = p.hand.filter(keep);
    const fresh = [...available].filter((id) => !known.has(id));
    if (s.phase !== 'lobby' && fresh.length) {
      s.draw.push(...fresh);
      shuffle(s.draw, this.rng);
    }
  }

  /**
   * Deals a player cards until their hand is full, reshuffling the discard pile if the draw pile runs out.
   *
   * @param {object} player  a seat
   * @returns {void}
   * Side effects: moves cards from the draw (and discard) pile into the hand.
   */
  drawUp(player) {
    const s = this.s;
    while (player.hand.length < s.handSize) {
      if (!s.draw.length) {
        if (!s.discard.length) return; // nothing left anywhere
        s.draw = shuffle(s.discard, this.rng);
        s.discard = [];
      }
      player.hand.push(s.draw.pop());
    }
  }

  // ---------- players and lobby ----------

  /**
   * Seats a person. In a game that has started they wait for the next round.
   *
   * @param {string} name   their display name (cleaned, and checked for length and for clashes)
   * @param {string} token  their account token
   * @returns {object} the new seat
   * Side effects: adds a seat; the first person to sit becomes the host. Throws a GameError if the game is full or
   * the name is unusable.
   */
  addPlayer(name, token) {
    const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (this.s.players.length >= MAX_PLAYERS) fail(`A game can have at most ${MAX_PLAYERS} players.`);
    if (!clean) fail('Please enter a name.');
    if (clean.length > MAX_NAME_LENGTH) fail(`Names can be at most ${MAX_NAME_LENGTH} characters.`);
    if (this.s.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      fail('Someone is already using that name.');
    }
    const player = {
      id: this.newSeatId(),
      kind: KIND_HUMAN,
      token,
      name: clean,
      score: 0,
      turns: 0, // rounds this player has completed as the word-chooser
      hand: [],
      waiting: this.s.phase !== 'lobby', // late joiners wait for the next round
    };
    this.s.players.push(player);
    this.s.hostId ??= player.id;
    return player;
  }

  /**
   * A fresh seat id that no current seat has, drawn from this game's rng.
   *
   * @returns {string}
    * Side effects: advances this game's rng.
   */
  newSeatId() {
    return newPublicId(this.rng, new Set(this.s.players.map((p) => p.id)));
  }

  /**
   * A bot running as its own process (bots/bot.js, signed in as an account) says which AI it plays with, when it joins
   * and again at the start of every game. Stored on the seat and shown to everyone as { id, name } for that seat only.
   * Built-in computer players never call this: the game deals them an AI itself when it starts.
   *
   * @param {string} id    the seat id of the caller
   * @param {string} aiId  the id of one of the AIs in ./ai
   * @returns {void}
   * Side effects: sets `ai` on the seat. Throws a GameError for an unknown AI or seat.
   */
  setAI(id, aiId) {
    const player = this.requirePlayer(id);
    if (!AIS.some((ai) => ai.id === aiId)) fail('Unknown AI.');
    player.ai = aiId;
  }

  /**
   * @param {string} aiId  an AI id; one that no longer exists falls back to the first AI
   * @returns {{ id: string, name: string }} how an AI is shown to the players
    * Side effects: none.
   */
  aiView(aiId) {
    const { id, name } = aiById(AIS, aiId);
    return { id, name };
  }

  /**
   * People in the game (accounts), as opposed to computer players.
   *
   * @returns {object[]} seats
    * Side effects: none.
   */
  humans() {
    return this.s.players.filter((p) => !isBot(p));
  }

  /**
   * A fresh computer-player seat (it gets an AI when a game starts, or when it takes over mid-game). It is not yet
   * added to the game.
   *
   * @returns {object} a seat with kind 'bot' and a name nobody else is using
   * Side effects: uses up one number of s.nextBot.
   */
  newBot() {
    const s = this.s;
    const used = new Set(s.players.map((p) => p.name.toLowerCase()));
    let name = BOT_NAMES.find((n) => !used.has(n.toLowerCase())) ?? 'Computer';
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `Computer ${n}`;
    s.nextBot ??= 1;
    return { id: this.newSeatId(), kind: KIND_BOT, token: `bot:${s.nextBot++}`, name, score: 0, turns: 0, hand: [], waiting: s.phase !== 'lobby' };
  }

  /**
   * The host adds one computer player to the lobby.
   *
   * @param {string} byId  the seat id of the caller (must be the host)
   * @returns {{ id: string }} the new seat's id
   * Side effects: adds a seat. Throws a GameError outside the lobby, for a non-host, or if the game is full.
   */
  addBot(byId) {
    if (!this.isHost(byId)) fail('Only the host can add computer players.');
    if (this.s.phase !== 'lobby') fail('Computer players can only be added in the lobby.');
    if (this.s.players.length >= MAX_PLAYERS) fail(`A game can have at most ${MAX_PLAYERS} players.`);
    const bot = this.newBot();
    this.s.players.push(bot);
    return { id: bot.id };
  }

  /**
   * The host fills the lobby with computer players until there are `target` players (default: enough to start).
   *
   * @param {string} byId     the seat id of the caller (must be the host)
   * @param {number} [target] how many players there should be; clamped between MIN_PLAYERS and MAX_PLAYERS
   * @returns {void}
   * Side effects: adds seats. Throws a GameError outside the lobby or for a non-host.
   */
  fillWithBots(byId, target = MIN_PLAYERS) {
    if (!this.isHost(byId)) fail('Only the host can add computer players.');
    if (this.s.phase !== 'lobby') fail('Computer players can only be added in the lobby.');
    const wanted = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(Number(target)) || MIN_PLAYERS));
    while (this.s.players.length < wanted) this.s.players.push(this.newBot());
  }

  /**
   * The host removes a computer player from the lobby.
   *
   * @param {string} byId      the seat id of the caller (must be the host)
   * @param {string} targetId  the seat id of the computer player
   * @returns {void}
   * Side effects: removes a seat. Throws a GameError outside the lobby, for a non-host or if the seat is a person.
   */
  removeBot(byId, targetId) {
    if (!this.isHost(byId)) fail('Only the host can remove computer players.');
    if (this.s.phase !== 'lobby') fail('Computer players can only be removed in the lobby.');
    const index = this.s.players.findIndex((p) => p.id === targetId && isBot(p));
    if (index < 0) fail('That is not a computer player.');
    this.s.players.splice(index, 1);
  }

  /**
   * Checks that `byId` may remove `targetId`: a person may always remove themselves; only the host may remove anyone
   * else, and nobody can be removed from a finished game (there is nothing left to take them out of).
   *
   * @param {string} byId      the seat id of the caller
   * @param {string} targetId  the seat id to remove
   * @returns {object} the target's seat
   * Side effects: throws a GameError if the removal is not allowed.
   */
  requireMayRemove(byId, targetId) {
    if (byId !== targetId && !this.isHost(byId)) fail('Only the host can remove other players.');
    if (byId !== targetId && this.s.phase === 'finished') fail('The game is over: there is nobody to remove.');
    return this.player(targetId) ?? fail('That player is not in the game.');
  }

  /**
   * A person leaves, or the host removes someone. While a round is on (or its results are showing) a computer player
   * takes over a person's seat, keeping their hand, score and turns, so the game carries on at any size as long as
   * another person is still there. In every other case (lobby, finished game, a late joiner still waiting, a computer
   * player, or nobody else left) the seat is simply removed, as removePlayer does.
   *
   * @param {string} byId      the seat id of the caller
   * @param {string} targetId  the seat id of the person leaving
   * @returns {void}
   * Side effects: either converts the seat to a computer player (the host moves to another person if it was theirs)
   * or removes it (see removePlayer). Throws a GameError if the caller may not do this.
   */
  leave(byId, targetId) {
    const s = this.s;
    const target = this.requireMayRemove(byId, targetId);
    const midGame = ROUND_PHASES.includes(s.phase);
    if (!midGame || isBot(target) || target.waiting || this.humans().length < 2) return this.removePlayer(byId, targetId);
    const { name, token } = this.newBot();
    Object.assign(target, { kind: KIND_BOT, token, name, ai: pickAI(AIS, this.rng).id });
    if (s.hostId === targetId) s.hostId = this.humans()[0].id;
  }

  /**
   * Takes a player out of the game outright. The round carries on without them whenever it can (see repairRound); it
   * is abandoned only if it genuinely cannot continue, and the game goes back to the lobby if fewer than MIN_PLAYERS
   * are left. A finished game is left as it is (the others keep the final standings), whoever leaves.
   *
   * @param {string} byId      the seat id of the caller
   * @param {string} targetId  the seat id to remove
   * @returns {void}
   * Side effects: removes the seat, returns its hand to the discard pile, edits the scoreboard history, may move the
   * host, and may move the round on, end it, or send the game to the lobby. Throws a GameError if the caller may not
   * remove that player.
   */
  removePlayer(byId, targetId) {
    const s = this.s;
    this.requireMayRemove(byId, targetId);
    const index = s.players.findIndex((p) => p.id === targetId);
    const [removed] = s.players.splice(index, 1);
    for (const round of s.history) {
      delete round.deltas[removed.id];
      delete round.notes[removed.id];
    }
    s.discard.push(...removed.hand);
    if (index < s.nextChooserIdx) s.nextChooserIdx--;
    if (s.hostId === targetId) s.hostId = this.humans()[0]?.id ?? null;
    if (!this.humans().length) {
      // Nobody is left to play with (the server drops a game like this), so start from a clean sheet.
      Object.assign(s, Game.blankState(), {
        handSize: s.handSize,
        judging: s.judging,
        categories: s.categories,
        roundsEach: s.roundsEach,
      });
      return;
    }
    if (s.phase === 'lobby' || s.phase === 'finished') return; // a finished game keeps its final standings for the others
    if (s.players.length < MIN_PLAYERS) {
      this.returnToLobby();
    } else if (!removed.waiting) {
      this.repairRound(removed);
    }
  }

  /**
   * Fixes up the round in progress after a player in it has been removed. The round carries on if it can: their card
   * and vote are taken off the table, and if everyone who is left has now played (or voted) the round moves on at once.
   * It is abandoned (moving to the next chooser, scoring nothing) only when it needs the person who went: the chooser,
   * the imposter (who alone saw "???"), the favourite or the accused in the results, or when too few card players are
   * left to hold a vote.
   *
   * @param {object} removed  the seat that has just been removed (it is no longer in s.players)
   * @returns {void}
   * Side effects: edits picks, votes, tableOrder and results; may open voting, resolve the votes or call advance().
   */
  repairRound(removed) {
    const s = this.s;
    if (!this.roundSurvives(removed)) {
      this.advance();
      return;
    }
    delete s.picks[removed.id];
    delete s.votes[removed.id];
    for (const [voterId, targetId] of Object.entries(s.votes)) if (targetId === removed.id) delete s.votes[voterId];
    s.tableOrder = s.tableOrder.filter((id) => id !== removed.id);
    if (s.phase === 'picking') {
      if (this.cardPlayers().every((p) => p.id in s.picks)) this.openVoting();
    } else if (s.phase === 'voting') {
      if (this.voters().every((p) => p.id in s.votes)) this.resolveVotes();
    } else if (s.phase === 'results' && s.results) {
      // The round is over and counted: just take the person out of what is shown.
      delete s.results.deltas[removed.id];
      delete s.results.tally[removed.id];
      for (const [voterId, targetId] of Object.entries(s.results.votes)) {
        if (voterId === removed.id || targetId === removed.id) delete s.results.votes[voterId];
      }
    }
  }

  /**
   * Can the current round go on now that `removed` has gone? (See repairRound for what it needs.)
   *
   * @param {object} removed  the seat that has just been removed
   * @returns {boolean} false if the round cannot continue and must be abandoned
    * Side effects: none.
   */
  roundSurvives(removed) {
    const s = this.s;
    if (removed.id === s.chooserId) return false;
    if (s.imposterId && removed.id === s.imposterId) return false;
    if (s.phase === 'results' && s.results && [s.results.winnerId, s.results.accusedId].includes(removed.id)) return false;
    const needed = s.phase === 'word' ? 1 : 2; // someone to play a card; and, once cards are down, someone to vote for
    return this.cardPlayers().length >= needed;
  }

  /**
   * @param {string} byId  the seat id of the caller (must be the host)
   * @param {number} size  the new hand size
   * @returns {void}
   * Side effects: sets s.handSize. Throws a GameError outside the lobby, for a non-host or an out-of-range size.
   */
  setHandSize(byId, size) {
    if (!this.isHost(byId)) fail('Only the host can change the hand size.');
    if (this.s.phase !== 'lobby') fail('The hand size can only be changed in the lobby.');
    const n = Math.round(Number(size));
    if (!(n >= MIN_HAND_SIZE && n <= MAX_HAND_SIZE)) {
      fail(`Hand size must be between ${MIN_HAND_SIZE} and ${MAX_HAND_SIZE}.`);
    }
    this.s.handSize = n;
  }

  /**
   * @param {string} byId   the seat id of the caller (must be the host)
   * @param {number} count  how many times each player chooses the word
   * @returns {void}
   * Side effects: sets s.roundsEach. Throws a GameError outside the lobby, for a non-host or an out-of-range count.
   */
  setRounds(byId, count) {
    if (!this.isHost(byId)) fail('Only the host can change the number of rounds.');
    if (this.s.phase !== 'lobby') fail('The number of rounds can only be changed in the lobby.');
    const n = Math.round(Number(count));
    if (!(n >= MIN_ROUNDS_EACH && n <= MAX_ROUNDS_EACH)) {
      fail(`Each player can choose the word between ${MIN_ROUNDS_EACH} and ${MAX_ROUNDS_EACH} times.`);
    }
    this.s.roundsEach = n;
  }

  /**
   * @param {string} byId  the seat id of the caller (must be the host)
   * @param {string} mode  one of JUDGING_MODES
   * @returns {void}
   * Side effects: sets s.judging. Throws a GameError outside the lobby, for a non-host or an unknown mode.
   */
  setJudging(byId, mode) {
    if (!this.isHost(byId)) fail('Only the host can change how rounds are judged.');
    if (this.s.phase !== 'lobby') fail('The judging method can only be changed in the lobby.');
    if (!JUDGING_MODES.includes(mode)) fail('Unknown judging method.');
    this.s.judging = mode;
  }

  /**
   * @param {string} byId   the seat id of the caller (must be the host)
   * @param {string[]} keys the category keys to use
   * @returns {void}
   * Side effects: sets s.categories (in the standard order). Throws a GameError outside the lobby, for a non-host,
   * for an unknown key or for an empty choice.
   */
  setCategories(byId, keys) {
    if (!this.isHost(byId)) fail('Only the host can choose the categories.');
    if (this.s.phase !== 'lobby') fail('The categories can only be changed in the lobby.');
    const known = this.getCategories();
    const wanted = [...new Set(Array.isArray(keys) ? keys : [])];
    if (wanted.some((key) => !known.some((c) => c.key === key))) fail('Unknown category.');
    if (!wanted.length) fail('Pick at least one category.');
    this.s.categories = known.filter((c) => wanted.includes(c.key)).map((c) => c.key); // keep the standard order
  }

  /**
   * Starts the game: builds and shuffles the deck, resets everyone, deals the computer players their AIs and begins
   * the first round.
   *
   * @param {string} byId  the seat id of the caller (must be the host)
   * @returns {void}
   * Side effects: resets scores, turns, hands, history and the deck, and enters the 'word' phase. Throws a GameError
   * for a non-host, a game that has started, too few players or too few cards.
   */
  start(byId) {
    const s = this.s;
    if (!this.isHost(byId)) fail('Only the host can start the game.');
    if (s.phase !== 'lobby') fail('The game has already started.');
    if (s.players.length < MIN_PLAYERS) fail(`You need at least ${MIN_PLAYERS} players.`);
    this.normaliseSettings();
    const cardIds = this.availableIds();
    if (cardIds.length < s.players.length * s.handSize) {
      fail('There are not enough cards in the chosen categories for that many players. Choose more categories.');
    }
    s.draw = shuffle([...cardIds], this.rng);
    s.discard = [];
    for (const p of s.players) {
      p.hand = [];
      p.score = 0;
      p.turns = 0;
    }
    s.history = [];
    s.round = 0;
    s.completed = 0;
    s.nextChooserIdx = 0;
    // Every computer player gets an AI for the whole game (people who run their own bot process declare theirs).
    const bots = s.players.filter(isBot);
    const picks = assignAIs(AIS, bots.map((p) => p.id), this.rng);
    for (const p of bots) p.ai = picks[p.id];
    this.startRound();
  }

  /**
   * Sends everyone back to the lobby, clearing the game (settings and seats are kept).
   *
   * @param {string | null} [byId]  the seat id of the caller (must be the host); null when the rules do it themselves
   * @returns {void}
   * Side effects: resets the round, the deck, scores, hands and history. Throws a GameError for a non-host.
   */
  returnToLobby(byId = null) {
    const s = this.s;
    if (byId && !this.isHost(byId)) fail('Only the host can end the game.');
    Object.assign(s, {
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
    });
    for (const p of s.players) {
      p.hand = [];
      p.waiting = false;
      p.turns = 0;
      p.score = 0;
      if (isBot(p)) delete p.ai; // a new AI is dealt at the next start
    }
  }

  // ---------- round flow ----------

  /**
   * Begins a round: everyone joins in, the next chooser is picked and everybody's hand is topped up.
   *
   * @returns {void}
   * Side effects: increments s.round, picks s.chooserId, clears the table and enters the 'word' phase.
   */
  startRound() {
    const s = this.s;
    this.syncCards();
    for (const p of s.players) p.waiting = false;
    s.round++;
    // Normally just the next player in join order; anyone who has already had all their turns is skipped while
    // somebody else still owes some (this happens after skipped rounds or when someone joins late).
    // Has this player still to choose the word for some of the rounds the host asked for?
    const owes = (player) => (player.turns ?? 0) < s.roundsEach;
    const someoneOwes = s.players.some(owes);
    let idx = s.nextChooserIdx % s.players.length;
    for (let step = 0; step < s.players.length; step++) {
      const candidate = (s.nextChooserIdx + step) % s.players.length;
      if (!someoneOwes || owes(s.players[candidate])) {
        idx = candidate;
        break;
      }
    }
    s.chooserId = s.players[idx].id;
    s.nextChooserIdx = idx + 1;
    Object.assign(s, { word: null, imposterId: null, picks: {}, tableOrder: [], votes: {}, results: null });
    for (const p of s.players) this.drawUp(p);
    s.phase = 'word';
  }

  /**
   * Abandons the current round without scoring or discarding, and moves to the next chooser.
   *
   * @param {string} byId  the seat id of the caller (must be the host)
   * @returns {void}
   * Side effects: starts a new round. Throws a GameError for a non-host or when no round is under way.
   */
  abortRound(byId) {
    if (!this.isHost(byId)) fail('Only the host can skip a round.');
    if (!['word', 'picking', 'voting'].includes(this.s.phase)) fail('There is no round to skip.');
    this.startRound();
  }

  /**
   * Suggestions for the chooser, without repeats until the list has been used up.
   *
   * @param {number} [count]  how many to give
   * @returns {string[]} up to `count` hints (fewer if the list is shorter)
   * Side effects: takes the hints out of the pool, refilling (and shuffling) it when it runs low.
   */
  nextHints(count = 3) {
    if (this.hintPool.length < count) {
      this.hintPool = shuffle([...this.hints], this.rng);
    }
    return this.hintPool.splice(-count, count);
  }

  /**
   * The chooser gives the word; the imposter is picked (except in the favourite style) and card-playing begins.
   *
   * @param {string} id    the seat id of the caller (must be the chooser)
   * @param {string} word  the word or phrase
   * @returns {void}
   * Side effects: sets s.word and s.imposterId and enters the 'picking' phase. Throws a GameError out of turn, for a
   * non-chooser, an empty or over-long word, or if nobody else is in the round to play a card (nothing is changed).
   */
  submitWord(id, word) {
    const s = this.s;
    if (s.phase !== 'word') fail('It is not time to choose a word.');
    if (id !== s.chooserId) fail('Only the chooser can pick the word.');
    const clean = String(word ?? '').trim().replace(/\s+/g, ' ');
    if (!clean) fail('Type a word or phrase first.');
    if (clean.length > MAX_WORD_LENGTH) fail(`Keep it to ${MAX_WORD_LENGTH} characters or fewer.`);
    const candidates = this.cardPlayers();
    if (!candidates.length) fail('Nobody else is in this round to play a card.');
    s.word = clean;
    // In the favourite style nobody is kept in the dark, so there is no imposter.
    s.imposterId = s.judging === 'favourite' ? null : candidates[Math.floor(this.rng() * candidates.length)].id;
    s.phase = 'picking';
  }

  /**
   * A player puts a card from their hand on the table. When the last card is down, voting opens.
   *
   * @param {string} id      the seat id of the caller
   * @param {number} cardId  the card to play
   * @returns {void}
   * Side effects: records the pick (a player may change it until the last card is in) and may open voting. Throws a
   * GameError out of turn, for the chooser or a waiting player, or for a card not in the hand.
   */
  playCard(id, cardId) {
    const s = this.s;
    if (s.phase !== 'picking') fail('It is not time to play a card.');
    const player = this.requirePlayer(id);
    if (player.waiting || id === s.chooserId) fail('You do not play a card this round.');
    if (!player.hand.includes(cardId)) fail('That card is not in your hand.');
    s.picks[id] = cardId;
    if (this.cardPlayers().every((p) => p.id in s.picks)) this.openVoting();
  }

  /**
   * Lays the cards out in a random order and opens voting.
   *
   * @returns {void}
   * Side effects: sets s.tableOrder, clears s.votes and enters the 'voting' phase.
   */
  openVoting() {
    const s = this.s;
    s.tableOrder = shuffle(this.cardPlayers().map((p) => p.id), this.rng);
    s.votes = {};
    s.phase = 'voting';
  }

  /**
   * A player votes (or changes their vote). When the last needed vote is in, the round is resolved.
   *
   * @param {string} id        the seat id of the voter
   * @param {string} targetId  the seat id of the player whose card they suspect (or, when favouring, like best)
   * @returns {void}
   * Side effects: records the vote and may resolve the round. Throws a GameError out of turn, for someone who may not
   * vote, a vote for oneself, or a vote for someone who played no card.
   */
  vote(id, targetId) {
    const s = this.s;
    if (s.phase !== 'voting') fail('It is not time to vote.');
    const voter = this.requirePlayer(id);
    if (voter.waiting) fail('You are waiting for the next round.');
    if (s.judging !== 'everyone' && id !== s.chooserId) fail('In this game only the word-chooser votes.');
    if (id === targetId) fail('You cannot vote for yourself.');
    if (!this.cardPlayers().some((p) => p.id === targetId)) fail('You can only vote for someone who played a card.');
    s.votes[id] = targetId;
    if (this.voters().every((p) => p.id in s.votes)) this.resolveVotes();
  }

  /**
   * The players whose votes are needed before the round can end.
   *
   * @returns {object[]} seats
   * Side effects: none.
   */
  voters() {
    return this.s.judging === 'everyone' ? this.inRound() : this.inRound().filter((p) => p.id === this.s.chooserId);
  }

  /**
   * Scores the round according to the play style (everyone, chooser or favourite) and shows the results.
   *
   * @returns {void}
   * Side effects: changes scores, s.results, the history, the chooser's turns, and enters the 'results' phase.
   */
  resolveVotes() {
    const s = this.s;
    if (s.judging === 'chooser') return this.resolveChooserVerdict();
    if (s.judging === 'favourite') return this.resolveFavourite();
    const tally = Object.fromEntries(this.cardPlayers().map((p) => [p.id, 0]));
    for (const target of Object.values(s.votes)) tally[target]++;

    const imposterVotes = tally[s.imposterId];
    const bestOther = Math.max(0, ...Object.entries(tally).filter(([id]) => id !== s.imposterId).map(([, n]) => n));
    const groupCorrect = imposterVotes > bestOther;

    const deltas = Object.fromEntries(this.inRound().map((p) => [p.id, 0]));
    const voters = this.inRound().filter((p) => p.id !== s.imposterId);
    if (groupCorrect) {
      for (const voter of voters) {
        if (s.votes[voter.id] === s.imposterId) deltas[voter.id] = POINTS_PER_VOTE;
      }
    } else {
      const fooled = voters.filter((v) => s.votes[v.id] !== s.imposterId).length;
      deltas[s.imposterId] = fooled * POINTS_PER_VOTE;
    }
    for (const p of this.inRound()) p.score += deltas[p.id];

    const notes = this.roundNotes({ judging: 'everyone', groupCorrect });
    s.results = { judging: 'everyone', imposterId: s.imposterId, groupCorrect, tally, deltas, votes: { ...s.votes } };
    this.completeRound(notes);
  }

  /**
   * Chooser-only judging: spot the imposter and the chooser scores; get fooled and the imposter scores big.
   *
   * @returns {void}
   * Side effects: as resolveVotes.
   */
  resolveChooserVerdict() {
    const s = this.s;
    const accusedId = s.votes[s.chooserId];
    const groupCorrect = accusedId === s.imposterId; // here it means "the judge was correct"
    const deltas = Object.fromEntries(this.inRound().map((p) => [p.id, 0]));
    if (groupCorrect) deltas[s.chooserId] = CHOOSER_CORRECT_POINTS;
    else deltas[s.imposterId] = CHOOSER_FOOLED_POINTS;
    for (const p of this.inRound()) p.score += deltas[p.id];

    const notes = this.roundNotes({ judging: 'chooser', groupCorrect });
    const tally = Object.fromEntries(this.cardPlayers().map((p) => [p.id, p.id === accusedId ? 1 : 0]));
    s.results = { judging: 'chooser', imposterId: s.imposterId, accusedId, groupCorrect, tally, deltas, votes: { ...s.votes } };
    this.completeRound(notes);
  }

  /**
   * Favourite style: the chooser's favourite card scores, and nobody was bluffing.
   *
   * @returns {void}
   * Side effects: as resolveVotes.
   */
  resolveFavourite() {
    const s = this.s;
    const winnerId = s.votes[s.chooserId];
    const deltas = Object.fromEntries(this.inRound().map((p) => [p.id, 0]));
    deltas[winnerId] = FAVOURITE_POINTS;
    for (const p of this.inRound()) p.score += deltas[p.id];

    const notes = this.roundNotes({ judging: 'favourite', winnerId });
    const tally = Object.fromEntries(this.cardPlayers().map((p) => [p.id, p.id === winnerId ? 1 : 0]));
    s.results = { judging: 'favourite', imposterId: null, winnerId, groupCorrect: null, tally, deltas, votes: { ...s.votes } };
    this.completeRound(notes);
  }

  /**
   * Short public remarks for the scoreboard: who chose the word, who was the imposter and how it went.
   *
   * @param {object} outcome
   * @param {string} outcome.judging         the play style
   * @param {boolean} [outcome.groupCorrect] whether the imposter was caught
   * @param {string} [outcome.winnerId]      the favourite style's winner
   * @returns {Object<string, string>} playerId -> remark
    * Side effects: none.
   */
  roundNotes({ judging, groupCorrect, winnerId }) {
    const s = this.s;
    const notes = {};
    if (s.chooserId) notes[s.chooserId] = 'chooser';
    if (judging === 'favourite') {
      if (winnerId) notes[winnerId] = notes[winnerId] ? `${notes[winnerId]}, card picked` : 'card picked';
    } else if (s.imposterId) {
      notes[s.imposterId] = groupCorrect ? 'imposter, caught' : 'imposter, fooled all';
      if (judging === 'chooser') notes[s.chooserId] = groupCorrect ? 'chooser, spotted it' : 'chooser, fooled';
    }
    return notes;
  }

  /**
   * Records a finished round (abandoned rounds never get here): it counts as a turn for the chooser, goes into
   * the scoreboard history, and the results are shown.
   *
   * @param {Object<string, string>} [notes]  the scoreboard remarks from roundNotes
   * @returns {void}
   * Side effects: increments the chooser's turns and s.completed, adds a history row and enters 'results'.
   */
  completeRound(notes = {}) {
    const s = this.s;
    const chooser = this.player(s.chooserId);
    if (chooser) chooser.turns = (chooser.turns ?? 0) + 1;
    s.completed++;
    s.history.push({ label: `Round ${s.completed}`, deltas: { ...s.results.deltas }, notes });
    s.phase = 'results';
  }

  /**
   * Leaves the results: the played cards are discarded and the next round (or the end of the game) begins.
   *
   * @param {string} id  the seat id of the caller (any player)
   * @returns {void}
   * Side effects: moves cards to the discard pile, then as advance. Throws a GameError if the round is not over.
   */
  nextRound(id) {
    const s = this.s;
    if (s.phase !== 'results') fail('The round is not over yet.');
    this.requirePlayer(id);
    // Played cards go to the discard pile; startRound() then tops everyone's hand back up.
    for (const p of this.inRound()) {
      const cardId = s.picks[p.id];
      if (cardId === undefined) continue;
      p.hand = p.hand.filter((c) => c !== cardId);
      s.discard.push(cardId);
    }
    this.advance();
  }

  /**
   * Has every player chosen the word as many times as the host asked for?
   *
   * @returns {boolean}
    * Side effects: none.
   */
  allDone() {
    return this.s.players.every((p) => (p.turns ?? 0) >= this.s.roundsEach);
  }

  /**
   * How many more rounds are needed before everyone has had all their turns.
   *
   * @returns {number}
    * Side effects: none.
   */
  roundsRemaining() {
    return this.s.players.reduce((sum, p) => sum + Math.max(0, this.s.roundsEach - (p.turns ?? 0)), 0);
  }

  /**
   * Moves on after a round: either the next round, or the end of the game.
   *
   * @returns {void}
   * Side effects: enters the 'finished' phase or starts a round.
   */
  advance() {
    if (this.allDone()) this.s.phase = 'finished';
    else this.startRound();
  }

  /**
   * Everyone sharing the highest score.
   *
   * @returns {string[]} seat ids
    * Side effects: none.
   */
  winnerIds() {
    return winnersOf(Object.fromEntries(this.s.players.map((p) => [p.id, p.score])));
  }

  // ---------- computer players ----------

  /**
   * The AI a computer seat plays with (a seat saved without one gets the first, standard AI).
   *
   * @param {object} player  a seat
   * @returns {object} an AI (see ./ai)
    * Side effects: none.
   */
  aiOf(player) {
    return aiById(AIS, player.ai);
  }

  /**
   * The next thing a computer player has to do, or null: { type: 'word' | 'card' | 'vote', id }. Computer players
   * never start the game or move on from the results: the host does that, so they can never hold a game up.
   *
   * @returns {{ type: 'word' | 'card' | 'vote', id: string } | null}
    * Side effects: none.
   */
  pendingBotAction() {
    const s = this.s;
    if (s.phase === 'word') {
      const chooser = this.player(s.chooserId);
      return chooser && isBot(chooser) ? { type: 'word', id: chooser.id } : null;
    }
    if (s.phase === 'picking') {
      const bot = this.cardPlayers().find((p) => isBot(p) && !(p.id in s.picks) && p.hand.length);
      return bot ? { type: 'card', id: bot.id } : null;
    }
    if (s.phase === 'voting') {
      const bot = this.voters().find((p) => isBot(p) && !(p.id in s.votes));
      return bot ? { type: 'vote', id: bot.id } : null;
    }
    return null;
  }

  /**
   * Asks the AI, and if it answers with something that is not a legal option, makes a random legal choice instead.
   *
   * @param {object} player      the computer player's seat
   * @param {string} decision    the AI's method to call ('chooseWord', 'playCard' or 'vote')
   * @param {any[]} options      the legal answers
   * @param {object} input       what the AI is told (the game adds the cards, round and judging style)
   * @returns {any} one of `options`
    * Side effects: calls the AI and advances this game's rng; nothing else is changed.
   */
  botDecide(player, decision, options, input) {
    let answer;
    try {
      answer = this.aiOf(player)[decision]({ ...input, cards: buildCardInfo({ categories: this.getCategories() }), round: this.s.round, judging: this.s.judging }, this.rng);
    } catch {
      answer = undefined; // a broken AI must not stop the game
    }
    return options.includes(answer) ? answer : options[Math.floor(this.rng() * options.length)];
  }

  /**
   * Plays one pending computer move. Each decision is made from that seat's own view (viewFor), so a computer player
   * knows only what a person in the same seat would: its hand, the clue (unless it is the imposter), the table.
   *
   * @param {{ type: string, id: string } | null} [action]  the move to play (default: whatever is pending)
   * @returns {boolean} false if there was nothing to do
   * Side effects: submits a word, plays a card or votes, as that seat.
   */
  runBotAction(action = this.pendingBotAction()) {
    if (!action) return false;
    const s = this.s;
    const view = this.viewFor(action.id);
    if (action.type === 'word') {
      const hints = this.nextHints(3);
      const options = hints.length ? hints : FALLBACK_WORDS;
      this.submitWord(action.id, this.botDecide(this.player(action.id), 'chooseWord', options, { hints: options, hand: view.me.hand }));
    } else if (action.type === 'card') {
      const cardId = this.botDecide(this.player(action.id), 'playCard', view.me.hand, { word: view.word, hand: view.me.hand });
      this.playCard(action.id, cardId);
    } else {
      const targetId = this.botDecide(this.player(action.id), 'vote', view.voteTargets, {
        word: view.word,
        table: view.table,
        targets: view.voteTargets,
        me: action.id,
        imposter: s.imposterId === action.id, // it saw ??? instead of the clue, so it knows
        chooser: view.me.isChooser,
        scores: Object.fromEntries(view.players.map((p) => [p.id, p.score])),
      });
      this.vote(action.id, targetId);
    }
    return true;
  }

  // ---------- what each player is allowed to see ----------

  /**
   * The word as one player may see it: everybody but the imposter sees it while cards are being played, and everybody sees it
   * once the voting starts.
   *
   * @param {string} id  the seat id of the viewer
   * @returns {string | null} the word, or null when this player may not know it (yet)
    * Side effects: none.
   */
  wordView(id) {
    const s = this.s;
    const wordRevealed = ['voting', 'results'].includes(s.phase);
    return s.word !== null && (wordRevealed || (s.phase === 'picking' && id !== s.imposterId)) ? s.word : null;
  }

  /**
   * The categories the host can pick from, with how many cards each holds and whether it is selected.
   *
   * @returns {{ key: string, label: string, description: string, count: number, selected: boolean }[]}
    * Side effects: none.
   */
  categoriesView() {
    const s = this.s;
    return this.getCategories().map((c) => ({
      key: c.key,
      label: c.label,
      description: c.description ?? '',
      count: c.ids.length,
      selected: s.categories.includes(c.key),
    }));
  }

  /**
   * The viewer's own seat: their hand, pick and vote, and whether they were the imposter (only once that is revealed).
   *
   * @param {object} me  the viewer's player
   * @returns {object}
    * Side effects: none.
   */
  meView(me) {
    const s = this.s;
    return {
      id: me.id,
      waiting: me.waiting,
      isChooser: me.id === s.chooserId,
      hand: me.waiting || ['lobby', 'finished'].includes(s.phase) ? [] : me.hand,
      myPick: s.picks[me.id] ?? null,
      myVote: s.votes[me.id] ?? null,
      isImposter: s.phase === 'results' && me.id === s.imposterId,
    };
  }

  /**
   * Every player as the table shows them to everybody.
   *
   * @param {Set<string>} connectedIds  the seat ids that currently have a connection
   * @returns {object[]}
    * Side effects: none.
   */
  playersView(connectedIds) {
    const s = this.s;
    const inPlay = ['picking', 'voting', 'results'].includes(s.phase);
    return s.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      turns: p.turns ?? 0,
      waiting: p.waiting,
      connected: isBot(p) || connectedIds.has(p.id),
      bot: isBot(p), // the client's word for it; the seat itself says kind: 'bot'
      ai: p.ai ? this.aiView(p.ai) : null, // bot seats only
      isChooser: p.id === s.chooserId,
      hasPlayed: inPlay && p.id in s.picks,
      hasVoted: s.phase === 'voting' ? p.id in s.votes : false,
    }));
  }

  /**
   * The standard scoreboard (shared/scores.js): the chooser has the turn.
   *
   * @param {string} id  the seat id of the viewer
   * @param {Set<string>} connectedIds  the seat ids that currently have a connection
   * @returns {object}
    * Side effects: none.
   */
  scoreboardView(id, connectedIds) {
    const s = this.s;
    return {
      // `id` is the seat id (what the game talks about); `userId` is the account, which the site needs for name styles and avatars.
      players: s.players.map((p) => ({ id: p.id, name: p.name, userId: userIdOf(p.token) ?? undefined, score: p.score, isMe: p.id === id, bot: isBot(p), current: this.mustAct(p), away: !isBot(p) && !connectedIds.has(p.id) })),
      rounds: s.history.map((r) => ({ label: r.label, deltas: { ...r.deltas }, notes: { ...r.notes } })),
      lowIsBetter: false,
    };
  }

  /**
   * The cards face up on the table (none while the cards are still being picked) and who this player may vote for.
   *
   * @param {string} id  the seat id of the viewer
   * @returns {{ table: object[], voteTargets: string[] }}
    * Side effects: none.
   */
  tableView(id) {
    const s = this.s;
    return {
      table: s.phase === 'picking' ? [] : s.tableOrder.map((pid) => ({ playerId: pid, cardId: s.picks[pid] })),
      voteTargets:
        s.phase === 'voting' && this.voters().some((v) => v.id === id)
          ? this.cardPlayers().filter((p) => p.id !== id).map((p) => p.id)
          : [],
    };
  }

  /**
   * What one player is allowed to see of the game: their own hand, the word (unless they are the imposter while cards
   * are being played), and only the public parts of everything else.
   *
   * @param {string} id                      the seat id of the viewer
   * @param {Set<string>} [connectedIds]     the seat ids that currently have a connection
   * @returns {object | null} the view, or null if that seat does not exist
    * Side effects: none.
   */
  viewFor(id, connectedIds = new Set()) {
    const s = this.s;
    const me = this.player(id);
    if (!me) return null;
    const { table, voteTargets } = this.tableView(id);
    return {
      phase: s.phase,
      round: s.round,
      roundsEach: s.roundsEach,
      completedRounds: s.completed,
      totalRounds: s.completed + this.roundsRemaining(), // grows if somebody joins late
      winners: s.phase === 'finished' ? this.winnerIds() : [],
      handSize: s.handSize,
      chooserId: s.chooserId,
      hostId: s.hostId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      pointsPerVote: POINTS_PER_VOTE,
      pointsChooserCorrect: CHOOSER_CORRECT_POINTS,
      pointsFooledChooser: CHOOSER_FOOLED_POINTS,
      pointsFavourite: FAVOURITE_POINTS,
      judging: s.judging,
      categories: this.categoriesView(),
      availableCards: this.availableIds().length,
      drawCount: s.draw.length,
      discardCount: s.discard.length,
      word: this.wordView(id),
      wordHidden: s.phase === 'picking' && id === s.imposterId,
      me: this.meView(me),
      players: this.playersView(connectedIds),
      scoreboard: this.scoreboardView(id, connectedIds),
      table,
      voteTargets,
      results: s.phase === 'results' ? s.results : null,
    };
  }
}
