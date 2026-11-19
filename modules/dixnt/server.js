// The socket layer for Dixnt.  The rules live in game.js; the rooms, saving, views, joining, leaving and the lobby
// events are the shared room server (shared/roomServer.js), driven through the player-list rules of shared/roster.js.
// This file says only what is particular to Dixnt: where the cards and the word suggestions come from, its settings,
// its own socket events (hints, submitWord, playCard, vote, nextTurn, abortTurn), what the server must do by itself
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
import { accountNames, botMove, botWait, createRoomServer, pickKeys, readDelayRange } from '../../shared/roomServer.js';
import { rosterLayout } from '../../shared/layout.js';
import * as game from './game.js';

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
 * Only the settings Dixnt accepts, whatever else a client sends.
 *
 * @param {object} payload  the untrusted settings object from the client
 * @returns {object} a copy with only the allowed keys
 * Side effects: none.
 */
const pickSettings = (payload) => pickKeys(payload, ['handSize', 'rounds', 'judging', 'noChooser', 'categories', 'size']);

/**
 * Starts the Dixnt server half.
 *
 * @param {object} ctx  what the platform gives a module: io, mount, dataDir, codes, stats, achievements, users, log
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

  // The rules are told where the cards are, once; from here on they are plain functions of a room, as in every game.
  game.setCards({ getCategories, hints });
  /** An account's display name (for rooms saved before names were kept). */
  const nameOf = accountNames(ctx);

  /**
   * Adds the cards each person now holds to the ones they have been dealt (the `art` achievement).  Hands only change
   * when cards are dealt, which happens when a turn starts, so this is done once a turn rather than at every change.
   *
   * @param {object} room  the room that has just changed
   * @returns {void}
   * Side effects: calls ctx.achievements.collect for each person and stamps room.collectedTurn; a failure is logged.
   */
  function collectCards(room) {
    if (room.phase === 'lobby' || room.turn === room.collectedTurn) return;
    room.collectedTurn = room.turn;
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
    members: (room) => room.players,
    layout: rosterLayout, // a list of players rather than numbered seats (shared/layout.js)
    // Loading a room may shuffle cards that have appeared on disk since it was saved into its draw pile.  That is the
    // one random choice made outside a game's own events, so it is given its source here, in the socket layer.
    migrate: (room) => game.migrate(room, nameOf, Math.random),
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
      return action ? botMove(action, botWait(botDelay, roomRng), () => game.runBotAction(room, roomRng, action)) : null;
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
      on('nextTurn', () => act((room) => game.nextTurn(room, userId, eventRng)));
      on('abortTurn', () => act((room) => game.abortTurn(room, userId, eventRng)));
    },
  });

  ctx.log(`${getCardIds().length} cards in ${getCategories().length} categories, ${hints.length} hints, ${handle.rooms.size} saved games`);
  return handle;
}
