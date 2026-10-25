// Shared helpers for the server tests: temporary folders, a running site, a cookie-keeping HTTP client, sample images
// and a writer for throw-away game modules. Not a test file itself.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { startSite } from '../index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixtureModules = path.join(here, 'modules');

export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

/**
 * A temporary folder for a test that opens databases: track(db) registers a database to close before the folder is
 * removed (Windows will not delete an open file). Returns { dir, track }.
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
  return { dir, track: (db) => (open.push(db), db) };
}

/** A fresh temporary folder, removed when the test ends. */
export function tempDir(t, prefix = 'hub-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => removeDir(dir));
  return dir;
}

/**
 * Writes a folder of game modules. spec = { folder: { 'module.json': object | string, 'server.js': string, 'public/a.txt': ... } }.
 * Objects are written as JSON; strings and buffers as they are.
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

/** A module.json for tests. */
export const manifest = (id, extra = {}) => ({ id, name: id.toUpperCase(), minPlayers: 1, maxPlayers: 2, ...extra });

/** Minimal server.js sources. */
export const EMPTY_SERVER = 'export default function () {}';
export const ECHO_SERVER = `export default function (ctx) {
  ctx.io.on('connection', (socket) => {
    socket.on('whoami', (_p, ack) => ack({ id: ctx.id, user: socket.data.user }));
  });
}`;

// ---- sample images ----
const filler = (size, used) => Buffer.alloc(Math.max(0, size - used), 7);
export const png = (size = 64) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), filler(size, 8)]);
export const jpeg = (size = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), filler(size, 4)]);
export const webp = (size = 64) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBP'), filler(size, 12)]);

/** A request without fetch's URL tidying (so "/../" and "%2f" reach the server untouched). */
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
 * Starts a real site on a spare port in its own data folder. Options: modulesDir, distDir, env (set only while the
 * site starts, for TRUST_PROXY), dataDir, port. Returns { site, base, dataDir, logs, client(), close }.
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
  const base = `http://127.0.0.1:${site.port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await site.close();
  };
  t.after(async () => {
    await close();
    if (ownDir) removeDir(dataDir);
  });

  /** A tiny cookie-keeping HTTP client. Every call resolves to { status, data, headers }. */
  function client() {
    let cookie = '';
    const sockets = [];
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
      get: (url, headers) => call('GET', url, undefined, headers),
      post: (url, body = {}, headers) => call('POST', url, body, headers),
      patch: (url, body, headers) => call('PATCH', url, body, headers),
      call,
      raw: (url, buffer, type) => call('POST', url, buffer, { 'content-type': type }),
      cookie: () => cookie,
      setCookie: (value) => {
        cookie = value;
      },
      socket(namespace) {
        const socket = connect(base + namespace, { forceNew: true, extraHeaders: { cookie }, reconnection: false });
        sockets.push(socket);
        return socket;
      },
    };
  }
  return { site, base, dataDir, logs, client, close };
}

export const register = (c, username = 'alice', password = 'correct horse', extra = {}) =>
  c.post('/api/auth/register', { username, password, ...extra });

/** Resolves once a socket has connected, or rejects with its connection error. */
export const connected = (socket) =>
  new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });

export const refused = (socket) =>
  new Promise((resolve, reject) => {
    socket.once('connect', () => reject(new Error('the socket should have been refused')));
    socket.once('connect_error', resolve);
  });

export const ask = (socket, event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));
