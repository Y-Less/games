// Finds and starts the game modules in modules/<id>/.  See MODULES.md for the contract.
//
//   modules/<id>/module.json   { id, name, description, minPlayers, maxPlayers, category, rules, stats, achievements }
//   modules/<id>/server.js     export default function (ctx) { ... }   (the rules and the socket handlers)
//   modules/<id>/client/index.js   a Vue component, loaded by the site into its play field
// Depends on: express (static assets), ./auth.js (sessions), ./codes.js, ./turnClock.js, and shared/achievements.js and
// shared/markerColours.js.  The loaded module receives a `ctx` object built here (see loadModules).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCookies, SESSION_COOKIE } from './auth.js';
import { codes } from './codes.js';
import { watchTurns } from './turnClock.js';
import { cleanDefinition, GAME_ACHIEVEMENTS } from '../shared/achievements.js';
import { isLanguageTag } from '../shared/languages.js';
import { CUSTOM_MARKER_ITEM, isPresetMarker, normaliseMarker } from '../shared/markerColours.js';

const ID = /^[a-z][a-z0-9-]{1,30}$/;

/**
 * The module's own achievements after the two every game has (played, won), unless it defines a key of that name itself.
 * @param {object[]} own  the module's cleaned achievement definitions
 * @returns {object[]} the standard ones (minus any it overrides) followed by its own
 * Side effects: none.
 */
function withStandardAchievements(own) {
  return [...GAME_ACHIEVEMENTS.filter((a) => !own.some((o) => o.key === a.key)).map((a) => cleanDefinition(a)), ...own];
}

/**
 * What a module says about itself, once its module.json has been read and every default filled in.  This is the shape
 * the whole site relies on — the menu, the leaderboards, the achievements check — so it is written down rather than
 * described.
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   description: string,
 *   minPlayers: number,
 *   maxPlayers: number,
 *   category: string,
 *   rules: string | null,
 *   stats: Array<{ key: string, label: string, agg?: string, hidden?: boolean }>,
 *   achievements: object[],
 *   rejectedAchievements: string[],
 * }} ModuleMeta
 */

/**
 * Reads and tidies a module's module.json, filling defaults so the rest of the site can rely on every field.
 * @param {string} dir  the modules directory
 * @param {string} folder  the module's folder name, which must equal the manifest's id
 * @returns {ModuleMeta}
 * Side effects: reads module.json; throws if it is missing, malformed, or its id does not match the folder.
 */
function readManifest(dir, folder) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, folder, 'module.json'), 'utf8'));
  if (!ID.test(manifest.id) || manifest.id !== folder) throw new Error(`module.json id must match the folder name "${folder}"`);
  const own = Array.isArray(manifest.achievements) ? manifest.achievements : [];
  return {
    id: manifest.id,
    name: String(manifest.name ?? manifest.id),
    description: String(manifest.description ?? ''),
    minPlayers: Number(manifest.minPlayers ?? 1),
    maxPlayers: Number(manifest.maxPlayers ?? manifest.minPlayers ?? 1),
    category: String(manifest.category ?? 'other'),
    rules: manifest.rules ? String(manifest.rules) : null,
    stats: Array.isArray(manifest.stats) ? manifest.stats.filter((s) => s?.key && s?.label) : [],
    achievements: withStandardAchievements(own.map(cleanDefinition).filter(Boolean)),
    // The definitions cleanDefinition refused (a misspelt tier name, levels out of order, a missing name): named here so
    // that the start-up check (achievements.problems) can say so, rather than an achievement quietly going missing.
    rejectedAchievements: own.filter((a) => !cleanDefinition(a)).map((a) => String(a?.key ?? '?')),
  };
}

/**
 * Loads every module and starts its server half.  A module that fails to load is logged and skipped, not fatal.
 * @param {object} options
 * @param {string} options.dir  the modules directory
 * @param {import('socket.io').Server} options.io  the socket server; each module gets the namespace `/<id>`
 * @param {import('express').Express} options.app  the web app, for serving each module's assets
 * @param {object} options.auth  the auth service (userForToken, userById)
 * @param {object} options.stats  the stats service (record)
 * @param {object} [options.achievements]  the achievements service (forGame)
 * @param {string} options.dataDir  where per-module data folders are created
 * @param {(userId: number, item: string) => boolean} [options.owns]  whether a user owns a shop item
 * @param {(...args: any[]) => void} [options.log]  the logger (console.log by default)
 * @returns {Promise<{ list: () => object[], tournamentsOf: (userId: number) => object[], rules: (id: string) => string | null, dispose: () => Promise<void> }>}
 * Side effects: registers socket middleware per namespace, creates data folders, mounts static routes on `app`, imports and
 *   runs each module's server.js, and wraps each connected socket's `emit` to time slow turns.
 */
