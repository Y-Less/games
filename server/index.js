// The site server: accounts, profiles, statistics, uploaded backgrounds, and the game modules' socket namespaces.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { AuthError, BACKGROUND_PRESETS, CARD_BACK_PRESETS, clearedCookie, parseCookies, SESSION_COOKIE, sessionCookie, createAuth } from './auth.js';
import { openDatabase } from './db.js';
import { loadModules } from './modules.js';
import { createStats } from './stats.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IMAGE_TYPES = {
  'image/png': { ext: 'png', magic: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  'image/jpeg': { ext: 'jpg', magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', magic: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
};

/**
 * Builds and starts the site. Returns { server, port, close }.
 * Options (all optional): port, dataDir, modulesDir, distDir, log.
 */
export async function startSite(options = {}) {
  const port = options.port ?? (Number(process.env.PORT) || 3000);
  const dataDir = path.resolve(options.dataDir ?? process.env.DATA_DIR ?? path.join(root, 'data'));
  const modulesDir = path.resolve(options.modulesDir ?? process.env.MODULES_DIR ?? path.join(root, 'modules'));
  const distDir = options.distDir ?? path.join(root, 'dist');
  const uploadsDir = path.join(dataDir, 'uploads');
  const log = options.log ?? console.log;
  fs.mkdirSync(uploadsDir, { recursive: true });

  const db = openDatabase(options.memory ? ':memory:' : dataDir);
  const auth = createAuth(db);
  let moduleList = [];
  const stats = createStats(db, () => moduleList);

  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY ? 1 : false);
  const server = http.createServer(app);
  const io = new Server(server);

  const modules = await loadModules({ dir: modulesDir, io, app, auth, stats, dataDir, log });
  moduleList = modules.list();

  // ---- helpers ----
  const tokenOf = (req) => parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const requireUser = (req, res, next) => {
    const user = auth.userForToken(tokenOf(req));
    if (!user) return res.status(401).json({ error: 'Please sign in.' });
    req.user = user;
    next();
  };
  const handler = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };
  /** Deletes a user's uploaded pictures of one kind ('bg' for backgrounds, 'cb' for card backs), except one file. */
  const removeImages = (kind, userId, except = null) => {
    for (const file of fs.readdirSync(uploadsDir)) {
      if (file.startsWith(`${kind}-${userId}-`) && file !== except) fs.rmSync(path.join(uploadsDir, file), { force: true });
    }
  };

  // ---- API ----
  app.use('/uploads', express.static(uploadsDir, { maxAge: '30d', immutable: true, setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));

  const api = express.Router();
  // Requiring JSON on every change (apart from the image upload) means a form on another website cannot make changes.
  api.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/me/background-image' || req.path === '/me/card-back-image') return next();
    if (!req.is('application/json')) return res.status(415).json({ error: 'Send JSON.' });
    next();
  });
  api.use(express.json({ limit: '20kb' }));

  const signedIn = (req, res, { user, token }) => {
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: req.secure }));
    res.json({ user });
  };

  api.post('/auth/register', handler(async (req, res) => {
    const { username, password, displayName } = req.body ?? {}; // isBot is deliberately not accepted from clients
    signedIn(req, res, await auth.register({ username, password, displayName }));
  }));
  api.post('/auth/login', handler(async (req, res) => signedIn(req, res, await auth.login({ ...(req.body ?? {}), ip: req.ip }))));
  api.post('/auth/logout', (req, res) => {
    auth.logout(tokenOf(req));
    res.setHeader('Set-Cookie', clearedCookie);
    res.json({ ok: true });
  });

  api.get('/config', (req, res) => res.json({ games: moduleList, backgrounds: BACKGROUND_PRESETS, cardBacks: CARD_BACK_PRESETS }));
  api.get('/me', (req, res) => res.json({ user: auth.userForToken(tokenOf(req)) }));

  api.patch('/me', requireUser, handler(async (req, res) => {
    const { displayName, background, cardBack } = req.body ?? {};
    const user = auth.updateProfile(req.user.id, { displayName, background, cardBack });
    if (background !== undefined && user.background.type !== 'image') removeImages('bg', user.id);
    if (cardBack !== undefined && user.cardBack.type !== 'image') removeImages('cb', user.id);
    res.json({ user });
  }));

  api.post('/me/password', requireUser, handler(async (req, res) => {
    await auth.changePassword(req.user.id, req.body?.currentPassword, req.body?.newPassword, tokenOf(req));
    res.json({ ok: true });
  }));

  /** An upload route: checks the picture, stores it as <kind>-<user>-<random>.<ext>, and makes it the user's setting. */
  const imageUpload = (route, kind, setting) =>
    api.post(
      route,
      requireUser,
      express.raw({ type: Object.keys(IMAGE_TYPES), limit: '3mb' }),
      handler(async (req, res) => {
        const type = IMAGE_TYPES[req.headers['content-type']?.split(';')[0]];
        if (!type || !Buffer.isBuffer(req.body) || !req.body.length) throw new AuthError('Please upload a PNG, JPEG or WebP image (up to 3 MB).', 415);
        if (!type.magic(req.body)) throw new AuthError('That file is not really an image of that type.', 415);
        const file = `${kind}-${req.user.id}-${crypto.randomBytes(6).toString('hex')}.${type.ext}`;
        fs.writeFileSync(path.join(uploadsDir, file), req.body);
        removeImages(kind, req.user.id, file);
        res.json({ user: auth.updateProfile(req.user.id, { [setting]: { type: 'image', file } }) });
      }),
    );
  imageUpload('/me/background-image', 'bg', 'background');
  imageUpload('/me/card-back-image', 'cb', 'cardBack');

  api.get('/stats/me', requireUser, (req, res) => res.json(stats.forUser(req.user.id)));
  api.get('/stats/leaderboard/:game', requireUser, (req, res) => {
    if (!moduleList.some((g) => g.id === req.params.game)) return res.status(404).json({ error: 'No such game.' });
    res.json({ leaderboard: stats.leaderboard(req.params.game) });
  });

  api.get('/games/:id/rules', requireUser, (req, res) => {
    const text = modules.rules(req.params.id);
    if (text === null) return res.status(404).json({ error: 'No rules for that game.' });
    res.type('text/plain').send(text);
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', api);

  app.use(express.static(distDir));
  app.get('/{*splat}', (req, res, next) => {
    // Missing files under these folders are genuine 404s, not pages for the client router.
    if (/^\/(uploads|assets|socket\.io)\//.test(req.path)) return next();
    const index = path.join(distDir, 'index.html');
    if (fs.existsSync(index)) res.sendFile(index);
    else next();
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'That is too large.' });
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'That was not valid JSON.' });
    console.error(error);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

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
