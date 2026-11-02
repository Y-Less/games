// Shared helpers for the server tests: temporary folders, a running site, a cookie-keeping HTTP client, sample images
// and a writer for throw-away game modules.  Not a test file itself.
// Depends on: ../index.js (startSite), ../shop.js (allItems), socket.io-client, and Node's fs, http, os, and path.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { startSite } from '../index.js';
import { allItems } from '../shop.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixtureModules = path.join(here, 'modules');

/**
 * Deletes a folder and everything in it, retrying because Windows may briefly hold files open.
 * @param {string} dir  the folder to remove
 * @returns {void}
 * Side effects: deletes files from disk (a missing folder is fine).
 */
export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

/**
 * A temporary folder for a test that opens databases: track(db) registers a database to close before the folder is
 * removed (Windows will not delete an open file).
 * @param {import('node:test').TestContext} t  the running test, whose end triggers the clean-up
 * @param {string} [prefix]  the folder name prefix
 * @returns {{ dir: string, track: <T extends { close: () => any }>(db: T) => T }} the folder, and a function that registers a database and returns it
 * Side effects: creates a temporary folder; registers an after-test hook that closes the tracked databases and deletes it.
 */
export function workspace(t, prefix = 'hub-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const open = [];
  t.after(async () => {
    for (const db of open) {
      try {
        await db.close();
      } catch {
        // already closed
      }
    }
    removeDir(dir);
  });
  // track: remembers a database to close at the end of the test; returns the database it was given.
  return { dir, track: (db) => (open.push(db), db) };
}

/**
 * A fresh temporary folder, removed when the test ends.
 * @param {import('node:test').TestContext} t  the running test
 * @param {string} [prefix]  the folder name prefix
 * @returns {string} the folder's path
 * Side effects: creates the folder and registers an after-test hook that deletes it.
 */
export function tempDir(t, prefix = 'hub-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => removeDir(dir));
  return dir;
}

/**
 * Writes a folder of game modules. spec = { folder: { 'module.json': object | string, 'server.js': string, 'public/a.txt': ... } }.
 * Objects are written as JSON; strings and buffers as they are.
 * @param {import('node:test').TestContext} t  the running test (the folder is removed when it ends)
 * @param {Record<string, Record<string, object | string | Buffer>>} spec  folder name -> file path -> content
 * @returns {string} the folder holding the modules, to use as `modulesDir`
 * Side effects: creates a temporary folder with those files and registers its removal.
 */
export function writeModules(t, spec) {
  const dir = tempDir(t, 'hub-modules-');
  for (const [folder, files] of Object.entries(spec)) {
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(dir, folder, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, typeof content === 'object' && !Buffer.isBuffer(content) ? JSON.stringify(content) : content);
    }
  }
  return dir;
}

/**
 * A module.json for tests.
 * @param {string} id  the module id (also its name, upper-cased)
 * @param {object} [extra]  fields that override or add to the defaults (1 to 2 players)
 * @returns {object} the manifest object
 */
export const manifest = (id, extra = {}) => ({ id, name: id.toUpperCase(), minPlayers: 1, maxPlayers: 2, ...extra });

/** Minimal server.js sources. */
export const EMPTY_SERVER = 'export default function () {}';
export const ECHO_SERVER = `export default function (ctx) {
  ctx.io.on('connection', (socket) => {
    socket.on('whoami', (_p, ack) => ack({ id: ctx.id, user: socket.data.user }));
  });
}`;

// ---- sample images ----
// Padding bytes: returns a buffer that brings a picture header of `used` bytes up to `size` bytes.
const filler = (size, used) => Buffer.alloc(Math.max(0, size - used), 7);
// A minimal buffer with a PNG's first bytes, `size` bytes long (enough to pass the upload's type check).
export const png = (size = 64) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), filler(size, 8)]);
// A minimal buffer with a JPEG's first bytes, `size` bytes long.
export const jpeg = (size = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), filler(size, 4)]);
// A minimal buffer with a WebP's RIFF header, `size` bytes long.
export const webp = (size = 64) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBP'), filler(size, 12)]);

/**
 * A request without fetch's URL tidying (so "/../" and "%2f" reach the server untouched).
 * @param {string} base  the site's base URL
 * @param {{ method?: string, path: string, headers?: object, body?: Buffer | string }} options  the request, path exactly as sent
 * @returns {Promise<{ status: number, headers: object, body: Buffer }>} the reply
 * Side effects: makes one HTTP request.
 */
export function rawRequest(base, { method = 'GET', path: requestPath, headers = {}, body } = {}) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, method, path: requestPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Makes every account created from now on own everything that is for sale, so tests that are not about the shop can ignore it.
 * @param {import('node:sqlite').DatabaseSync} db  the site database
 * @returns {void}
 * Side effects: creates a trigger on users that grants the items to each new row.
 */
