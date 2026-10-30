// Finds and starts the game modules in modules/<id>/. See MODULES.md for the contract.
//
//   modules/<id>/module.json   { id, name, description, minPlayers, maxPlayers, category, rules, stats }
//   modules/<id>/server.js     export default function (ctx) { ... }   (the rules and the socket handlers)
//   modules/<id>/client/index.js   a Vue component, loaded by the site into its play field
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCookies, SESSION_COOKIE } from './auth.js';
import { codes } from './codes.js';
import { watchTurns } from './turnClock.js';
import { cleanDefinition, GAME_ACHIEVEMENTS } from '../shared/achievements.js';
import { CUSTOM_MARKER_ITEM, isPresetMarker, normaliseMarker } from '../shared/markerColours.js';

const ID = /^[a-z][a-z0-9-]{1,30}$/;

/** The module's own achievements after the two every game has (played, won), unless it defines a key of that name itself. */
function withStandardAchievements(own) {
  return [...GAME_ACHIEVEMENTS.filter((a) => !own.some((o) => o.key === a.key)).map((a) => cleanDefinition(a)), ...own];
}

function readManifest(dir, folder) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, folder, 'module.json'), 'utf8'));
  if (!ID.test(manifest.id) || manifest.id !== folder) throw new Error(`module.json id must match the folder name "${folder}"`);
  return {
    id: manifest.id,
    name: String(manifest.name ?? manifest.id),
    description: String(manifest.description ?? ''),
    minPlayers: Number(manifest.minPlayers ?? 1),
    maxPlayers: Number(manifest.maxPlayers ?? manifest.minPlayers ?? 1),
    category: String(manifest.category ?? 'other'),
    rules: manifest.rules ? String(manifest.rules) : null,
    stats: Array.isArray(manifest.stats) ? manifest.stats.filter((s) => s?.key && s?.label) : [],
    achievements: withStandardAchievements(Array.isArray(manifest.achievements) ? manifest.achievements.map(cleanDefinition).filter(Boolean) : []),
  };
}

/**
 * Loads every module and starts its server half.
 * @returns {Promise<{ list: () => object[], rules: (id: string) => string | null, dispose: () => Promise<void> }>}
 */
export async function loadModules({ dir, io, app, auth, stats, achievements, dataDir, owns = () => false, log = console.log }) {
  const modules = new Map(); // id -> { meta, dispose }
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

      // A player who keeps a game waiting for over ten minutes on their turn, while connected, earns the global "Take your time".
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
        /** Serves a folder of the module's files (e.g. images) at /assets/<id>/<subpath>. */
        mount: (subpath, folderPath, options = {}) => app.use(`/assets/${meta.id}${subpath}`, express.static(folderPath, options)),
        log: (...args) => log(`[${meta.id}]`, ...args),
      };
      const publicDir = path.join(dir, meta.id, 'public');
      if (fs.existsSync(publicDir)) ctx.mount('', publicDir, { maxAge: '7d' });

      const entry = await import(pathToFileURL(path.join(dir, meta.id, 'server.js')).href);
      const handle = (await entry.default(ctx)) ?? {};
      modules.set(meta.id, { meta, dir: path.join(dir, meta.id), dispose: handle.dispose });
      log(`module loaded: ${meta.id} (${meta.name})`);
    } catch (error) {
      console.error(`Could not load module "${folder.name}":`, error);
    }
  }

  return {
    list: () => [...modules.values()].map((m) => m.meta).sort((a, b) => a.name.localeCompare(b.name)),
    rules(id) {
      const entry = modules.get(id);
      if (!entry?.meta.rules) return null;
      const file = path.resolve(entry.dir, entry.meta.rules);
      if (!file.startsWith(entry.dir + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return null;
      return fs.readFileSync(file, 'utf8');
    },
    async dispose() {
      for (const { dispose } of modules.values()) await dispose?.();
    },
  };
}
