// A seeded fuzz of the whole HTTP surface (server/routes/).  Every route is sent malformed bodies, wrong content
// types, oversized and odd JSON, prototype-pollution keys, and wrong methods, signed in and signed out.  What is
// protected is what a hostile or broken client must never be able to cause: a 5xx, a reply that carries a stack trace or
// a developer's sentence instead of an error code, a server that has stopped answering, a changed Object.prototype, or
// a change to somebody else's account.  Every failure message carries the seed and the step, so a failing run can be
// replayed exactly.
//
// Three kinds of request are not made by the random generator, because each once got a 500 and so has a test of its
// own at the bottom of this file: a path segment that cannot be percent-decoded, a charset the JSON parser does not
// support, and a Content-Encoding that is unknown or does not match the body.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jpeg, png, rawRequest, tempDir, webp, withSite } from './fixtures/testkit.js';
import { cleanAvatar, cleanBackground, cleanCardBack, cleanNameStyle } from './profileSettings.js';
import { REFUND_MINIMUM_WORDS } from '../shared/refunds.js';
import { assertNoPollution, garbageValues, prototypeNames, seeded } from '../shared/testkit.js';
import { pickOne } from '../shared/random.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Every refusal's `error` is a key under `errors.` in the site's locale files (routes/errorHandler.js): the client
// puts it into words.  Anything else in that field is a sentence no player was meant to read.
const ERROR_KEYS = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'locales', 'en.json'), 'utf8')).errors));

const PASSWORD = 'correct horse fuzz';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// Every route the site registers under /api, as "METHOD /path".  A test below compares this with the route files, so a
// new route cannot be added without being fuzzed.
const API_ROUTES = [
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'GET /api/me',
  'GET /api/config',
  'GET /api/games/:id/rules',
  'PATCH /api/me',
  'POST /api/me/password',
  'GET /api/players',
  'POST /api/me/background-image',
  'POST /api/me/card-back-image',
  'GET /api/shop',
  'POST /api/shop/buy',
  'POST /api/refunds',
  'GET /api/stats/me',
  'GET /api/stats/user/:who',
  'GET /api/stats/leaderboard/:game',
  'GET /api/leaderboard',
  'GET /api/achievements',
  'GET /api/achievements/user/:who',
  'POST /api/achievements/steve',
  'GET /api/achievements/pending',
  'POST /api/achievements/seen',
];
// What is not under /api: the built client and its fallback, the uploaded pictures, an unknown API address.
const OTHER_ROUTES = ['GET /', 'GET /play/:id', 'GET /app.js', 'GET /uploads/:file', 'GET /assets/:id/:file', 'GET /api/:id', 'GET /api'];
const UPLOAD_PATHS = ['/api/me/background-image', '/api/me/card-back-image'];
// Routes a run need not get a 2xx from: every account in these tests already owns the whole shop, so nothing can be bought.
const NEVER_SUCCEEDS = new Set(['POST /api/shop/buy']);

const int = (rng, n) => Math.floor(rng() * n);
const isApi = (url) => url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');

// ---- what goes into a request ----