export function unlockEverything(db) {
  const rows = allItems()
    .filter((item) => item.price > 0)
    .map((item) => `(NEW.id, '${item.id.replace(/'/g, "''")}', 0)`)
    .join(', ');
  db.exec(`CREATE TRIGGER IF NOT EXISTS test_unlock_everything AFTER INSERT ON users BEGIN INSERT OR IGNORE INTO owned_items (user_id, item_id, bought_at) VALUES ${rows}; END;`);
}

/**
 * Starts a real site on a spare port in its own data folder.  Options: modulesDir, distDir, env (set only while the
 * site starts, for TRUST_PROXY), dataDir, port, shopLocked (new accounts own nothing that is for sale).
 * @param {import('node:test').TestContext} t  the running test (the site is closed when it ends)
 * @param {{ modulesDir?: string, distDir?: string, env?: Record<string, string>, dataDir?: string, port?: number, shopLocked?: boolean }} [options]  as above
 * @returns {Promise<{ site: object, base: string, dataDir: string, logs: string[], client: () => object, close: () => Promise<void> }>}
 *   the running site, its base URL, data folder, captured log lines, a client factory and an idempotent close
 * Side effects: starts a site (listening on a port, with a database), may create a data folder, sets and restores
 *   environment variables while starting, and registers after-test clean-up.
 */
export async function withSite(t, options = {}) {
  const ownDir = !options.dataDir;
  const dataDir = options.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-'));
  const logs = [];
  const saved = {};
  for (const [key, value] of Object.entries(options.env ?? {})) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  let site;
  try {
    site = await startSite({
      port: options.port ?? 0,
      dataDir,
      modulesDir: options.modulesDir ?? fixtureModules,
      distDir: options.distDir ?? path.join(dataDir, 'no-dist'),
      log: (...args) => logs.push(args.join(' ')),
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  // Most tests are not about the shop, so by default every new account owns everything on sale.
  if (!options.shopLocked) unlockEverything(site.db);
  const base = `http://127.0.0.1:${site.port}`;
  let closed = false;
  // Stops the site once (later calls do nothing); resolves when it has closed.
  const close = async () => {
    if (closed) return;
    closed = true;
    await site.close();
  };
  t.after(async () => {
    await close();
    if (ownDir) removeDir(dataDir);
  });

  /**
   * A tiny cookie-keeping HTTP client.  Every call resolves to { status, data, headers }.
   * @returns {{ get: Function, post: Function, patch: Function, call: Function, raw: Function, cookie: () => string, setCookie: (value: string) => void, socket: (namespace: string) => object }}
   * Side effects: none until used; its requests set the cookie it keeps, and its sockets are closed when the test ends.
   */
  function client() {
    let cookie = '';
    const sockets = [];
    // Sends one request with the kept cookie; resolves to { status, data (parsed JSON or text), headers }.
    const call = async (method, url, body, headers = {}) => {
      const isJson = body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string';
      const res = await fetch(base + url, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(isJson ? { 'content-type': 'application/json' } : {}), ...headers },
        body: isJson ? JSON.stringify(body) : body,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, data, headers: res.headers };
    };
    t.after(() => sockets.forEach((s) => s.close()));
    return {
      // get / post / patch: shorthands over `call` for those methods; each returns call's promise.
      get: (url, headers) => call('GET', url, undefined, headers),
      post: (url, body = {}, headers) => call('POST', url, body, headers),
      patch: (url, body, headers) => call('PATCH', url, body, headers),
      call,
      // raw: POSTs a binary body of the given content type; returns call's promise.
      raw: (url, buffer, type) => call('POST', url, buffer, { 'content-type': type }),
      // cookie: the current Cookie header value ('' when signed out).
      cookie: () => cookie,
      // setCookie: replaces the kept cookie (to act as another session); returns nothing.
      setCookie: (value) => {
        cookie = value;
      },
      /**
       * Opens a socket.io connection to a namespace with the kept cookie.
       * @param {string} namespace  such as '/coin'
       * @returns {object} the (not yet awaited) socket; closed when the test ends
       * Side effects: opens a connection.
       */
      socket(namespace) {
        const socket = connect(base + namespace, { forceNew: true, extraHeaders: { cookie }, reconnection: false });
        sockets.push(socket);
        return socket;
      },
    };
  }
  return { site, base, dataDir, logs, client, close };
}

// Registers an account through the HTTP API; returns the request's promise of { status, data, headers }.
export const register = (c, username = 'alice', password = 'correct horse', extra = {}) =>
  c.post('/api/auth/register', { username, password, ...extra });

/** Resolves once a socket has connected, or rejects with its connection error. */
export const connected = (socket) =>
  new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });

// Resolves with the error once a socket is refused; rejects if it connects.  Side effects: none.
export const refused = (socket) =>
  new Promise((resolve, reject) => {
    socket.once('connect', () => reject(new Error('the socket should have been refused')));
    socket.once('connect_error', resolve);
  });

// Emits an event with a payload and resolves with the acknowledgement the server sends back.
export const ask = (socket, event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));
