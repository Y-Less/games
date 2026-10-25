// Helpers for the module tests that run against the real site (used by modules/*/robustness.test.js, lifecycle.test.js
// and kick.test.js). Not imported by anything that ships: it only exists to keep those tests short and alike.
//
//   const site = await launchModule(t, { id: 'hearts', moduleDir: here });
//   const ann = await site.person('ann').open();      // registers an account and connects a socket
//   const reply = await ann.call('create', {});       // the ack, or { ok: 'timeout' } if the server never answered
//
// The module is copied into a temporary folder (with the shared files it imports) and started on port 0, so the
// tests never touch the real data folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { startSite } from '../server/index.js';

const platform = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const CARD = /\b(?:[2-9]|10|[JQKA])[CDHS]\b/g;

/** A small seeded random number generator (mulberry32), so a failing run can be repeated. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function until(condition, what, { timeout = 20000, step = 5 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await condition()) return;
    await sleep(step);
  }
  assert.fail(`timed out waiting for: ${what}`);
}

/**
 * Starts the site with only one module (a copy of it, without tests or client). Pass an existing { dataDir } (and
 * keep: true) to restart on the same data. `setup(dataDir)` runs before the site starts (dixnt makes fake cards there).
 */
export async function launchModule(t, { id, moduleDir, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `${id}-kit-`)), keep = false, setup } = {}) {
  const copy = path.join(dataDir, 'copy');
  const modulesDir = path.join(copy, 'modules');
  if (!fs.existsSync(modulesDir)) {
    fs.cpSync(moduleDir, path.join(modulesDir, id), {
      recursive: true,
      filter: (source) => !['client', 'cards', 'node_modules', 'bots', '.bot-tokens.json'].includes(path.basename(source)) && !source.endsWith('.test.js'),
    });
    fs.mkdirSync(path.join(copy, 'shared'), { recursive: true });
    for (const file of fs.readdirSync(path.join(platform, 'shared'))) {
      if (file.endsWith('.js') && !file.endsWith('.test.js')) fs.copyFileSync(path.join(platform, 'shared', file), path.join(copy, 'shared', file));
    }
  }
  setup?.(dataDir);
  const site = await startSite({ port: 0, dataDir: path.join(dataDir, 'site'), modulesDir, log: () => {} });
  const base = `http://127.0.0.1:${site.port}`;
  const people = [];
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const p of people) p.closeAll();
    await site.close();
  };
  t.after(async () => {
    await stop();
    if (!keep) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  class Person {
    constructor(name) {
      this.name = name;
      this.cookie = '';
      this.id = null;
      this.state = undefined; // the latest 'state' event: undefined before any, null when out of a game
      this.states = [];
      this.socket = null;
      this.sockets = [];
      people.push(this);
    }
    async http(method, url, body) {
      const res = await fetch(base + url, {
        method,
        headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) this.cookie = set.split(';')[0];
      return { status: res.status, data: await res.json().catch(() => null) };
    }
    /** Registers the account (once) and opens the first socket. */
    async open() {
      if (!this.cookie) {
        const registered = await this.http('POST', '/api/auth/register', { username: this.name, password: `${this.name} password` });
        assert.equal(registered.status, 200, registered.data?.error);
        this.id = registered.data.user.id;
      }
      return this.connect();
    }
    /** Opens another socket for the same account (a second tab or a phone); it becomes the one `call` uses. */
    async connect() {
      const socket = connect(`${base}/${id}`, { forceNew: true, extraHeaders: { cookie: this.cookie } });
      this.socket = socket;
      this.sockets.push(socket);
      socket.on('state', (s) => {
        if (this.socket !== socket) return;
        this.state = s;
        this.states.push(s);
      });
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      return this;
    }
    /** A separate Person object sharing this account but with its own socket (for "from two sockets" tests). */
    async twin() {
      const twin = new Person(this.name);
      twin.cookie = this.cookie;
      twin.id = this.id;
      await twin.connect();
      return twin;
    }
    /** Emits and waits for the ack: resolves with { ok: 'timeout' } if none comes. */
    call(event, payload = {}, { timeout = 5000, socket = this.socket } = {}) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: 'timeout' }), timeout);
        socket.emit(event, payload, (reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
      });
    }
    /** Emits with the given arguments exactly as they are (no ack unless one is passed). */
    fire(event, ...args) {
      this.socket.emit(event, ...args);
    }
    closeAll() {
      for (const s of this.sockets) s.close();
    }
    stats() {
      return this.http('GET', '/api/stats/me').then((r) => r.data);
    }
  }

  const person = (name) => new Person(name);
  /** Something that proves the server process is alive and answering. */
  const alive = async () => {
    const res = await fetch(`${base}/api/config`).catch(() => null);
    return Boolean(res?.ok);
  };
  return { site, base, dataDir, person, stop, alive, people };
}

// ---- garbage ----