// Values for a `:param` in a path.  All of them can be percent-decoded (see the note at the top of the file).
const ODD_SEGMENTS = [
  '__proto__', 'constructor', 'toString', 'hasOwnProperty', '0', '-1', '1e3', '99999999999999999999', '007', 'nobody', 'null', 'undefined', 'NaN',
  'a'.repeat(300), '%00', '%2e%2e', '%2F..%2F..%2Fetc%2Fpasswd', '..%5C..%5Csite.db', '%20', 'tom%20thumb', '%F0%9F%98%80', '%C3%A9', '%25', 'coin.', 'COIN',
  '*', '%3Cscript%3Ealert(1)%3C%2Fscript%3E', "1'%20OR%20'1'%3D'1", '1%3BDROP%20TABLE%20users', 'bg-1-0123456789ab.png', '.env', 'index.html',
];
const ODD_QUERIES = [
  'ids=1,2,3', `ids=${'9,'.repeat(500)}`, 'ids=__proto__,constructor', 'ids[]=1&ids[]=2', 'ids[__proto__]=1', 'ids=1e999,-0,0x10,1.5', 'ids=%', 'lang=fr', 'lang=fr&lang=de',
  'lang=..%2F..%2Fsecret', 'lang=%00', '__proto__[polluted]=1', 'constructor[prototype][polluted]=1', '__proto__=1&__proto__=2', '__proto__.polluted=1',
  `a=${'b'.repeat(3000)}`, '%', '=', '&&&', '?', 'x=%E0%A4%A',
];
// Content types other than plain application/json.  None names a charset other than utf-8 (see the top of the file).
const ODD_TYPES = [
  undefined, '', 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/json; charset=utf-8', 'APPLICATION/JSON',
  'application/vnd.api+json', 'text/json', 'application/jsonx', 'application/json;', 'application/json; boundary="unterminated', 'image/png', 'image/jpeg', 'image/webp',
  'image/gif', 'image/svg+xml', 'IMAGE/PNG', 'image/png; charset=binary', 'application/octet-stream', 'a/b/c', ';;;', '*/*', 'x'.repeat(2000),
];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
// Text that is not JSON, or is JSON of a shape no route expects.
const MALFORMED = [
  '', ' ', '{', '}', '{"a":', '{"a":1,}', "{'a':1}", '{"a":1}}', '[', '[1,2', 'nonsense', 'undefined', 'NaN', '{"a":NaN}', '{"a":Infinity}', '{"a":1e999}', '-', '"unterminated',
  'null', 'true', '0', '"a string"', '[]', '[[]]', '[null]', '{}', '﻿{}', '{"a":"\\ud800"}', '{"a":"\\u0000"}', '{"\\u0000":1}', '{"a":1}\u0000', '\u0000', '{"a":1} {"b":2}',
  '{"a":1,"a":2}', `${'['.repeat(2000)}${']'.repeat(2000)}`, `${'{"a":'.repeat(1000)}1${'}'.repeat(1000)}`, `{"a":"${'\\u0041'.repeat(500)}"}`, '\x1f\x8b\x08\x00garbage',
];
// The garbage every socket fuzz in the project uses, less the values too large to get past the body limit (those are
// sent on purpose by the "oversized" bodies below, and would otherwise turn a third of the run into 413s).
const GARBAGE = garbageValues().filter(([, value]) => (JSON.stringify(value) ?? '').length < 2000);

/** A body the route should accept from somebody signed in: the fuzz bends these, so that the handlers behind the checks are reached. */
function valid(route, rng, step) {
  const pick = (list) => pickOne(list, rng);
  switch (route) {
    case 'POST /api/auth/register':
      return { username: `ok${step}n${int(rng, 1000)}`, password: PASSWORD, displayName: 'Fuzz' };
    case 'POST /api/auth/login':
      return { username: 'fuzzer', password: PASSWORD };
    case 'PATCH /api/me': {
      const all = {
        displayName: pick(['Fuzzer', 'F', 'x'.repeat(20)]),
        background: pick([{ type: 'preset', value: 'night' }, { type: 'preset', value: 'ocean' }, { type: 'colour', value: '#AABBCC' }, { type: 'gradient', from: '#112233', to: '#445566', angle: int(rng, 361) }]),
        cardBack: pick([{ type: 'preset', value: 'crimson' }, { type: 'preset', value: 'navy' }, { type: 'avatar' }]),
        nameStyle: pick([{ style: 'plain' }, { style: 'plain', animation: 'glow' }, { style: 'plain', animation: 'none' }]),
        avatar: {},
        markerColour: pick([null, '#ff2d95', '#123456']),
        backgroundAnimation: pick(['none', 'stars']),
        playAnimations: pick([true, false, null]),
        effectIntensity: pick([10, 100, 300]),
        effectSpeed: pick([25, 100, 300]),
        language: pick([null, 'fr', 'pt-BR', 'tlh']),
      };
      return Object.fromEntries(Object.entries(all).filter(() => rng() < 0.3));
    }
    case 'POST /api/me/password':
      return { currentPassword: PASSWORD, newPassword: PASSWORD }; // the same again, so the account can always sign in
    case 'POST /api/shop/buy':
      return { item: 'bg:ocean' };
    case 'POST /api/refunds':
      return { text: 'word '.repeat(REFUND_MINIMUM_WORDS + 50) };
    case 'POST /api/achievements/seen':
      return { items: [{ id: 'global.welcome', level: 1 }] };
    default:
      return {};
  }
}

// The three kinds of picture an upload accepts, each with the content type that is true of it.
const PICTURES = [[png, 'image/png'], [jpeg, 'image/jpeg'], [webp, 'image/webp']];

