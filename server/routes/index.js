// Puts every route of the site together: /uploads, the JSON API under /api, the built client, and the error handler.
import express from 'express';
import { makeRequireUser } from './http.js';
import { registerAchievementRoutes } from './achievements.js';
import { registerAuthRoutes } from './auth.js';
import { registerErrorHandler } from './errorHandler.js';
import { registerGameRoutes } from './games.js';
import { registerProfileRoutes } from './profile.js';
import { registerShopRoutes } from './shop.js';
import { registerStaticRoutes } from './static.js';
import { registerStatsRoutes } from './stats.js';
import { registerUploadRoutes } from './uploads.js';

/**
 * Makes the /api router: every change must be sent as JSON (apart from the image uploads), and the body is parsed.
 * @returns {import('express').Router}
 * Side effects: none.
 */
function createApiRouter() {
  const api = express.Router();
  // Requiring JSON on every change (apart from the image upload) means a form on another website cannot make changes.
  api.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/me/background-image' || req.path === '/me/card-back-image') return next();
    if (!req.is('application/json')) return res.status(415).json({ error: 'Send JSON.' });
    next();
  });
  api.use(express.json({ limit: '20kb' }));
  return api;
}

/**
 * Registers every route on the app.
 * @param {import('express').Express} app
 * @param {{ auth: object, achievements: object, coins: object, shop: object, stats: object, modules: object, uploads: object, canUse: Function, listGames: () => object[], distDir: string }} deps
 * @returns {void}
 * Side effects: adds all routes and middleware to the app (the order matters: API, then the client, then the error handler).
 */
export function registerRoutes(app, deps) {
  const requireUser = makeRequireUser(deps.auth);
  const all = { ...deps, requireUser };
  app.use('/uploads', deps.uploads.serve);

  const api = createApiRouter();
  registerAuthRoutes(api, all);
  registerGameRoutes(api, all);
  registerProfileRoutes(api, all);
  registerUploadRoutes(api, all);
  registerShopRoutes(api, all);
  registerStatsRoutes(api, all);
  registerAchievementRoutes(api, all);
  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', api);

  registerStaticRoutes(app, deps);
  registerErrorHandler(app);
}
