// A stand-alone Scribblers player, so that there is somebody to play against while the game is being worked on.  It is
// a separate process that signs in as an account and talks to the site over the same HTTP and Socket.IO API as the
// browser does, so you can run as many as you like:
//
//   node modules/scribblers/bots/bot.js --join boss-aware-you --name Robin
//   node modules/scribblers/bots/bot.js --join boss-aware-you --name Robin --url http://192.168.1.20:3000
//
// What it does:
//   - signs in with an account named after the bot (registering it the first time, and remembering the password);
//   - when it is drawing, it chooses one of the words it is offered, searches the web for a picture of it, and draws
//     that picture on the board (see picture.js: the picture is brought down to 256 x 256 and painted as blocks);
//   - when it is guessing, it tries a word from the game's own list once a second, narrowed by how many letters the
//     word has and which of them have been shown (see guessing.js);
//   - it joins an existing game and never starts one or moves a round on: a person does that.
//
// Depends on socket.io-client, ./picture.js (the picture), ./guessing.js (the guesses), ../words.js (the word list) and
// ../drawing.js (how many instructions fit in one message).  It is run directly and never imported, so everything
// below runs at load time.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';
import { MAX_BATCH } from '../drawing.js';
import { wordList } from '../words.js';
import { pickGuess } from './guessing.js';
import { drawingFor } from './picture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: options } = parseArgs({
  options: {
    join: { type: 'string', short: 'j' }, // the game's invite code, e.g. boss-aware-you
    name: { type: 'string', short: 'n' },
    url: { type: 'string', short: 'u', default: 'http://localhost:3000' },
    delay: { type: 'string', short: 'd', default: '1000-4000' }, // min-max milliseconds to "think" before choosing a word
    'guess-every': { type: 'string', default: '1000' }, // milliseconds between guesses
    'token-file': { type: 'string', default: path.join(here, '.bot-tokens.json') },
    help: { type: 'boolean', short: 'h' },
  },
});

if (options.help) {
  console.log(`Usage: node modules/scribblers/bots/bot.js --join CODE [--name NAME] [--url URL] [--delay MIN-MAX] [--guess-every MS] [--token-file FILE]

  --join         the invite code of the game to join, e.g. boss-aware-you (required)
  --name         the bot's account and player name: 3 to 20 letters, numbers, dashes or underscores (default: Bot-<random number>)
  --url          the site (default: http://localhost:3000)
  --delay        how long to "think" before choosing a word, in ms, as MIN-MAX (default: 1000-4000)
  --guess-every  how often to guess while somebody else draws, in ms (default: 1000)
  --token-file   where to remember each bot account's password (default: .bot-tokens.json beside this script)`);
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
const guessEvery = Math.max(200, Number(options['guess-every']) || 1000);

// Prints a line prefixed with the bot's name, so several bots in one terminal can be told apart.
const log = (message) => console.log(`[${name}] ${message}`);
// Resolves after ms milliseconds (the bot's "thinking" pause, and the gap between batches of strokes).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A random think time between the --delay minimum and maximum, so bots do not act in lockstep.
const thinkTime = () => minDelay + Math.random() * (maxDelay - minDelay);
const baseUrl = options.url.replace(/\/+$/, '');
const words = wordList();

// ---- identity: an account named after the bot, with a password remembered between runs ----
/**
 * Reads the remembered bot passwords from the token file.
 * @returns {{ [name: string]: string }} password per bot account name; empty if the file is missing or unreadable
 * Side effects: reads the token file.
 */
function readPasswords() {
  try {
    return JSON.parse(fs.readFileSync(options['token-file'], 'utf8'));
  } catch {
    return {}; // first run
  }
}

/**
 * Saves this bot's password into the token file so the account can be signed into again on the next run.
 * @param {string} password  the account password to store under the bot's name
 * @returns {void}
 * Side effects: creates the token file's folder if needed and rewrites the token file.
 */
function rememberPassword(password) {
  const passwords = readPasswords();
  passwords[name] = password;
  fs.mkdirSync(path.dirname(options['token-file']), { recursive: true });
  fs.writeFileSync(options['token-file'], JSON.stringify(passwords, null, 2));
}

/**
 * POSTs JSON to the site and reports the outcome without throwing on HTTP errors.
 * @param {string} url  path beginning with "/", appended to the site URL
 * @param {object} body  JSON request body
 * @returns {Promise<{ ok: boolean, status: number, error?: string, cookie: string | null }>} the outcome, with the
 *   session cookie if one was set
 * Side effects: one HTTP request to the site.
 */
async function post(url, body) {
  const res = await fetch(baseUrl + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  const cookie = res.headers.getSetCookie?.()[0]?.split(';')[0] ?? null;
  return { ok: res.ok, status: res.status, error: data.error, cookie };
}

/**
 * Logs in with the remembered password, registering the account first if it does not exist yet.
 * @returns {Promise<string | null>} the session cookie to send on the socket
 * Side effects: HTTP requests to the site; may register an account and write the token file.  Throws if the account
 *   exists but its password is unknown.
 */
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
const socket = io(`${baseUrl}/scribblers`, { extraHeaders: { cookie } });
// Emits a socket event and resolves with the server's acknowledgement reply.
const call = (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));

let state = null;
let joining = false; // true while connect() is settling, when being out of a game is expected
let busy = false; // one job (choosing, drawing) at a time
const done = new Set(); // "<round>:<turn>:<job>" keys already acted on, so a state refresh cannot act twice
let guessTimer = null;
let guessedAt = null; // the turn the guesses belong to
let tried = new Set(); // what has been guessed this turn

/** The turn the game is on, as a key the `done` set can use. */
const turnKey = () => `${state?.round}:${state?.turn}`;

/**
 * Runs on every (re)connection: takes the bot's place in the game, or joins it.
 * @returns {Promise<void>}
 * Side effects: socket events (resume, join), logging, and may end the process if the game cannot be joined.
 */
async function connect() {
  joining = true;
  try {
    await joinGame();
  } finally {
    joining = false;
  }
}

/**
 * Takes the bot's place in the game, or joins it, leaving an earlier game if it has to.
 * @returns {Promise<void>}
 * Side effects: socket events (resume, leave, join), logging, and may end the process if the game cannot be joined.
 */
async function joinGame() {
  let reply = await call('resume', { code });
  if (!reply.ok) reply = await call('join', { code });
  // A bot that is still in an earlier game (the site allows one at a time) leaves it and tries again: a bot is a test
  // tool, so its last game matters less than the one it is being asked to join.
  if (!reply.ok && reply.error === 'alreadyInGameJoin') {
    log(`leaving the earlier game ${reply.params?.code ?? ''}`.trimEnd());
    await call('leave');
    reply = await call('join', { code });
  }
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
    // Being out of a game while joining one is how leaving an earlier game looks; any other time, the host has
    // removed the bot and there is nothing left for it to do.
    if (joining) return;
    log('removed from the game');
    process.exit(0);
  }
  void act();
});