/** A body a client might send that is close to right: some of these are accepted and some are refused for one field. */
function nearly(route, rng, step) {
  const pick = (list) => pickOne(list, rng);
  switch (route) {
    case 'POST /api/auth/register':
      return { username: `fz${step}n${int(rng, 1000)}`, password: PASSWORD, displayName: pick([undefined, 'Fuzz', '  ', 'x'.repeat(60)]) };
    case 'POST /api/auth/login':
      return { username: pick(['fuzzer', 'witness', 'nobody', 'FUZZER']), password: pick([PASSWORD, 'wrong password']) };
    case 'PATCH /api/me': {
      const all = {
        displayName: pick(['Fuzzer', 'F', 'x'.repeat(20), 'x'.repeat(21), '']),
        background: pick([{ type: 'preset', value: 'night' }, { type: 'preset', value: 'ocean' }, { type: 'colour', value: '#AABBCC' }, { type: 'gradient', from: '#112233', to: '#445566', angle: int(rng, 720) - 180 }, { type: 'image', file: 'bg-1-0123456789ab.png' }]),
        cardBack: pick([{ type: 'preset', value: 'crimson' }, { type: 'preset', value: 'navy' }, { type: 'avatar' }, { type: 'image', file: 'cb-1-0123456789ab.png' }]),
        nameStyle: pick([{ style: 'plain' }, { style: 'plain', animation: 'glow' }, { style: 'plain', animation: 'none' }]),
        avatar: pick([{}, { skin: 'nope' }]),
        markerColour: pick([null, '#ff2d95', '#123456', 'red']),
        siteTheme: pick(['nope', '']),
        siteFont: pick(['nope', '']),
        backgroundAnimation: pick(['none', 'stars', 'nope']),
        playAnimations: pick([true, false, null, 'yes']),
        effectIntensity: pick([10, 100, 300, 301, 9, 100.5]),
        effectSpeed: pick([25, 100, 300, 24]),
        language: pick([null, 'fr', 'pt-BR', 'tlh', '../x']),
      };
      return Object.fromEntries(Object.entries(all).filter(() => rng() < 0.25));
    }
    case 'POST /api/me/password':
      // The new password is only ever the old one or one that must be refused, so the account can always sign in again.
      return { currentPassword: pick([PASSWORD, PASSWORD, 'wrong password']), newPassword: pick([PASSWORD, 'short', '', 'x'.repeat(201), null]) };
    case 'POST /api/shop/buy':
      return { item: pick(['bg:ocean', 'cb:navy', 'refunds', 'bg:night', 'nothing']) };
    case 'POST /api/refunds':
      return { text: 'word '.repeat(pick([5, REFUND_MINIMUM_WORDS - 1, REFUND_MINIMUM_WORDS, REFUND_MINIMUM_WORDS + 50])) };
    case 'POST /api/achievements/seen':
      return { items: [{ id: 'global.welcome', level: 1 }, { id: pick(['global.steve', 'nope', '']), level: pick([1, 0, -1, 1.5, 2 ** 60]) }] };
    default:
      return {};
  }
}

/** The same JSON text with prototype-pollution keys written into it (as text: JSON.stringify would drop `__proto__`). */
function withPollution(json) {
  const inner = json.slice(1, -1);
  return `{"__proto__":{"polluted":true,"isBot":true,"x":1},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true}${inner ? `,${inner}` : ''}}`;
}

/** A buffer of `size` seeded random bytes. */
const noise = (rng, size) => Buffer.from(Array.from({ length: size }, () => int(rng, 256)));

/**
 * One request body: what it is called in a failure message, the bytes, and the content type to send it with.
 * @returns {{ kind: string, body: string | Buffer | undefined, type: string | undefined }}
 */