/** Prototype-pollution shaped payloads must be built with JSON.parse, or `__proto__` would not be an own key. */
const polluting = () => JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}');
const deep = (n) => {
  let value = 'x';
  for (let i = 0; i < n; i++) value = { a: [value] };
  return value;
};

/** Values a hostile or broken client might send where the server expects an id, a card, a number or text. */
export function garbageValues() {
  return [
    ['undefined', undefined],
    ['null', null],
    ['zero', 0],
    ['negative', -1],
    ['fraction', 1.5],
    ['negative fraction', -0.5],
    ['huge number', 1e308],
    ['unsafe integer', 2 ** 53 + 2],
    ['NaN', NaN],
    ['true', true],
    ['false', false],
    ['empty string', ''],
    ['short string', 'x'],
    ['numeric string', '1'],
    ['card-like string', 'AS'],
    ['100 KB string', 'A'.repeat(100 * 1024)],
    ['100 KB of spaces then text', `${' '.repeat(100 * 1024)}boss-aware-you`],
    ['empty array', []],
    ['array of numbers', [1, 2, 3]],
    ['array of cards', ['AS', 'KS', 'QS']],
    ['array of nulls', [null, null, null]],
    ['empty object', {}],
    ['nested object', { a: { b: { c: 1 } } }],
    ['deeply nested', deep(40)],
    ['__proto__ object', JSON.parse('{"__proto__":{"x":1}}')],
    ['constructor object', JSON.parse('{"constructor":{"prototype":{}}}')],
    ['polluting object', polluting()],
    ['__proto__ string', '__proto__'],
    ['constructor string', 'constructor'],
    ['toString string', 'toString'],
    ['object with toString key', { toString: 'x', valueOf: 'y', length: 3 }],
  ];
}

/**
 * Checks one ack: a structured failure ({ ok: false, error: <short text> }) or a harmless success ({ ok: true }).
 * `secrets` are strings that must never appear in it (another player's cards, a hidden colour).
 */
export function assertReply(reply, { what, secrets = [] }) {
  assert.ok(reply && typeof reply === 'object' && !Array.isArray(reply), `${what}: the reply was not an object: ${String(reply).slice(0, 80)}`);
  assert.ok(reply.ok === true || reply.ok === false, `${what}: ok must be true or false, was ${String(reply.ok)}`);
  if (reply.ok === false) {
    assert.equal(typeof reply.error, 'string', `${what}: a failure needs an error message`);
    assert.ok(reply.error.length > 0 && reply.error.length < 400, `${what}: the error message has a sensible length (${reply.error.length})`);
    assert.ok(!reply.error.includes('AAAAAAAAAA'), `${what}: the error must not echo the payload back`);
    assert.ok(!/\bat .*\.js:\d+/.test(reply.error), `${what}: the error must not contain a stack trace`);
  }
  const text = JSON.stringify(reply);
  assert.ok(text.length < 5000, `${what}: the reply is suspiciously large (${text.length})`);
  for (const secret of secrets) assert.ok(!text.includes(secret), `${what}: the reply leaked ${secret}`);
}

/**
 * Throws a battery of malformed payloads at one socket event: the whole payload being garbage, then each named field
 * being garbage inside an otherwise empty payload, each with an ack, then without one, then with odd argument lists.
 * Returns how many acks it checked. `secrets()` is asked each time, as it can change as the game moves.
 */
export async function fuzzEvent(person, event, fields = [], { secrets = () => [], extra = [], values = garbageValues(), replyCheck = null } = {}) {
  let checked = 0;
  const check = async (payload, label) => {
    const reply = await person.call(event, payload);
    assert.notEqual(reply?.ok, 'timeout', `${event} (${label}): no reply`);
    assertReply(reply, { what: `${event} (${label})`, secrets: secrets() });
    replyCheck?.(reply, `${event} (${label})`);
    checked++;
  };
  for (const [label, value] of values) await check(value, `payload ${label}`);
  for (const field of fields) {
    for (const [label, value] of values) await check({ [field]: value }, `${field} = ${label}`);
  }
  for (const payload of extra) await check(payload, `extra ${JSON.stringify(payload).slice(0, 60)}`);
  // Without an ack the server must simply carry on.
  for (const [, value] of values) person.fire(event, value);
  for (const field of fields) for (const [, value] of values.slice(0, 12)) person.fire(event, { [field]: value });
  // Odd argument lists: nothing, a non-function where the ack goes, and extra arguments.
  person.fire(event);
  person.fire(event, {}, 'not a function');
  person.fire(event, {}, {}, () => {});
  person.fire(event, 1, 2, 3, 4, 5);
  return checked;
}

/** Every card string anywhere in a JSON payload. */
export const cardsIn = (value) => JSON.stringify(value).match(CARD) ?? [];

export function assertNoPollution(before) {
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before, 'Object.prototype was changed');
  assert.equal({}.polluted, undefined);
  assert.equal({}.x, undefined);
  assert.equal([].polluted, undefined);
}
export const prototypeNames = () => Object.getOwnPropertyNames(Object.prototype).sort();
