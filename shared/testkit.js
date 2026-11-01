// Helpers for the module tests that run against the real site (used by modules/*/robustness.test.js, lifecycle.test.js
// and kick.test.js). Not imported by anything that ships: it only exists to keep those tests short and alike.
//
//   const site = await launchModule(t, { id: 'hearts', moduleDir: here });
//   const ann = await site.person('ann').open();      // registers an account and connects a socket
//   const reply = await ann.call('create', {});       // the ack, or { ok: 'timeout' } if the server never answered
//
// The module is copied into a temporary folder (with the shared files it imports) and started on port 0, so the
// tests never touch the real data folder.
// Depends on: node built-ins, socket.io-client, ../server/index.js (startSite), ./random.js, and the shared/*.js files it copies for each module under test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { startSite } from '../server/index.js';

// Absolute path of the platform folder (this file lives in shared/, so one level up).
const platform = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Returns a promise that resolves after `ms` milliseconds.
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Global regex matching one card string such as "10H" anywhere in text.
export const CARD = /\b(?:[2-9]|10|[JQKA])[CDHS]\b/g;

export { seeded } from './random.js';

/**
 * Lists every socket event a module's server handles, sorted: those the module registers in its own server.js plus, if it is
 * built on the shared room server, the standard ones registered in shared/roomServer.js. The robustness tests compare
 * this with the list of events they know how to attack, so a new event cannot go untested.
 * @param {string} moduleDir  the module's folder (the test's own directory)
 * @returns {string[]} the event names, sorted, excluding 'connection' and 'disconnect'
 * Side effects: none (reads server.js and roomServer.js from disk).
 */
export function handledSocketEvents(moduleDir) {
  const read = (file) => fs.readFileSync(file, 'utf8');
  let source = read(path.join(moduleDir, 'server.js'));
  if (source.includes('createRoomServer')) source += read(path.join(platform, 'shared', 'roomServer.js'));
  return [...source.matchAll(/\bon\('(\w+)'/g)].map((m) => m[1]).filter((e) => !['connection', 'disconnect'].includes(e)).sort();
}

/**
 * Polls until `condition` returns something truthy, failing the test on timeout.
 * @param {() => (boolean | Promise<boolean>)} condition  checked every `step` ms
 * @param {string} what  description used in the failure message
 * @param {object} [options]
 * @param {number} [options.timeout]  give up after this many ms (default 20000)
 * @param {number} [options.step]  pause between checks in ms (default 5)
 * @returns {Promise<void>} resolves when the condition holds
 * Side effects: none (throws an assertion error on timeout).
 */
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
 * @param {import('node:test').TestContext} t  the running test; its `after` hook stops the site and removes the data
 * @param {object} options
 * @param {string} options.id  the module id (also its socket namespace)
 * @param {string} options.moduleDir  the module folder to copy
 * @param {string} [options.dataDir]  a temporary folder to use (default: a fresh one in the OS temp dir)
 * @param {boolean} [options.keep]  leave the data folder in place afterwards (for restart tests)
 * @param {(dataDir: string) => void} [options.setup]  runs before the site starts
 * @param {boolean} [options.allowServerErrors]  by default the test fails if the server logged a failure (a handler or a
 *   scheduled move that threw, a save that failed); a test that provokes one on purpose passes true
 * @returns {Promise<{ site: object, base: string, dataDir: string, person: (name: string) => object, stop: () => Promise<void>, alive: () => Promise<boolean>, people: object[], logs: string[], serverErrors: () => string[] }>} handles for driving the running site
 * Side effects: copies files into dataDir, starts an HTTP/socket server on a random port, and registers a t.after cleanup (stops it, deletes dataDir unless keep, and checks the server log).
 */
export async function launchModule(t, { id, moduleDir, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `${id}-kit-`)), keep = false, setup, allowServerErrors = false } = {}) {
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
  const logs = []; // everything the site and the module log: a handler that threw shows up here as "<event> failed:"
  const site = await startSite({ port: 0, dataDir: path.join(dataDir, 'site'), modulesDir, log: (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')) });
  const base = `http://127.0.0.1:${site.port}`;
  const people = [];
  let stopped = false;
  // Closes every person's sockets and shuts the site down; safe to call more than once.
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const p of people) p.closeAll();
    await site.close();
  };
  // The log lines that mean something went wrong on the server (a socket handler or a scheduled move threw, a save or a
  // load failed), as opposed to a refusal a player is meant to read.
  const serverErrors = () => logs.filter((line) => /failed|could not|TypeError|ReferenceError|RangeError/.test(line));
  t.after(async () => {
    await stop();
    if (!keep) fs.rmSync(dataDir, { recursive: true, force: true });
    if (!allowServerErrors) assert.deepEqual(serverErrors(), [], 'the server logged a failure during the test');
  });

  // One test account: its cookie, its sockets and the states it has been sent. Created through `person(name)`.
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
    /**
     * Makes an HTTP call to the site as this account, remembering any session cookie it sets.
     * @param {string} method  HTTP method
     * @param {string} url  path beginning with "/"
     * @param {object} [body]  JSON body, if any
     * @returns {Promise<{ status: number, data: object|null }>} the status and parsed JSON (null if not JSON)
     * Side effects: network request; may update `this.cookie`.
     */
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
    /**
     * Registers the account (once) and opens the first socket.
     * @returns {Promise<Person>} this person, connected
     * Side effects: may register an account over HTTP (sets cookie and id) and opens a socket.
     */
    async open() {
      if (!this.cookie) {
        const registered = await this.http('POST', '/api/auth/register', { username: this.name, password: `${this.name} password` });
        assert.equal(registered.status, 200, registered.data?.error);
        this.id = registered.data.user.id;
      }
      return this.connect();
    }
    /**
     * Opens another socket for the same account (a second tab or a phone); it becomes the one `call` uses.
     * @returns {Promise<Person>} this person, once the socket has connected
     * Side effects: opens a socket, sets `this.socket`, appends to `this.sockets`, and records every 'state' event on the current socket in `this.state` / `this.states`.
     */
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
    /**
     * Creates a separate Person object sharing this account but with its own socket (for "from two sockets" tests).
     * @returns {Promise<Person>} the new, connected person
     * Side effects: opens a socket and registers the twin in the shared `people` list.
     */
    async twin() {
      const twin = new Person(this.name);
      twin.cookie = this.cookie;
      twin.id = this.id;
      await twin.connect();
      return twin;
    }
    /**
     * Emits an event and waits for the ack.
     * @param {string} event  the socket event name
     * @param {object} [payload]  the payload (default {})
     * @param {object} [options]
     * @param {number} [options.timeout]  ms to wait for the ack (default 5000)
     * @param {object} [options.socket]  which socket to use (default the latest)
     * @returns {Promise<object>} the ack, or { ok: 'timeout' } if none comes
     * Side effects: emits on the socket; sets a timer until the ack or timeout.
     */
    call(event, payload = {}, { timeout = 5000, socket = this.socket } = {}) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: 'timeout' }), timeout);
        socket.emit(event, payload, (reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
      });
    }
    /**
     * Emits with the given arguments exactly as they are (no ack unless one is passed).
     * @param {string} event  the socket event name
     * @param {...unknown} args  the raw arguments after the event name
     * @returns {void}
     * Side effects: emits on the current socket.
     */
    fire(event, ...args) {
      this.socket.emit(event, ...args);
    }
    // Closes every socket this person has opened. Returns nothing.
    closeAll() {
      for (const s of this.sockets) s.close();
    }
    // Fetches this account's statistics over HTTP and resolves with the parsed body.
    stats() {
      return this.http('GET', '/api/stats/me').then((r) => r.data);
    }
  }

  // Creates a Person for a new account name (not yet registered or connected).
  const person = (name) => new Person(name);
  // Resolves true when the server answers /api/config, false otherwise (proves the process is alive).
  const alive = async () => {
    const res = await fetch(`${base}/api/config`).catch(() => null);
    return Boolean(res?.ok);
  };
  return { site, base, dataDir, person, stop, alive, people, logs, serverErrors };
}