function makeBody(route, url, rng, step, proper = false) {
  const pick = (list) => pickOne(list, rng);
  if (proper) {
    if (!UPLOAD_PATHS.includes(url)) return { kind: 'a valid body', body: JSON.stringify(valid(route, rng, step)), type: 'application/json' };
    const [make, type] = pick(PICTURES);
    return { kind: 'a valid picture', body: make(64 + int(rng, 200)), type };
  }
  const jsonType = () => (rng() < 0.85 ? 'application/json' : pick(ODD_TYPES));
  const picture = () => {
    const make = pick([png, jpeg, webp]);
    const roll = rng();
    // Mostly small; now and then exactly at, or one byte over, the 3 MB limit.
    return make(roll < 0.9 ? 16 + int(rng, 200) : roll < 0.95 ? 3 * 1024 * 1024 : 3 * 1024 * 1024 + 1);
  };
  const roll = rng();
  if (UPLOAD_PATHS.includes(url.split('?')[0]) && roll < 0.6) {
    const sub = rng();
    if (sub < 0.25) {
      const [make, type] = pick(PICTURES);
      return { kind: 'a valid picture', body: make(64 + int(rng, 200)), type };
    }
    if (sub < 0.5) return { kind: 'a picture', body: picture(), type: rng() < 0.8 ? pick(IMAGE_TYPES) : pick(ODD_TYPES) };
    if (sub < 0.75) return { kind: 'noise as a picture', body: noise(rng, int(rng, 300)), type: pick(IMAGE_TYPES) };
    return { kind: 'a script as a picture', body: Buffer.from('<script>alert(1)</script>'.repeat(4)), type: pick([...IMAGE_TYPES, 'text/html', 'image/svg+xml']) };
  }
  const exact = rng() < 0.5;
  const plain = exact ? valid(route, rng, step) : nearly(route, rng, step);
  if (roll < 0.3) return { kind: exact ? 'a valid body' : 'a nearly valid body', body: JSON.stringify(plain), type: jsonType() };
  if (roll < 0.55) {
    // One field replaced by garbage, or a garbage field added.  (Never the new password: see `nearly`.)
    const keys = [...Object.keys(plain).filter((key) => key !== 'newPassword'), 'extra', 'id', 'isBot', 'userId'];
    const key = pick(keys);
    const [label, value] = pick(GARBAGE);
    return { kind: `${key} = ${label}`, body: JSON.stringify({ ...plain, [key]: value }), type: jsonType() };
  }
  if (roll < 0.65) return { kind: 'pollution keys', body: withPollution(JSON.stringify(plain)), type: jsonType() };
  if (roll < 0.75) {
    const [label, value] = pick(GARBAGE);
    return { kind: `the whole body = ${label}`, body: JSON.stringify(value) ?? '', type: jsonType() };
  }
  if (roll < 0.87) {
    const text = pick(MALFORMED);
    return { kind: `malformed ${JSON.stringify(text.slice(0, 30))}`, body: text, type: jsonType() };
  }
  if (roll < 0.93) {
    const size = pick([20 * 1024 + 1, 64 * 1024, 129 * 1024, 300 * 1024]);
    const key = pick(['text', 'displayName', 'username', 'item', 'filler']);
    return { kind: `oversized (${size} bytes of ${key})`, body: JSON.stringify({ ...plain, [key]: 'A'.repeat(size) }), type: jsonType() };
  }
  return { kind: 'binary', body: rng() < 0.5 ? picture() : noise(rng, int(rng, 400)), type: pick([...IMAGE_TYPES, ...ODD_TYPES]) };
}

/** Fills a route's `:params` in: usually with something that exists, otherwise with something odd. */
function makeUrl(template, rng, known) {
  const pick = (list) => pickOne(list, rng);
  let url = template.replace(/:(\w+)/g, (_, name) => (rng() < 0.5 ? pick(known[name] ?? ['coin']) : pick(ODD_SEGMENTS)));
  if (rng() < 0.3) url += `?${pick(ODD_QUERIES)}`;
  return url;
}

// ---- what every reply must be ----

/** Asserts that a reply's body gives nothing of the server's insides away. */
function assertNoLeak(text, where, dataDir) {
  for (const [what, pattern] of [
    ['a stack trace', /\bat [^\n]*:\d+:\d+/],
    ['a source file and line', /\.js:\d+/],
    ['a path into node_modules', /node_modules/],
    ["one of Node's own files", /node:internal|node:sqlite/],
    ['an exception name', /\b(?:Syntax|Type|Range|Reference|URI|Eval)Error\b/],
    ["the JSON parser's own words", /Unexpected (?:token|end|non-whitespace)|in JSON at position/],
    ["the database's own words", /SQLITE_|constraint failed|no such (?:table|column)/],
  ]) {
    assert.ok(!pattern.test(text), `${where}: the reply contains ${what}: ${text.slice(0, 300)}`);
  }
  assert.ok(!text.includes(dataDir) && !text.includes(here), `${where}: the reply names a folder on the server: ${text.slice(0, 300)}`);
}

/** Asserts what must hold of any reply to any request at all. */
function assertReplyIsSafe(reply, { method, url, where, dataDir }) {
  assert.ok(reply.status >= 200 && reply.status < 500, `${where}: status ${reply.status}: ${reply.body.toString().slice(0, 300)}`);
  const text = reply.body.toString();
  assertNoLeak(text, where, dataDir);
  if (!isApi(url) || method === 'HEAD' || reply.status < 400) return;
  // A refusal from the API is JSON with a code the client can put into words, and at most the values that text needs.
  assert.match(String(reply.headers['content-type']), /^application\/json/, `${where}: a ${reply.status} from the API that is not JSON: ${text.slice(0, 200)}`);
  let data;
  assert.doesNotThrow(() => (data = JSON.parse(text)), `${where}: a ${reply.status} whose body is not JSON: ${text.slice(0, 200)}`);
  assert.ok(data && typeof data === 'object' && !Array.isArray(data), `${where}: the refusal is not an object: ${text.slice(0, 200)}`);
  assert.ok(Object.keys(data).every((key) => key === 'error' || key === 'params'), `${where}: a refusal carries more than its code and params: ${text.slice(0, 300)}`);
  assert.ok(ERROR_KEYS.has(data.error), `${where}: the error is not a code the client has words for: ${JSON.stringify(data.error)?.slice(0, 200)}`);
}

