// The socket layer for Dixnt.  The rules live in game.js; the rooms, saving, views, joining, leaving and the lobby
// events are the shared room server (shared/roomServer.js), driven through the player-list rules of shared/roster.js.
// This file says only what is particular to Dixnt: where the cards and the word suggestions come from, its settings,
// its own socket events (hints, submitWord, playCard, vote, nextRound, abortRound), what the server must do by itself
// (a computer player's move), and the cards each person has been dealt (the `art` achievement).
//
// Timing can be changed through the environment (the tests make it fast):
//   DIXNT_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
//   DIXNT_CARDS_DIR   where the card images are (see resolveCardsDir)
//
// Depends on shared/roomServer.js (the room server and its timing helpers) and ./game.js (the rules).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { numberFrom } from '../../shared/input.js';
import { msg } from '../../shared/messages.js';
import { botWait, createRoomServer, pickKeys, readDelayRange } from '../../shared/roomServer.js';
import { renameInHistory } from '../../shared/roster.js';
import { createRules } from './game.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** How long the list of categories is reused before the card folder is read again. */
const CATEGORY_CACHE_MS = 5000;

/**
 * Finds the folder of card images: DIXNT_CARDS_DIR, else ./cards, else the original dixit project's cards.
 *
 * @returns {string} an absolute path (it may not exist)
 * Side effects: reads an environment variable and checks the filesystem; changes nothing.
 */
function resolveCardsDir() {
  if (process.env.DIXNT_CARDS_DIR) return path.resolve(process.env.DIXNT_CARDS_DIR);
  const own = path.join(here, 'cards');
  if (fs.existsSync(own)) return own;
  return path.resolve(here, '..', '..', '..', 'dixit', 'game', 'cards');
}

/**
 * Reads the chooser's word suggestions from hints.txt, one per line.
 *
 * @returns {string[]} the non-empty lines, trimmed (empty if there is no file)
 * Side effects: reads hints.txt; changes nothing.
 */
function loadHints() {
  const file = path.join(here, 'hints.txt');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The account id a saved game's seat token named ('user:7'), or null for a computer player or anything unreadable.
 *
 * @param {string} token  the token of a seat in a game saved before rooms.json
 * @returns {number | null}
 * Side effects: none.
 */
const userIdOf = (token) => (/^user:\d+$/.test(String(token)) ? Number(String(token).slice(5)) : null);

/**
 * Only the settings Dixnt accepts, whatever else a client sends.
 *
 * @param {object} payload  the untrusted settings object from the client
 * @returns {object} a copy with only the allowed keys
 * Side effects: none.
 */
const pickSettings = (payload) => pickKeys(payload, ['handSize', 'roundsEach', 'judging', 'categories']);

/**
 * Brings the games saved before Dixnt used the shared room server (`games.json`, one entry per invite code, seats
 * with made-up public ids and `user:<n>` tokens) over to `rooms.json` (an array of rooms whose people are known by
 * their account id).  It runs once: afterwards the old file is kept as `games.json.imported`, so nothing is thrown
 * away and the import is not tried again.
 *
 * @param {object} ctx  the module context (for dataDir and log)
 * @param {object} rules  the rules, for renameId
 * @returns {void}
 * Side effects: may write rooms.json and rename games.json; logs what it did.
 */
function importOldSave(ctx, rules) {
  const oldFile = path.join(ctx.dataDir, 'games.json');
  const newFile = path.join(ctx.dataDir, 'rooms.json');
  if (!fs.existsSync(oldFile) || fs.existsSync(newFile)) return;
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
  } catch (error) {
    ctx.log(`the old saved games could not be read (${error.message}); starting with none`);
    return;
  }
  const rooms = [];
  for (const [code, entry] of Object.entries(saved?.games ?? {})) {
    try {
      const room = entry.game;
      if (!room || !Array.isArray(room.players)) continue;
      room.code = code;
      room.createdAt = entry.touched;
      room.updatedAt = entry.touched;
      room.recorded = Boolean(entry.recorded);
      // A person is known by their account from now on, and a computer player by the id its token already was.
      let dropped = false;
      for (const player of [...room.players]) {
        const account = userIdOf(player.token);
        const wasHost = room.hostId === player.id;
        const newId = player.kind === 'bot' || player.bot === true ? String(player.token) : account;
        if (newId === null) {
          dropped = true;
          break;
        }
        // The counters used to be kept beside the game, one set per person; they belong to the player now.
        if (account !== null) Object.assign(player, entry.tally?.[player.token] ?? {});
        rules.renameId(room, player.id, newId);
        // This room was saved before slots existed, so its history is still keyed by the made-up public ids; rename
        // those too, and `migrate` below turns the whole lot into slots.  Everywhere else the history is written by
        // slot and a rename never touches it.
        renameInHistory(room, player.id, newId);
        player.id = newId;
        if (wasHost) room.hostId = newId;
      }
      if (dropped) {
        ctx.log(`the saved game ${code} named somebody the site does not know; it was left behind`);
        continue;
      }
      rooms.push(rules.migrate(room));
    } catch (error) {
      ctx.log(`the saved game ${code} could not be brought over: ${error.message}`);
    }
  }
  try {
    fs.writeFileSync(newFile, JSON.stringify(rooms));
    fs.renameSync(oldFile, `${oldFile}.imported`);
    ctx.log(`${rooms.length} saved game(s) brought over to rooms.json`);
  } catch (error) {
    ctx.log(`the saved games could not be brought over: ${error.message}`);
  }
}