// ---- garbage ----

/** Prototype-pollution shaped payloads must be built with JSON.parse, or `__proto__` would not be an own key. */
// Builds a prototype-pollution shaped payload; it must use JSON.parse, or `__proto__` would not be an own key.
const polluting = () => JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}');
// Builds a value nested `n` levels deep (objects wrapping arrays) for stack-depth abuse tests.
const deep = (n) => {
  let value = 'x';
  for (let i = 0; i < n; i++) value = { a: [value] };
  return value;
};

/**
 * Lists values a hostile or broken client might send where the server expects an id, a card, a number or text.
 * @returns {Array<[string, unknown]>} pairs of [label, value]
 * Side effects: none.
 */
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
 * @param {unknown} reply  the ack received
 * @param {object} options
 * @param {string} options.what  description for assertion messages
 * @param {string[]} [options.secrets]  strings that must not occur in the reply
 * @returns {void}
 * Side effects: none (throws an assertion error when the reply is malformed or leaks).
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
 * `secrets()` is asked each time, as it can change as the game moves.
 * @param {object} person  a connected Person from launchModule
 * @param {string} event  the socket event to attack
 * @param {string[]} [fields]  payload field names to fuzz one at a time
 * @param {object} [options]
 * @param {() => string[]} [options.secrets]  strings that must never appear in a reply
 * @param {unknown[]} [options.extra]  additional payloads to try
 * @param {Array<[string, unknown]>} [options.values]  garbage values (default garbageValues())
 * @param {((reply: object, label: string) => void) | null} [options.replyCheck]  extra per-reply assertion
 * @returns {Promise<number>} how many acks were checked
 * Side effects: emits many events on the person's socket (changing server state if a rule accepts one); throws on a bad reply.
 */
export async function fuzzEvent(person, event, fields = [], { secrets = () => [], extra = [], values = garbageValues(), replyCheck = null } = {}) {
  let checked = 0;
  // Sends one payload with an ack and asserts the reply is well formed (no timeout, no leaks).
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

// Returns every card string found anywhere in a JSON-serialisable payload (empty array if none).
export const cardsIn = (value) => JSON.stringify(value).match(CARD) ?? [];

/**
 * Asserts that Object.prototype and array/object prototypes were not polluted by hostile payloads.
 * @param {string[]} before  the sorted Object.prototype property names from `prototypeNames()` taken earlier
 * @returns {void}
 * Side effects: none (throws an assertion error on pollution).
 */
export function assertNoPollution(before) {
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before, 'Object.prototype was changed');
  assert.equal({}.polluted, undefined);
  assert.equal({}.x, undefined);
  assert.equal([].polluted, undefined);
}
// Returns the sorted own property names of Object.prototype, to compare with later via assertNoPollution.
export const prototypeNames = () => Object.getOwnPropertyNames(Object.prototype).sort();