/** assertNoPollution, saying which request the prototype was found changed after. */
function unpolluted(before, where) {
  try {
    assertNoPollution(before);
  } catch (error) {
    assert.fail(`${where}: ${error.message}`);
  }
}

// ---- the site under attack ----

/** Sends one request, failing (with `where`) rather than hanging if no reply ever comes. */
async function send(base, request, where) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('no reply within two minutes')), 120_000);
  });
  // The length is always stated: Node's client leaves it off a DELETE (and off a GET) that has a body, and the server
  // would then read that body as the start of the next request on the same connection.
  const headers = { ...(request.body === undefined ? {} : { 'content-length': Buffer.byteLength(request.body) }), ...request.headers };
  try {
    return await Promise.race([rawRequest(base, { ...request, headers }), late]);
  } catch (error) {
    return assert.fail(`${where}: the request got no reply (${error.message})`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A site behind a "proxy" (so each request can come from its own address and the throttles do not turn the run into
 * 429s), with a built client, a signed-in fuzzer, and a witness whose account nobody touches.
 */
async function fuzzSite(t) {
  const logged = t.mock.method(console, 'error', () => {}); // the error handler logs what it answers with a 500
  const distDir = tempDir(t, 'hub-dist-');
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>the app</title>');
  fs.writeFileSync(path.join(distDir, 'app.js'), 'console.log("app");');
  const made = await withSite(t, { env: { TRUST_PROXY: '1' }, distDir });
  let address = 0;
  // A new address for each request.  Returns headers.
  const from = () => ({ 'x-forwarded-for': `10.${(++address >> 16) & 255}.${(address >> 8) & 255}.${address & 255}` });
  const json = (body) => ({ headers: { 'content-type': 'application/json', ...from() }, body: JSON.stringify(body) });
  const cookieOf = (reply) => String(reply.headers['set-cookie']?.[0] ?? '').split(';')[0];
  const signUp = async (username) => {
    const reply = await send(made.base, { method: 'POST', path: '/api/auth/register', ...json({ username, password: PASSWORD }) }, `registering ${username}`);
    assert.equal(reply.status, 200, `registering ${username}`);
    return { cookie: cookieOf(reply), user: JSON.parse(reply.body.toString()).user };
  };
  const signIn = async (username, where) => {
    const reply = await send(made.base, { method: 'POST', path: '/api/auth/login', ...json({ username, password: PASSWORD }) }, where);
    assert.equal(reply.status, 200, `${where}: ${username} can no longer sign in with their own password: ${reply.body}`);
    return cookieOf(reply);
  };
  const me = async (cookie, where) => JSON.parse((await send(made.base, { path: '/api/me', headers: { cookie, ...from() } }, where)).body.toString()).user;
  const fuzzer = await signUp('fuzzer');
  const witness = await signUp('witness');
  return {
    ...made,
    from,
    signUp,
    signIn,
    me,
    fuzzer,
    witness,
    // What the server has logged as a fault.  (Node's own warnings arrive through console.error too, and are not faults.)
    faults: () => logged.mock.calls.map((call) => call.arguments).filter((args) => !(typeof args[0] === 'string' && /^\(node:\d+\) /.test(args[0]))),
  };
}

/** The checks made every so often during a run and once more at its end: the site answers, and the fuzzer is still who they were. */
async function assertStillStanding(site, where) {
  const config = await send(site.base, { path: '/api/config', headers: site.from() }, where);
  assert.equal(config.status, 200, `${where}: the site no longer answers /api/config`);
  assert.ok(Array.isArray(JSON.parse(config.body.toString()).games), `${where}: /api/config no longer lists the games`);
  const user = await site.me(site.fuzzer.cookie, where);
  assert.equal(user?.id, site.fuzzer.user.id, `${where}: the fuzzer's session is no longer theirs`);
  assert.equal(user.username, 'fuzzer', `${where}: the fuzzer's username changed`);
  assert.equal(user.isBot, false, `${where}: the fuzzer was made a bot`);
}

test('the fuzz knows every route the site registers', () => {
  const found = [];
  const routesDir = path.join(here, 'routes');
  for (const file of fs.readdirSync(routesDir)) {
    const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
    for (const [, method, route] of source.matchAll(/\bapi\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) found.push(`${method.toUpperCase()} /api${route}`);
    for (const [, route] of source.matchAll(/\bimageUpload\('([^']+)'/g)) found.push(`POST /api${route}`); // routes/uploads.js registers its two through a helper
  }
  assert.deepEqual([...API_ROUTES].sort(), found.sort(), 'API_ROUTES in this file and the routes in server/routes/ have drifted apart');
});

for (const SEED of [20261113, 7]) {
  test(`fuzz (seed ${SEED}): no request to any route gets a 5xx, a leak, or a change it should not have`, async (t) => {
    const before = prototypeNames();
    const site = await fuzzSite(t);
    const rng = seeded(SEED);
    const pick = (list) => pickOne(list, rng);
    const STEPS = 700;
    const known = { id: ['coin'], game: ['coin'], who: ['fuzzer', 'witness', String(site.fuzzer.user.id), String(site.witness.user.id)], file: ['app.js', 'missing.png'] };
    const witnessBefore = await site.me(site.witness.cookie, `seed ${SEED}, before the run`);
    const succeeded = new Set();

    for (let step = 0; step < STEPS; step++) {
      // The run opens with each route used once as it is meant to be, by somebody signed in: that every one of those
      // is accepted (checked at the end) is what shows the bodies being bent afterwards are bent from the real thing.
      const proper = step < API_ROUTES.length;
      const route = proper ? API_ROUTES[step] : pick(rng() < 0.85 ? API_ROUTES : OTHER_ROUTES);
      const [rightMethod, template] = route.split(' ');
      const method = proper || rng() < 0.75 ? rightMethod : pick(METHODS);
      const url = proper ? template.replace(/:(\w+)/g, (_, name) => known[name][0]) : makeUrl(template, rng, known);
      const signedIn = proper || rng() < 0.7;
      const cookie = signedIn ? site.fuzzer.cookie : pick(['', '', '', 'sid=nonsense', 'sid=%', 'sid=', `sid=${'a'.repeat(5000)}`, 'sid=a; sid=b', '__proto__=1; constructor=2']);
      const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      const { kind, body, type } = hasBody ? makeBody(route, url, rng, step, proper) : { kind: 'no body', body: undefined, type: !proper && rng() < 0.1 ? pick(ODD_TYPES) : undefined };
      const where = `seed ${SEED}, step ${step}: ${method} ${url.slice(0, 120)} ${signedIn ? 'signed in' : `as a stranger (cookie ${JSON.stringify(cookie.slice(0, 20))})`}, ${kind}, content type ${JSON.stringify(type?.slice(0, 40))}`;

      const faultsBefore = site.faults().length;
      const headers = { ...site.from(), ...(cookie ? { cookie } : {}), ...(type === undefined ? {} : { 'content-type': type }) };
      const reply = await send(site.base, { method, path: url, headers, body }, where);
      assertReplyIsSafe(reply, { method, url, where, dataDir: site.dataDir });
      const faults = site.faults();
      assert.equal(faults.length, faultsBefore, `${where}: the server logged a fault: ${String(faults.at(-1)?.[0]?.stack ?? faults.at(-1)?.[0]).slice(0, 600)}`);
      unpolluted(before, where); // the site runs in this process, so its Object.prototype is this one
      if (method === rightMethod && reply.status < 300) succeeded.add(route);
      // Signing out is a thing the fuzzer may really do to itself; sign in again so that the rest of the run is still
      // made by somebody signed in.  (That this works at all is the check that the password has not been changed.)
      if (signedIn && url.startsWith('/api/auth/logout') && !(await site.me(site.fuzzer.cookie, where))) site.fuzzer.cookie = await site.signIn('fuzzer', where);
      if (step % 50 === 49) await assertStillStanding(site, where);
    }

    const where = `seed ${SEED}, after ${STEPS} steps`;
    await assertStillStanding(site, where);
    assert.deepEqual(await site.me(site.witness.cookie, where), witnessBefore, `${where}: the witness, who did nothing, has a changed account`);

    // Whatever the fuzzer's settings have become, each is a value the server's own checks would accept.
    const user = await site.me(site.fuzzer.cookie, where);
    assert.deepEqual(cleanBackground(user.background), user.background, `${where}: the stored background is not a clean one`);
    assert.deepEqual(cleanCardBack(user.cardBack), user.cardBack, `${where}: the stored card back is not a clean one`);
    assert.deepEqual(cleanNameStyle(user.nameStyle), user.nameStyle, `${where}: the stored name style is not a clean one`);
    assert.deepEqual(cleanAvatar(user.avatar), user.avatar, `${where}: the stored avatar is not a clean one`);
    assert.ok(user.displayName.length >= 1 && user.displayName.length <= 20, `${where}: the display name is ${user.displayName.length} characters long`);

    // Nobody became a bot, and nothing was written into the uploads folder but pictures named as the upload route names them.
    assert.equal(site.site.db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_bot = 1').get().n, 0, `${where}: an account was made a bot`);
    const files = fs.readdirSync(path.join(site.dataDir, 'uploads'));
    for (const file of files) assert.match(file, new RegExp(`^(bg|cb)-${site.fuzzer.user.id}-[0-9a-f]{12}\\.(png|jpg|webp)$`), `${where}: an unexpected file in the uploads folder`);
    assert.ok(files.length <= 2, `${where}: more than one background and one card back were kept: ${files.join(', ')}`);

    // A fuzz that is refused at the door every time proves nothing: each route must have accepted the valid request
    // the run opened with (and whatever else got through since).
    const unreached = API_ROUTES.filter((route) => !succeeded.has(route) && !NEVER_SUCCEEDS.has(route));
    assert.deepEqual(unreached, [], `${where}: these routes never answered with a 2xx, so the fuzz is not reaching their handlers`);
  });
}

test('every method on every address: what is not a route is a JSON 404, and nothing is a 5xx', async (t) => {
  const site = await fuzzSite(t);
  const concrete = (template) => template.replace(':id', 'coin').replace(':game', 'coin').replace(':who', 'fuzzer');
  const registered = new Set(API_ROUTES);
  for (const template of [...new Set(API_ROUTES.map((route) => route.split(' ')[1]))]) {
    for (const method of METHODS) {
      for (const cookie of ['', site.fuzzer.cookie]) {
        const where = `${method} ${concrete(template)} ${cookie ? 'signed in' : 'as a stranger'}`;
        const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);
        const headers = { ...site.from(), ...(cookie ? { cookie } : {}), ...(hasBody ? { 'content-type': 'application/json' } : {}) };
        const reply = await send(site.base, { method, path: concrete(template), headers, body: hasBody ? '{}' : undefined }, where);
        assertReplyIsSafe(reply, { method, url: concrete(template), where, dataDir: site.dataDir });
        // HEAD is answered as GET would be, and OPTIONS is the server's own business; every other method that is not
        // registered for the address is an unknown API route (site.test.js: "JSON 404s, never the app page").
        if (!registered.has(`${method} ${template}`) && !['HEAD', 'OPTIONS'].includes(method)) {
          assert.equal(reply.status, 404, where);
          assert.deepEqual(JSON.parse(reply.body.toString()), { error: 'notFound' }, where);
        }
        // Signing out with the right method is the one request here that changes who the fuzzer is.
        if (cookie && method === 'POST' && template === '/api/auth/logout') site.fuzzer.cookie = await site.signIn('fuzzer', where);
      }
    }
  }
  assert.deepEqual(site.faults(), [], 'the server logged a fault');
  await assertStillStanding(site, 'after every method on every address');
});

test('prototype-pollution keys, at the top of a body, inside each field, and in the query, change nothing', async (t) => {
  const before = prototypeNames();
  const site = await fuzzSite(t);
  const keysBefore = Object.keys(await site.me(site.fuzzer.cookie, 'before')).sort();
  const NESTED = '{"__proto__":{"polluted":true,"isBot":true,"x":1},"constructor":{"prototype":{"polluted":true,"x":1}}}';
  const FIELDS = {
    'POST /api/auth/register': ['username', 'password', 'displayName', 'isBot'],
    'POST /api/auth/login': ['username', 'password'],
    'POST /api/auth/logout': [],
    'PATCH /api/me': ['displayName', 'background', 'cardBack', 'nameStyle', 'avatar', 'markerColour', 'siteTheme', 'siteFont', 'backgroundAnimation', 'playAnimations', 'effectIntensity', 'effectSpeed', 'language'],
    'POST /api/me/password': ['currentPassword'],
    'POST /api/shop/buy': ['item'],
    'POST /api/refunds': ['text'],
    'POST /api/achievements/steve': [],
    'POST /api/achievements/seen': ['items'],
  };
  assert.deepEqual(Object.keys(FIELDS).sort(), API_ROUTES.filter((route) => !route.startsWith('GET ') && !route.endsWith('-image')).sort(), 'every route that takes a JSON body is tried');

  for (const [route, fields] of Object.entries(FIELDS)) {
    const [method, url] = route.split(' ');
    const bodies = [
      NESTED,
      `[${NESTED}]`,
      ...fields.flatMap((field) => [`{"${field}":${NESTED}}`, `{"${field}":[${NESTED}]}`, `{"${field}":"__proto__"}`, `{"${field}":"constructor"}`, `{"${field}":{"type":"__proto__","value":"__proto__","style":"constructor","file":"__proto__"}}`]),
    ];
    for (const body of bodies) {
      for (const cookie of ['', site.fuzzer.cookie]) {
        const where = `${route} ${cookie ? 'signed in' : 'as a stranger'} with ${body.slice(0, 80)}`;
        const headers = { ...site.from(), 'content-type': 'application/json', ...(cookie ? { cookie } : {}) };
        const reply = await send(site.base, { method, path: url, headers, body }, where);
        assertReplyIsSafe(reply, { method, url, where, dataDir: site.dataDir });
        unpolluted(before, where);
        if (cookie && url === '/api/auth/logout') site.fuzzer.cookie = await site.signIn('fuzzer', where);
      }
    }
  }
  for (const template of API_ROUTES.filter((route) => route.startsWith('GET ')).map((route) => route.split(' ')[1])) {
    for (const query of ['__proto__[polluted]=1', '__proto__.polluted=1', 'constructor[prototype][polluted]=1', 'ids[__proto__]=1&lang[__proto__]=1', '__proto__=polluted&constructor=polluted']) {
      const url = `${template.replace(/:\w+/g, '__proto__')}?${query}`;
      const reply = await send(site.base, { path: url, headers: { ...site.from(), cookie: site.fuzzer.cookie } }, url);
      assertReplyIsSafe(reply, { method: 'GET', url, where: url, dataDir: site.dataDir });
      unpolluted(before, url);
    }
  }

  assert.deepEqual(site.faults(), [], 'the server logged a fault');
  await assertStillStanding(site, 'after the pollution attempts');
  assert.deepEqual(Object.keys(await site.me(site.fuzzer.cookie, 'after')).sort(), keysBefore, 'the fuzzer has no fields they did not have before');
  const fresh = await site.signUp('fresh');
  assert.equal(fresh.user.isBot, false, 'an account made afterwards is an ordinary one');
  assert.deepEqual(Object.keys(fresh.user).sort(), keysBefore, 'with the ordinary fields and no others');
});

// ---- requests that are the client's mistake, and that express or its body parser refuses by itself ----
// These used to fall through routes/errorHandler.js to the 500 and be logged as though the server had failed, because
// it knew only an AuthError, a body that is too large, and a body that is not JSON.  An error that carries a 4xx
// status of its own is answered with that status now, as auth-http.test.js says of the neighbouring case ("invalid
// JSON is a 400 with a JSON error, never a 500").

/** Sends each request to a fresh site and asserts it is refused as the client's mistake: a 4xx, and nothing logged as a fault. */
async function assertClientErrors(t, requests) {
  const site = await fuzzSite(t);
  for (const [label, request] of requests) {
    const reply = await send(site.base, { ...request, headers: { ...site.from(), cookie: site.fuzzer.cookie, ...(request.headers ?? {}) } }, label);
    assert.ok(reply.status >= 400 && reply.status < 500, `${label}: status ${reply.status}`);
  }
  assert.deepEqual(site.faults().map((args) => String(args[0]?.message ?? args[0])), [], 'none of them is logged as a fault of the server');
}

const CREDENTIALS = JSON.stringify({ username: 'fuzzer', password: PASSWORD });

test('a path that cannot be percent-decoded is a 4xx, not a 500', async (t) => {
  await assertClientErrors(t, [
    '/api/stats/user/%E0%A4%A',
    '/api/achievements/user/%',
    '/api/stats/leaderboard/%',
    '/api/games/%/rules',
    '/%',
    '/play/%E0%A4%A',
    '/uploads/%',
    '/assets/%',
  ].map((url) => [`GET ${url}`, { path: url }]));
});

test('a JSON body in a charset the server does not read is a 4xx, not a 500', async (t) => {
  await assertClientErrors(t, ['latin1', 'iso-8859-1', 'nonsense'].map((charset) => [
    `charset=${charset}`,
    { method: 'POST', path: '/api/auth/login', headers: { 'content-type': `application/json; charset=${charset}` }, body: CREDENTIALS },
  ]));
});

test('a body whose Content-Encoding is unknown, or is not what the body is, is a 4xx, not a 500', async (t) => {
  await assertClientErrors(t, [
    ['JSON said to be gzip', { method: 'POST', path: '/api/auth/login', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }, body: CREDENTIALS }],
    ['JSON said to be deflate', { method: 'POST', path: '/api/auth/login', headers: { 'content-type': 'application/json', 'content-encoding': 'deflate' }, body: CREDENTIALS }],
    ['JSON in an unknown encoding', { method: 'POST', path: '/api/auth/login', headers: { 'content-type': 'application/json', 'content-encoding': 'nonsense' }, body: CREDENTIALS }],
    ['a picture said to be gzip', { method: 'POST', path: '/api/me/background-image', headers: { 'content-type': 'image/png', 'content-encoding': 'gzip' }, body: png() }],
    ['a picture in an unknown encoding', { method: 'POST', path: '/api/me/card-back-image', headers: { 'content-type': 'image/png', 'content-encoding': 'nonsense' }, body: png() }],
  ]);
});