export async function loadModules({ dir, io, app, auth, stats, achievements, dataDir, owns = () => false, log = console.log }) {
  const modules = new Map(); // id -> { meta, dir, dispose, openFor }
  // Whoever is waiting for any game anywhere to finish.  A module that runs games on other modules' behalf (the tour)
  // subscribes here; `shared/roomLife.js` is what calls it, once per finished game.
  const finishWatchers = new Set();

  /**
   * The other games, as a module may reach them.  Every method looks `modules` up when it is called, never when this
   * object is made: a module's ctx is built before the rest of them have loaded, and the tour asks long afterwards.
   * @param {string} me  the id of the module being given this, which is left out of `list`
   * @returns {{ list: Function, open: Function, onFinished: Function }}
   * Side effects: none here; `open` creates and starts a room in another module.
   */
  const gamesFor = (me) => ({
    /** Every other loaded game's manifest, by name.  @returns {object[]} */
    list: () => [...modules.values()].map((m) => m.meta).filter((meta) => meta.id !== me).sort((a, b) => a.name.localeCompare(b.name)),
    /**
     * Opens a started room in another game and gives back its code, for people to walk into by invitation.
     * @param {string} id  the game to open
     * @param {object} options  as shared/roomServer.js's openFor: { hostId, hostName, people, size, settings }
     * @returns {{ ok: boolean, code?: string, seated?: number[], error?: string, params?: object }}
     */
    open(id, options) {
      const entry = modules.get(id);
      if (!entry) return { ok: false, error: 'noSuchGame' };
      if (!entry.openFor) return { ok: false, error: 'gameCannotBeOpened' }; // a module that is not room-based
      return entry.openFor(options);
    },
    /**
     * Calls back whenever a game in any module finishes.
     * @param {(id: string, room: object) => void} handler
     * @returns {() => void} stops listening
     */
    onFinished(handler) {
      finishWatchers.add(handler);
      return () => finishWatchers.delete(handler);
    },
  });
  const folders = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => fs.statSync(path.join(dir, d.name), { throwIfNoEntry: false })?.isDirectory()) : [];

  for (const folder of folders) {
    if (!fs.existsSync(path.join(dir, folder.name, 'module.json'))) continue;
    try {
      const meta = readManifest(dir, folder.name);
      const namespace = io.of(`/${meta.id}`);
      // Every connection to a game is made by a signed-in user (the session cookie is sent with the socket handshake).
      namespace.use((socket, next) => {
        const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
        const user = auth.userForToken(token);
        if (!user) return next(new Error('Please sign in.'));
        socket.data.user = { id: user.id, name: user.displayName, isBot: user.isBot };
        watchSlowTurns(socket);
        next();
      });

      // A player who keeps a game waiting for over ten minutes on their turn, while connected, earns the global `global.slow` achievement.
      // Wraps socket.emit so every `state` view sent to this player is also shown to the turn clock; returns nothing.
      const watchSlowTurns = (socket) => {
        const watch = watchTurns({ onSlow: () => achievements?.forGame(meta.id).raise(socket.data.user.id, 'global.slow', 1) });
        const emit = socket.emit.bind(socket);
        socket.emit = (event, ...args) => {
          if (event === 'state') watch(args[0] ?? null);
          return emit(event, ...args);
        };
      };

      const moduleDataDir = path.join(dataDir, 'modules', meta.id);
      fs.mkdirSync(moduleDataDir, { recursive: true });
      const ctx = {
        id: meta.id,
        /** What this module says about itself (module.json, with every default filled in).  The shared room server
         *  reads `minPlayers` and `maxPlayers` from it: a tournament table must be a game this game can play. */
        meta,
        io: namespace,
        dataDir: moduleDataDir,
        stats: { record: (result) => stats.record(meta.id, result) },
        /** Achievements (shared/achievements.js): add / raise saved progress, and read any player's (the global ones as "global.<key>"). */
        achievements: achievements?.forGame(meta.id),
        users: { get: (id) => auth.userById(id) },
        /** Marker colours (shared/markerColours.js): what a player may use, and the default they saved. */
        markers: {
          canCustom: (id) => owns(id, CUSTOM_MARKER_ITEM),
          /** The player's default colour if they may still use it (an unlock they own, or a free colour), else null. */
          preferred(id) {
            const colour = normaliseMarker(auth.userById(id)?.markerColour);
            return colour && (isPresetMarker(colour) || owns(id, CUSTOM_MARKER_ITEM)) ? colour : null;
          },
        },
        codes,
        /** The other games: what they are, opening one, and hearing that any game anywhere has finished. */
        games: gamesFor(meta.id),
        /**
         * Sends an event to one person on the site's own socket, which they hold open on every page (server/siteSocket.js).
         * This reaches them wherever they are — including inside a different game — where `ctx.io` only reaches somebody
         * looking at this module.  A tour needs it to say that the game it sent everybody to is over.
         * @param {number} userId  the account to tell
         * @param {string} event  the event name
         * @param {object} [payload]  what to send
         * @returns {void}  Side effects: emits on the default namespace.
         */
        tell(userId, event, payload) {
          io.to(`user:${userId}`).emit(event, payload);
        },
        /**
         * Told by shared/roomLife.js, once, whenever a game in this module ends.  A module never sets this; it is here
         * so that every room-based game reports a finished game without its server.js saying anything at all.
         * @param {object} room  the finished room
         * @returns {void}  Side effects: runs every watcher; one that throws is logged and the others still run.
         */
        onGameFinished(room) {
          for (const watcher of finishWatchers) {
            try {
              watcher(meta.id, room);
            } catch (error) {
              log(`[${meta.id}] a watcher of finished games failed:`, error);
            }
          }
        },
        /** Serves a folder of the module's files (e.g. images) at /assets/<id>/<subpath>. */
        mount: (subpath, folderPath, options = {}) => app.use(`/assets/${meta.id}${subpath}`, express.static(folderPath, options)),
        log: (...args) => log(`[${meta.id}]`, ...args),
      };
      const publicDir = path.join(dir, meta.id, 'public');
      if (fs.existsSync(publicDir)) ctx.mount('', publicDir, { maxAge: '7d' });

      const entry = await import(pathToFileURL(path.join(dir, meta.id, 'server.js')).href);
      const handle = (await entry.default(ctx)) ?? {};
      // `openFor` and `tournamentsOf` are on the handle every room-based game returns from createRoomServer, so
      // collecting them here reaches all of them without a single module's server.js mentioning either.
      modules.set(meta.id, { meta, dir: path.join(dir, meta.id), dispose: handle.dispose, openFor: handle.openFor, tournamentsOf: handle.tournamentsOf });
      log(`module loaded: ${meta.id} (${meta.name})`);
    } catch (error) {
      console.error(`Could not load module "${folder.name}":`, error);
    }
  }

  return {
    /** The loaded modules' manifests, sorted by name.  @returns {ModuleMeta[]}  Side effects: none. */
    list: () => [...modules.values()].map((m) => m.meta).sort((a, b) => a.name.localeCompare(b.name)),
    /**
     * Every tournament this person is in, across every game, newest news first.
     *
     * A tournament is played over as long as its people like — a round an evening, if that suits them — so it is not
     * something you are expected to still have open in a tab.  This is what the site's own list of them is built
     * from, and each row says which game it is so that one list can hold the lot.
     *
     * @param {number} userId  whose tournaments
     * @returns {Array<object & { game: string, name: string }>}
     * Side effects: none (each module answers from its own store's index).
     */
    tournamentsOf(userId) {
      const rows = [];
      for (const { meta, tournamentsOf } of modules.values()) {
        if (!tournamentsOf) continue; // a module that is not room-based has no tournaments to be in
        try {
          for (const row of tournamentsOf(userId)) rows.push({ ...row, game: meta.id, name: meta.name });
        } catch (error) {
          log(`[${meta.id}] could not list the tournaments:`, error);
        }
      }
      return rows.sort((one, other) => other.updatedAt - one.updatedAt);
    },
    /**
     * The text of a module's rules file, or null when it has none; refuses paths that escape the module's folder.  With a
     * language, a translation next to the rules file (rules.md -> rules.fr.md) is preferred when there is one.
     * @param {string} id  the module id
     * @param {string} [lang]  a language tag such as 'fr' or 'pt-BR' ('' or anything that is not a tag: the original)
     * @returns {string | null} the rules text
     * Side effects: reads a file.
     */
    rules(id, lang = '') {
      const entry = modules.get(id);
      if (!entry?.meta.rules) return null;
      const original = path.resolve(entry.dir, entry.meta.rules);
      const translated = isLanguageTag(lang) ? original.replace(/\.md$/, `.${lang}.md`) : null;
      for (const file of [translated, original]) {
        if (file && file.startsWith(entry.dir + path.sep) && fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return fs.readFileSync(file, 'utf8');
      }
      return null;
    },
    /**
     * Stops every module that offers a dispose hook, one after another.
     * @returns {Promise<void>}
     * Side effects: runs each module's own cleanup (timers, files, etc.).
     */
    async dispose() {
      for (const { dispose } of modules.values()) await dispose?.();
    },
  };
}