/**
 * Starts the Dixnt server half.
 *
 * @param {object} ctx  what the platform gives a module: io, mount, dataDir, codes, stats, achievements, users, log,
 *                      and optionally `rng` (a () => [0, 1) generator; the shared room server chooses the default)
 * @returns {{ dispose: () => void }} stops the timers and saves the rooms
 * Side effects: mounts /cards, brings any old save over, and then as createRoomServer (reads the saved rooms, starts
 * timers, registers the socket events).
 */
export default function (ctx) {
  const botDelay = readDelayRange('DIXNT_BOT_DELAY', '600-1400');
  const cardsDir = resolveCardsDir();
  const hints = loadHints();
  ctx.mount('/cards', cardsDir, { maxAge: '7d', immutable: true });

  /**
   * Ids of every card that has a web-sized image on disk.
   *
   * @returns {number[]} sorted ascending
   * Side effects: reads the card image folder; changes nothing.
   */
  function getCardIds() {
    const dir = path.join(cardsDir, 'medium');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .map((name) => /^card_(\d+)\.jpg$/.exec(name))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
  }

  /**
   * The cards grouped into categories. cards/categories.json lists the categories; only cards whose image exists
   * are offered.  Without that file every card is one "All cards" category.  The answer is cached for five seconds.
   *
   * @returns {{ key: string, label: string | object, description: string, ids: number[] }[]} the label of the
   *          made-up "all cards" category is a message; the labels in categories.json are content and stay as they are
   * Side effects: reads cards/categories.json and the card folder; refreshes the five-second cache.
   */
  let categoryCache = { at: 0, value: [] };
  function getCategories() {
    if (Date.now() - categoryCache.at < CATEGORY_CACHE_MS) return categoryCache.value;
    const present = new Set(getCardIds());
    let defined = null;
    try {
      defined = JSON.parse(fs.readFileSync(path.join(cardsDir, 'categories.json'), 'utf8')).categories;
    } catch {
      // no categories file
    }
    let value;
    if (!Array.isArray(defined)) {
      value = present.size ? [{ key: 'all', label: msg('lobby.allCards'), description: '', ids: [...present] }] : [];
    } else {
      value = defined
        .map((c) => ({ key: c.key, label: c.label, description: c.description ?? '', ids: c.ids.filter((id) => present.has(id)) }))
        .filter((c) => c.ids.length);
    }
    categoryCache = { at: Date.now(), value };
    return value;
  }

  const game = createRules({ getCategories, hints });
  const rng = ctx.rng; // undefined in the real site: the shared room server then chooses Math.random, once
  /** An account's display name (for rooms saved before names were kept). */
  const nameOf = (id) => ctx.users?.get(id)?.displayName ?? 'Someone';

  importOldSave(ctx, game);

  /**
   * Adds the cards each person now holds to the ones they have been dealt (the `art` achievement).  Hands only change
   * when cards are dealt, which happens when a round starts, so this is done once a round rather than at every change.
   *
   * @param {object} room  the room that has just changed
   * @returns {void}
   * Side effects: calls ctx.achievements.collect for each person and stamps room.collectedRound; a failure is logged.
   */
  function collectCards(room) {
    if (room.phase === 'lobby' || room.round === room.collectedRound) return;
    room.collectedRound = room.round;
    for (const player of room.players) {
      if (player.kind !== 'human' || !player.hand?.length) continue;
      try {
        ctx.achievements?.collect(player.id, 'art', player.hand);
      } catch (error) {
        ctx.log(`could not collect cards: ${error.message}`);
      }
    }
  }

  const handle = createRoomServer(ctx, {
    game,
    pickSettings,
    rng,
    members: (room) => room.players,
    kickKey: 'userId', // the client names the person to remove by account id, not by a seat number
    migrate: (room) => game.migrate(room, nameOf, rng ?? Math.random),
    afterChange: collectCards,
    /**
     * A computer player's move, if one is due.  A move that is refused is reported as a failure (it would otherwise
     * be repeated for ever), so the room server's retry-with-a-pause takes over.
     *
     * @param {object} room  the room
     * @param {() => number} roomRng  the server's random source
     * @returns {{ wait: number, run: () => void } | null} what to schedule, or null when nothing is due
     * Side effects: none itself; the returned run() plays the move.
     */
    nextAction(room, roomRng) {
      const action = game.pendingBotAction(room);
      if (!action) return null;
      return {
        wait: botWait(botDelay, roomRng),
        run() {
          if (!game.runBotAction(room, roomRng, action)) throw new Error(`the computer move ${action.type} for ${action.id} was refused`);
        },
      };
    },
    /**
     * Registers Dixnt's own socket events; each one runs a game.js action for the connected user and shares the result.
     *
     * @param {object} hooks  { act, on, userId, rng, roomOf }
     * @returns {void}
     * Side effects: adds socket listeners; each event may change the room through game.js.
     */
    registerEvents({ act, on, userId, rng: eventRng, roomOf }) {
      // Suggestions for the chooser: a read, not a move, so it does not go through `act`.
      on('hints', () => {
        const room = roomOf();
        if (!room) return { ok: false, error: 'notInAnyGame' };
        return { ok: true, hints: game.nextHints(room, 3, eventRng) };
      });
      on('submitWord', ({ word }) => act((room) => game.submitWord(room, userId, word, eventRng)));
      on('playCard', ({ cardId }) => act((room) => game.playCard(room, userId, numberFrom(cardId), eventRng)));
      on('vote', ({ targetId }) => act((room) => game.vote(room, userId, targetId)));
      on('nextRound', () => act((room) => game.nextRound(room, userId, eventRng)));
      on('abortRound', () => act((room) => game.abortRound(room, userId, eventRng)));
    },
  });

  ctx.log(`${getCardIds().length} cards in ${getCategories().length} categories, ${hints.length} hints, ${handle.rooms.size} saved games`);
  return handle;
}
