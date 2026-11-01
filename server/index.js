// The site server: accounts, profiles, statistics, uploaded backgrounds, and the game modules' socket namespaces.
// This file only composes the parts: routes/ holds the HTTP routes, uploads.js the pictures, siteSocket.js the site's own socket.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { createAuth } from './auth.js';
import { createAchievements } from './achievements.js';
import { createCoins } from './coins.js';
import { openDatabase, transaction } from './db.js';
import { loadModules } from './modules.js';
import { registerRoutes } from './routes/index.js';
import { checkSettings, createShop, grandfather } from './shop.js';
import { attachSiteSocket } from './siteSocket.js';
import { createStats } from './stats.js';
import { createUploads } from './uploads.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Builds and starts the site.
 * @param {{ port?: number, dataDir?: string, modulesDir?: string, distDir?: string, log?: (...args: *[]) => void, memory?: boolean }} [options]
 *   all optional; the defaults come from the PORT, DATA_DIR and MODULES_DIR environment variables, then the project folders
 * @returns {Promise<{ server: import('node:http').Server, port: number, db: object, stats: object, achievements: object, close: () => Promise<void> }>}
 * Side effects: creates the data and uploads folders and the database, starts the modules, listens on the port and
 * starts an hourly sweep of expired sessions (stopped by `close`).
 */
export async function startSite(options = {}) {
  const port = options.port ?? (Number(process.env.PORT) || 3000);
  const dataDir = path.resolve(options.dataDir ?? process.env.DATA_DIR ?? path.join(root, 'data'));
  const modulesDir = path.resolve(options.modulesDir ?? process.env.MODULES_DIR ?? path.join(root, 'modules'));
  const distDir = options.distDir ?? path.join(root, 'dist');
  const log = options.log ?? console.log;
  const uploads = createUploads(path.join(dataDir, 'uploads'));

  const db = openDatabase(options.memory ? ':memory:' : dataDir);
  grandfather(db); // whoever already uses something now sold in the shop keeps it
  const backpaid = transaction(db, () => createCoins(db).creditPastResults()); // and whoever won before coins existed is paid for it
  if (backpaid.games) log(`Paid ${backpaid.coins} gold for ${backpaid.games} earlier placings.`);
  const canUse = (userId, settings) => checkSettings(db, userId, settings); // the shop decides what a profile may use
  const auth = createAuth(db, { canUse });
  const shop = createShop(db);
  const coins = createCoins(db);
  let moduleList = [];
  const listGames = () => moduleList;
  // (io is made below, before anything can be recorded or played)
  const achievements = createAchievements(db, { listGames, statsFor: (userId) => stats.forUser(userId), notify: (userId) => io.to(`user:${userId}`).emit('achievements'), measures: { member: () => 1, coinsSpent: coins.spent, customised: shop.customised } });
  const stats = createStats(db, listGames, {
    // Bot accounts take part in games but never earn coins. There is no minimum number of people: beating
    // computer players pays the same as beating people.
    onPlayerRecorded: (resultId, player, { isBot }) => {
      if (!isBot) coins.awardPlacement(player.userId, resultId, player);
    },
    onRecorded: (userIds) => userIds.forEach((id) => achievements.settle(id)),
  });

  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY ? 1 : false);
  const server = http.createServer(app);
  const io = new Server(server);
  attachSiteSocket(io, auth);

  const modules = await loadModules({ dir: modulesDir, io, app, auth, stats, achievements, dataDir, owns: shop.owns, log });
  moduleList = modules.list();
  for (const meta of moduleList) for (const problem of achievements.problems(meta)) log(`Achievement problem: ${problem}`);

  registerRoutes(app, { auth, achievements, coins, shop, stats, modules, uploads, canUse, listGames, distDir });

  const sweep = setInterval(() => auth.deleteExpiredSessions(), 60 * 60 * 1000);
  sweep.unref();

  await new Promise((resolve) => server.listen(port, resolve));
  const actualPort = server.address().port;
  log(`Game hub listening on http://localhost:${actualPort} with ${moduleList.length} game(s): ${moduleList.map((g) => g.id).join(', ') || 'none'}`);

  return {
    server,
    port: actualPort,
    db,
    stats,
    achievements,
    /**
     * Stops the site.
     * @returns {Promise<void>}
     * Side effects: stops the sweep, disposes the modules, closes the sockets, connections and database.
     */
    async close() {
      clearInterval(sweep);
      await modules.dispose();
      await new Promise((resolve) => io.close(resolve)); // also closes the HTTP server
      server.closeAllConnections?.();
      db.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startSite().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