/**
 * Looks at the latest state and does whatever this bot owes the table: choose a word, draw one, or keep guessing.
 * @returns {Promise<void>}
 * Side effects: sends socket events, starts and stops the guessing timer, and sets `busy` and `done`.
 */
async function act() {
  if (!state) return;
  const guessing = state.phase === 'drawing' && !state.youDraw && !state.youGuessed;
  if (guessing) startGuessing();
  else stopGuessing();
  if (busy) return;

  const jobs = [
    ['choose', state.phase === 'choosing' && state.youDraw, chooseWord],
    ['draw', state.phase === 'drawing' && state.youDraw, drawTheWord],
  ];
  for (const [job, due, run] of jobs) {
    const key = `${turnKey()}:${job}`;
    if (!due || done.has(key)) continue;
    busy = true;
    done.add(key);
    try {
      await run();
    } catch (error) {
      log(`${job} failed: ${error.message}`);
    } finally {
      busy = false;
      void act(); // the game may have moved on while that was happening
    }
    return;
  }
}

/**
 * Chooses one of the words on offer, after a think.
 * @returns {Promise<void>}
 * Side effects: sleeps, then sends `word`.
 */
async function chooseWord() {
  const choices = [...state.choices];
  if (!choices.length) return;
  await sleep(thinkTime());
  const n = Math.floor(Math.random() * choices.length);
  const reply = await call('word', { n });
  // The word is read from the list taken before the call: by the time it answers, the state has moved on and the
  // choices are gone (the others must not see them).
  log(reply.ok ? `drawing "${choices[n]}"` : `could not choose a word: ${reply.error}`);
}

/**
 * Searches for a picture of the word and paints it on the board, a message-full of instructions at a time so that the
 * others watch it appear rather than meeting it all at once.  It stops if the turn moves on.
 * @returns {Promise<void>}
 * Side effects: HTTP requests (the search and the picture), then `clear` and `draw` socket events.
 */
async function drawTheWord() {
  const word = state.word;
  const turn = turnKey();
  if (!word) return;
  log(`looking for a picture of "${word}"`);
  const { ops, url } = await drawingFor(word);
  if (!ops.length) {
    log(`found no picture of "${word}", so there is nothing to draw`);
    return;
  }
  log(`drawing ${ops.length} strokes from ${url}`);
  await call('clear');
  for (let at = 0; at < ops.length; at += MAX_BATCH) {
    if (turnKey() !== turn || !state?.youDraw) {
      log('the turn moved on, so the rest of the picture is dropped');
      return;
    }
    const reply = await call('draw', { ops: ops.slice(at, at + MAX_BATCH) });
    if (!reply.ok) {
      log(`the board would not take the strokes: ${reply.error}`);
      return;
    }
    await sleep(120);
  }
  log('the picture is on the board');
}

/**
 * Starts guessing, once every --guess-every milliseconds, if it is not already.
 * @returns {void}
 * Side effects: sets a repeating timer and clears the guesses of the previous turn.
 */
function startGuessing() {
  if (guessedAt !== turnKey()) {
    guessedAt = turnKey();
    tried = new Set();
  }
  if (guessTimer) return;
  guessTimer = setInterval(guessOnce, guessEvery);
}

/**
 * Stops guessing.
 * @returns {void}
 * Side effects: clears the repeating timer.
 */
function stopGuessing() {
  clearInterval(guessTimer);
  guessTimer = null;
}

/**
 * One guess: a word that still fits the hints, which the server will say nothing about unless it is right.
 * @returns {void}
 * Side effects: sends `guess`.
 */
function guessOnce() {
  if (!state || state.phase !== 'drawing' || state.youDraw || state.youGuessed) {
    stopGuessing();
    return;
  }
  const guess = pickGuess({ hints: state.hints, words, tried });
  if (!guess) return;
  tried.add(guess);
  void call('guess', { text: guess });
}
