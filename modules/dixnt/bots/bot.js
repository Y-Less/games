// A stand-alone bot player. It is a completely separate process that talks to the site over the same HTTP and
// Socket.IO API as the browser client, so you can run as many as you like.
//
//   node modules/dixnt/bots/bot.js --join boss-aware-you --name Robin
//   node modules/dixnt/bots/bot.js --join boss-aware-you --name Robin --url http://192.168.1.20:3000
//
// Behaviour:
//   - it signs in with an account named after the bot (registering it the first time)
//   - when it is the chooser it asks the server for hint words (the game's own word list) and picks one
//   - when cards are being played it plays a random card from its hand
//   - when voting it votes for a random player (if the game's judging method lets it vote at all)
// It can only join an existing game, and it does not start the game or move on to the next round: a human does that.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: options } = parseArgs({
  options: {
    join: { type: 'string', short: 'j' }, // the game's invite code, e.g. boss-aware-you
    name: { type: 'string', short: 'n' },
    url: { type: 'string', short: 'u', default: 'http://localhost:3000' },
    delay: { type: 'string', short: 'd', default: '1000-4000' }, // min-max milliseconds to "think" for
    'token-file': { type: 'string', default: path.join(here, '.bot-tokens.json') },
    help: { type: 'boolean', short: 'h' },
  },
});

if (options.help) {
  console.log(`Usage: node modules/dixnt/bots/bot.js --join CODE [--name NAME] [--url URL] [--delay MIN-MAX] [--token-file FILE]

  --join        the invite code of the game to join, e.g. boss-aware-you (required)
  --name        the bot's account and player name: 3 to 20 letters, numbers, dashes or underscores (default: Bot-<random number>)
  --url         the site (default: http://localhost:3000)
  --delay       how long to "think" before acting, in ms, as MIN-MAX (default: 1000-4000)
  --token-file  where to remember each bot account's password (default: .bot-tokens.json beside this script)`);
  process.exit(0);
}

if (!options.join) {
  console.error('Please say which game to join, e.g. --join boss-aware-you (the invite code is shown in the lobby).');
  process.exit(1);
}
const code = options.join;

const name = options.name ?? `Bot-${Math.floor(100 + Math.random() * 900)}`;
const [minDelay, maxDelay] = options.delay.split('-').map(Number);
if (!(minDelay >= 0 && maxDelay >= minDelay)) {
  console.error('--delay must look like MIN-MAX, e.g. 1000-4000');
  process.exit(1);
}

const log = (message) => console.log(`[${name}] ${message}`);
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const thinkTime = () => minDelay + Math.random() * (maxDelay - minDelay);
const baseUrl = options.url.replace(/\/+$/, '');

// ---- identity: an account named after the bot, with a password remembered between runs ----
function readPasswords() {
  try {
    return JSON.parse(fs.readFileSync(options['token-file'], 'utf8'));
  } catch {
    return {}; // first run
  }
}

function rememberPassword(password) {
  const passwords = readPasswords();
  passwords[name] = password;
  fs.mkdirSync(path.dirname(options['token-file']), { recursive: true });
  fs.writeFileSync(options['token-file'], JSON.stringify(passwords, null, 2));
}

async function post(url, body) {
  const res = await fetch(baseUrl + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  const cookie = res.headers.getSetCookie?.()[0]?.split(';')[0] ?? null;
  return { ok: res.ok, status: res.status, error: data.error, cookie };
}

/** Logs in with the remembered password, registering the account first if it does not exist yet. */
async function signIn() {
  const stored = readPasswords()[name];
  if (stored) {
    const login = await post('/api/auth/login', { username: name, password: stored });
    if (login.ok) return login.cookie;
  }
  const password = stored ?? randomBytes(16).toString('hex');
  const registered = await post('/api/auth/register', { username: name, password, displayName: name });
  if (!registered.ok) {
    throw new Error(registered.status === 409 ? `the account "${name}" already exists and its password is not in ${options['token-file']}` : registered.error);
  }
  rememberPassword(password);
  return registered.cookie;
}

let cookie;
try {
  cookie = await signIn();
} catch (error) {
  console.error(`[${name}] could not sign in to ${baseUrl}: ${error.message}`);
  process.exit(1);
}

// ---- talking to the server ----
const socket = io(`${baseUrl}/dixnt`, { extraHeaders: { cookie } });
const call = (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));

let state = null;
let acting = false; // only one decision at a time
const decided = new Set(); // "round:phase" keys we have already acted on, so a state refresh can't make us act twice

async function connect() {
  let reply = await call('resume', { code });
  if (!reply.ok) reply = await call('join', { code });
  if (!reply.ok) {
    log(`could not join: ${reply.error}`);
    process.exit(1);
  }
  log(`in the game ${reply.code} (${baseUrl})`);
}

socket.on('connect', connect);
socket.on('connect_error', (error) => log(`cannot reach the server: ${error.message}`));
socket.on('disconnect', () => log('disconnected, will keep trying to reconnect'));
socket.on('state', (next) => {
  state = next;
  if (state === null) {
    log('removed from the game');
    process.exit(0);
  }
  void act();
});

async function act() {
  if (acting || !state) return;
  const s = state;
  if (s.me.waiting) return;

  let key = null;
  let action = null;
  if (s.phase === 'word' && s.me.isChooser) {
    key = `${s.round}:word`;
    action = chooseWord;
  } else if (s.phase === 'picking' && !s.me.isChooser && s.me.myPick === null) {
    key = `${s.round}:picking`;
    action = playRandomCard;
  } else if (s.phase === 'voting' && s.me.myVote === null && s.voteTargets.length > 0) {
    key = `${s.round}:voting`;
    action = voteRandomly;
  }
  if (!action || decided.has(key)) return;

  acting = true;
  decided.add(key);
  try {
    await sleep(thinkTime());
    await action();
  } finally {
    acting = false;
    void act(); // the state may have moved on while we were thinking
  }
}

async function chooseWord() {
  const reply = await call('hints');
  if (!reply.ok || !reply.hints?.length) return log(`could not get hints: ${reply.error ?? 'none returned'}`);
  const word = pick(reply.hints);
  const result = await call('submitWord', { word });
  log(result.ok ? `chose the word "${word}"` : `could not submit a word: ${result.error}`);
}

async function playRandomCard() {
  const cardId = pick(state.me.hand);
  const result = await call('playCard', { cardId });
  log(result.ok ? `played card ${cardId}` : `could not play a card: ${result.error}`);
}

async function voteRandomly() {
  const targetId = pick(state.voteTargets);
  const target = state.players.find((p) => p.id === targetId);
  const result = await call('vote', { targetId });
  log(result.ok ? `voted for ${target?.name}` : `could not vote: ${result.error}`);
}

process.on('SIGINT', () => {
  log('stopping (the player stays in the game, shown as offline)');
  socket.close();
  process.exit(0);
});
