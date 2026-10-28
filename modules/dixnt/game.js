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

import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { winnersOf } from '../../shared/scores.js';
import { AIS, buildCardInfo } from './ai/index.js';

export const POINTS_PER_VOTE = 100;
export const CHOOSER_CORRECT_POINTS = 100;
export const CHOOSER_FOOLED_POINTS = 500;
export const FAVOURITE_POINTS = 200;
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

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kit', 'Luna'];
/** Used only if the word list is empty, so a computer chooser can always give a word. */
const FALLBACK_WORDS = ['Journey', 'Secret', 'Midnight', 'Garden'];

export class GameError extends Error {}
const fail = (message) => {
  throw new GameError(message);
};

export function shuffle(items, rng = Math.random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

const newPublicId = () => Math.random().toString(36).slice(2, 10);

export class Game {
  /**
   * @param {object} options
   * @param {() => {key: string, label: string, description?: string, ids: number[]}[]} [options.getCategories]
   *        the cards currently available, grouped into categories
   * @param {() => number[]} [options.getCardIds] shortcut for a single category containing every card
   * @param {string[]} options.hints word/phrase suggestions for the chooser
   * @param {() => number} [options.rng]
   * @param {object} [options.saved] a previously saved state (see toJSON)
   */
  constructor({ getCategories, getCardIds, hints = [], rng = Math.random, saved = null }) {
    this.getCategories =
      getCategories ?? (() => [{ key: 'all', label: 'All cards', description: '', ids: getCardIds ? getCardIds() : [] }]);
    this.hints = hints;
    this.rng = rng;
    this.hintPool = [];
    this.s = { ...Game.blankState(), ...(saved ?? {}) };
    this.normaliseHistory(saved);
    if (this.s.phase === 'discussion') this.s.phase = 'voting'; // saved by an older version that had a separate step
    delete this.s.ready;
    this.normaliseSettings();
    this.syncCards();
  }

  static blankState() {
    return {
      phase: 'lobby',
      // { id, token, name, score, turns, hand: number[], waiting: boolean, bot?: true, ai?: string }. A computer player
      // has bot: true, no account (its token is 'bot:<n>', which no user token can match) and, once a game starts,
      // the id of its AI.
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

  /** Older saved games have no history: if they already have scores, show them as one "Earlier rounds" row. */
  normaliseHistory(saved) {
    const s = this.s;
    if (Array.isArray(saved?.history)) return;
    s.history = [];
    if (s.phase !== 'lobby' && s.players.some((p) => p.score)) {
      s.history.push({ label: 'Earlier rounds', deltas: Object.fromEntries(s.players.map((p) => [p.id, p.score])), notes: {} });
    }
  }

  toJSON() {
    return this.s;
  }

  // ---------- lookups ----------

  player(id) {
    return this.s.players.find((p) => p.id === id) ?? null;
  }

  findByToken(token) {
    return this.s.players.find((p) => p.token === token) ?? null;
  }

  requirePlayer(id) {
    return this.player(id) ?? fail('You are not in this game.');
  }

  isHost(id) {
    return this.s.hostId === id;
  }

  /** Players taking part in the current round (everyone except late joiners). */
  inRound() {
    return this.s.players.filter((p) => !p.waiting);
  }

  /** Players who play a card this round (everyone in the round except the chooser). */
  cardPlayers() {
    return this.inRound().filter((p) => p.id !== this.s.chooserId);
  }

  // ---------- deck ----------

  /** Makes sure the saved settings are valid for the categories that exist now. */
  normaliseSettings() {
    const s = this.s;
    if (!JUDGING_MODES.includes(s.judging)) s.judging = 'everyone';
    const known = this.getCategories().map((c) => c.key);
    const chosen = Array.isArray(s.categories) ? s.categories.filter((key) => known.includes(key)) : [];
    s.categories = chosen.length ? chosen : known;
  }

  selectedCategories() {
    return this.getCategories().filter((c) => this.s.categories.includes(c.key));
  }

  /** Ids of every card in the selected categories. */
  availableIds() {
    return [...new Set(this.selectedCategories().flatMap((c) => c.ids))];
  }

  /** Keeps the deck in step with the cards on disk: new cards join the draw pile, missing ones vanish. */
  syncCards() {
    const available = new Set(this.availableIds());
    const s = this.s;
    const known = new Set();
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

  addPlayer(name, token) {
    const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (this.s.players.length >= MAX_PLAYERS) fail(`A game can have at most ${MAX_PLAYERS} players.`);
    if (!clean) fail('Please enter a name.');
    if (clean.length > MAX_NAME_LENGTH) fail(`Names can be at most ${MAX_NAME_LENGTH} characters.`);
    if (this.s.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      fail('Someone is already using that name.');
    }
    const player = {
      id: newPublicId(),
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
   * A bot running as its own process (bots/bot.js, signed in as an account) says which AI it plays with, when it joins
   * and again at the start of every game. Stored on the seat and shown to everyone as { id, name } for that seat only.
   * Built-in computer players never call this: the game deals them an AI itself when it starts.
   */
  setAI(id, aiId) {
    const player = this.requirePlayer(id);
    if (!AIS.some((ai) => ai.id === aiId)) fail('Unknown AI.');
    player.ai = aiId;
  }

  /** { id, name } of an AI; a saved id that no longer exists falls back to the first AI. */
  aiView(aiId) {
    const { id, name } = aiById(AIS, aiId);
    return { id, name };
  }

  /** People in the game (accounts), as opposed to computer players. */
  humans() {
    return this.s.players.filter((p) => !p.bot);
  }

  /** A fresh computer-player seat (it gets an AI when a game starts, or when it takes over mid-game). */
  newBot() {
    const s = this.s;
    const used = new Set(s.players.map((p) => p.name.toLowerCase()));
    let name = BOT_NAMES.find((n) => !used.has(n.toLowerCase())) ?? 'Computer';
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `Computer ${n}`;
    s.nextBot ??= 1;
    return { id: newPublicId(), token: `bot:${s.nextBot++}`, name, score: 0, turns: 0, hand: [], waiting: s.phase !== 'lobby', bot: true };
  }

  /** The host adds one computer player to the lobby. */
  addBot(byId) {
    if (!this.isHost(byId)) fail('Only the host can add computer players.');
    if (this.s.phase !== 'lobby') fail('Computer players can only be added in the lobby.');
    if (this.s.players.length >= MAX_PLAYERS) fail(`A game can have at most ${MAX_PLAYERS} players.`);
    const bot = this.newBot();
    this.s.players.push(bot);
    return { id: bot.id };
  }

  /** The host fills the lobby with computer players until there are `target` players (default: enough to start). */
  fillWithBots(byId, target = MIN_PLAYERS) {
    if (!this.isHost(byId)) fail('Only the host can add computer players.');
    if (this.s.phase !== 'lobby') fail('Computer players can only be added in the lobby.');
    const wanted = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(Number(target)) || MIN_PLAYERS));
    while (this.s.players.length < wanted) this.s.players.push(this.newBot());
  }

  /** The host removes a computer player from the lobby. */
  removeBot(byId, targetId) {
    if (!this.isHost(byId)) fail('Only the host can remove computer players.');
    if (this.s.phase !== 'lobby') fail('Computer players can only be removed in the lobby.');
    const index = this.s.players.findIndex((p) => p.id === targetId && p.bot);
    if (index < 0) fail('That is not a computer player.');
    this.s.players.splice(index, 1);
  }

  /**
   * A person leaves, or the host removes someone. While a round is on (or its results are showing) a computer player
   * takes over a person's seat, keeping their hand, score and turns, so the game carries on at any size as long as
   * another person is still there. In every other case (lobby, finished game, a late joiner still waiting, a computer
   * player, or nobody else left) the seat is simply removed, as removePlayer does.
   */
  leave(byId, targetId) {
    const s = this.s;
    if (byId !== targetId && !this.isHost(byId)) fail('Only the host can remove other players.');
    const target = this.player(targetId);
    if (!target) fail('That player is not in the game.');
    const midGame = ['word', 'picking', 'voting', 'results'].includes(s.phase);
    if (!midGame || target.bot || target.waiting || this.humans().length < 2) return this.removePlayer(byId, targetId);
    const { name, token } = this.newBot();
    Object.assign(target, { bot: true, token, name, ai: pickAI(AIS, this.rng).id });
    if (s.hostId === targetId) s.hostId = this.humans()[0].id;
  }

  /** Takes a player out of the game outright; the round is abandoned if it needed them. */
  removePlayer(byId, targetId) {
    const s = this.s;
    if (byId !== targetId && !this.isHost(byId)) fail('Only the host can remove other players.');
    const index = s.players.findIndex((p) => p.id === targetId);
    if (index < 0) fail('That player is not in the game.');
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
    if (s.phase === 'lobby') return;
    if (s.players.length < MIN_PLAYERS) {
      this.returnToLobby();
    } else if (!removed.waiting) {
      this.advance(); // the round can't continue without them, so move on
    }
  }

  setHandSize(byId, size) {
    if (!this.isHost(byId)) fail('Only the host can change the hand size.');
    if (this.s.phase !== 'lobby') fail('The hand size can only be changed in the lobby.');
    const n = Math.round(Number(size));
    if (!(n >= MIN_HAND_SIZE && n <= MAX_HAND_SIZE)) {
      fail(`Hand size must be between ${MIN_HAND_SIZE} and ${MAX_HAND_SIZE}.`);
    }
    this.s.handSize = n;
  }

  setRounds(byId, count) {
    if (!this.isHost(byId)) fail('Only the host can change the number of rounds.');
    if (this.s.phase !== 'lobby') fail('The number of rounds can only be changed in the lobby.');
    const n = Math.round(Number(count));
    if (!(n >= MIN_ROUNDS_EACH && n <= MAX_ROUNDS_EACH)) {
      fail(`Each player can choose the word between ${MIN_ROUNDS_EACH} and ${MAX_ROUNDS_EACH} times.`);
    }
    this.s.roundsEach = n;
  }

  setJudging(byId, mode) {
    if (!this.isHost(byId)) fail('Only the host can change how rounds are judged.');
    if (this.s.phase !== 'lobby') fail('The judging method can only be changed in the lobby.');
    if (!JUDGING_MODES.includes(mode)) fail('Unknown judging method.');
    this.s.judging = mode;
  }

  setCategories(byId, keys) {
    if (!this.isHost(byId)) fail('Only the host can choose the categories.');
    if (this.s.phase !== 'lobby') fail('The categories can only be changed in the lobby.');
    const known = this.getCategories();
    const wanted = [...new Set(Array.isArray(keys) ? keys : [])];
    if (wanted.some((key) => !known.some((c) => c.key === key))) fail('Unknown category.');
    if (!wanted.length) fail('Pick at least one category.');
    this.s.categories = known.filter((c) => wanted.includes(c.key)).map((c) => c.key); // keep the standard order
  }

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
    const bots = s.players.filter((p) => p.bot);
    const picks = assignAIs(AIS, bots.map((p) => p.id), this.rng);
    for (const p of bots) p.ai = picks[p.id];
    this.startRound();
  }

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
      if (p.bot) delete p.ai; // a new AI is dealt at the next start
    }
  }

  // ---------- round flow ----------

  startRound() {
    const s = this.s;
    this.syncCards();
    for (const p of s.players) p.waiting = false;
    s.round++;
    // Normally just the next player in join order; anyone who has already had all their turns is skipped while
    // somebody else still owes some (this happens after skipped rounds or when someone joins late).
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

  /** Abandons the current round without scoring or discarding, and moves to the next chooser. */
  abortRound(byId) {
    if (!this.isHost(byId)) fail('Only the host can skip a round.');
    if (!['word', 'picking', 'voting'].includes(this.s.phase)) fail('There is no round to skip.');
    this.startRound();
  }

  nextHints(count = 3) {
    if (this.hintPool.length < count) {
      this.hintPool = shuffle([...this.hints], this.rng);
    }
    return this.hintPool.splice(-count, count);
  }

  submitWord(id, word) {
    const s = this.s;
    if (s.phase !== 'word') fail('It is not time to choose a word.');
    if (id !== s.chooserId) fail('Only the chooser can pick the word.');
    const clean = String(word ?? '').trim().replace(/\s+/g, ' ');
    if (!clean) fail('Type a word or phrase first.');
    if (clean.length > MAX_WORD_LENGTH) fail(`Keep it to ${MAX_WORD_LENGTH} characters or fewer.`);
    const candidates = this.cardPlayers();
    s.word = clean;
    // In the favourite style nobody is kept in the dark, so there is no imposter.
    s.imposterId = s.judging === 'favourite' ? null : candidates[Math.floor(this.rng() * candidates.length)].id;
    s.phase = 'picking';
  }

  playCard(id, cardId) {
    const s = this.s;
    if (s.phase !== 'picking') fail('It is not time to play a card.');
    const player = this.requirePlayer(id);
    if (player.waiting || id === s.chooserId) fail('You do not play a card this round.');
    if (!player.hand.includes(cardId)) fail('That card is not in your hand.');
    s.picks[id] = cardId;
    if (this.cardPlayers().every((p) => p.id in s.picks)) {
      s.tableOrder = shuffle(this.cardPlayers().map((p) => p.id), this.rng);
      s.votes = {};
      s.phase = 'voting';
    }
  }

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

  /** The players whose votes are needed before the round can end. */
  voters() {
    return this.s.judging === 'everyone' ? this.inRound() : this.inRound().filter((p) => p.id === this.s.chooserId);
  }

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

  /** Chooser-only judging: spot the imposter and the chooser scores; get fooled and the imposter scores big. */
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

  /** Favourite style: the chooser's favourite card scores, and nobody was bluffing. */
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

  /** Short public remarks for the scoreboard: who chose the word, who was the imposter and how it went. */
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
   */
  completeRound(notes = {}) {
    const s = this.s;
    const chooser = this.player(s.chooserId);
    if (chooser) chooser.turns = (chooser.turns ?? 0) + 1;
    s.completed++;
    s.history.push({ label: `Round ${s.completed}`, deltas: { ...s.results.deltas }, notes });
    s.phase = 'results';
  }

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

  /** Has every player chosen the word as many times as the host asked for? */
  allDone() {
    return this.s.players.every((p) => (p.turns ?? 0) >= this.s.roundsEach);
  }

  /** How many more rounds are needed before everyone has had all their turns. */
  roundsRemaining() {
    return this.s.players.reduce((sum, p) => sum + Math.max(0, this.s.roundsEach - (p.turns ?? 0)), 0);
  }

  /** Moves on after a round: either the next round, or the end of the game. */
  advance() {
    if (this.allDone()) this.s.phase = 'finished';
    else this.startRound();
  }

  /** Everyone sharing the highest score. */
  winnerIds() {
    return winnersOf(Object.fromEntries(this.s.players.map((p) => [p.id, p.score])));
  }

  // ---------- computer players ----------

  /** The AI a computer seat plays with (a seat saved without one gets the first, standard AI). */
  aiOf(player) {
    return aiById(AIS, player.ai);
  }

  /**
   * The next thing a computer player has to do, or null: { type: 'word' | 'card' | 'vote', id }. Computer players
   * never start the game or move on from the results: the host does that, so they can never hold a game up.
   */
  pendingBotAction() {
    const s = this.s;
    if (s.phase === 'word') {
      const chooser = this.player(s.chooserId);
      return chooser?.bot ? { type: 'word', id: chooser.id } : null;
    }
    if (s.phase === 'picking') {
      const bot = this.cardPlayers().find((p) => p.bot && !(p.id in s.picks) && p.hand.length);
      return bot ? { type: 'card', id: bot.id } : null;
    }
    if (s.phase === 'voting') {
      const bot = this.voters().find((p) => p.bot && !(p.id in s.votes));
      return bot ? { type: 'vote', id: bot.id } : null;
    }
    return null;
  }

  /** Asks the AI, and if it answers with something that is not a legal option, makes a random legal choice instead. */
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

  viewFor(id, connectedIds = new Set()) {
    const s = this.s;
    const me = this.player(id);
    if (!me) return null;
    const inPlay = ['picking', 'voting', 'results'].includes(s.phase);
    const iAmImposter = id === s.imposterId;
    const wordRevealed = ['voting', 'results'].includes(s.phase);

    let word = null;
    if (s.word !== null && (wordRevealed || (s.phase === 'picking' && !iAmImposter))) word = s.word;

    const cardsOnTable = s.phase === 'picking' ? [] : s.tableOrder.map((pid) => ({ playerId: pid, cardId: s.picks[pid] }));

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
      categories: this.getCategories().map((c) => ({
        key: c.key,
        label: c.label,
        description: c.description ?? '',
        count: c.ids.length,
        selected: s.categories.includes(c.key),
      })),
      availableCards: this.availableIds().length,
      drawCount: s.draw.length,
      discardCount: s.discard.length,
      word,
      wordHidden: s.phase === 'picking' && iAmImposter,
      me: {
        id: me.id,
        waiting: me.waiting,
        isChooser: id === s.chooserId,
        hand: me.waiting || ['lobby', 'finished'].includes(s.phase) ? [] : me.hand,
        myPick: s.picks[id] ?? null,
        myVote: s.votes[id] ?? null,
        isImposter: s.phase === 'results' && iAmImposter,
      },
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        turns: p.turns ?? 0,
        waiting: p.waiting,
        connected: p.bot || connectedIds.has(p.id),
        bot: Boolean(p.bot),
        ai: p.ai ? this.aiView(p.ai) : null, // bot seats only
        isChooser: p.id === s.chooserId,
        hasPlayed: inPlay && p.id in s.picks,
        hasVoted: s.phase === 'voting' ? p.id in s.votes : false,
      })),
      scoreboard: {
        players: s.players.map((p) => ({ id: p.id, name: p.name, userId: p.bot ? undefined : p.id, score: p.score, isMe: p.id === id, bot: Boolean(p.bot), current: p.id === s.chooserId, away: !p.bot && !connectedIds.has(p.id) })),
        rounds: s.history.map((r) => ({ label: r.label, deltas: { ...r.deltas }, notes: { ...r.notes } })),
        lowIsBetter: false,
      },
      table: cardsOnTable,
      voteTargets:
        s.phase === 'voting' && this.voters().some((v) => v.id === id)
          ? this.cardPlayers().filter((p) => p.id !== id).map((p) => p.id)
          : [],
      results: s.phase === 'results' ? s.results : null,
    };
  }
}
