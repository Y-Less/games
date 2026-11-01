// Accounts: registration, login, sessions (an opaque random cookie; only its hash is stored) and the cookie helpers.
// The profile (settings, public looks) is in profile.js; the error type is in errors.js.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { AuthError } from './errors.js';
import { createProfiles, publicUser } from './profile.js';

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = 'sid';
export const SESSION_DAYS = 30;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000; // failed sign-ins and registrations are counted over this long
const DAY_MS = 24 * 60 * 60 * 1000;

const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;
const KEY_LENGTH = 64;

/**
 * The stored form of a session token (only this is kept in the database).
 * @param {string} value  the token
 * @returns {string}  its SHA-256, in hex
 * Side effects: none.
 */
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Hashes a password for storage.
 * @param {string} password
 * @returns {Promise<string>}  "scrypt$<salt hex>$<key hex>"
 * Side effects: uses random bytes for the salt.
 */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

/**
 * Whether a password matches a stored hash.
 * @param {string} password
 * @param {string} stored  a value from hashPassword
 * @returns {Promise<boolean>}
 * Side effects: none.
 */
async function checkPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  // Always do the full amount of work, and only accept a stored key of the length we wrote (a damaged hash such as
  // "scrypt$zz$zz" decodes to an empty key, which must never match anything).
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  return expected.length === KEY_LENGTH && crypto.timingSafeEqual(actual, expected);
}

/** Registrations one address may attempt in 15 minutes (the REGISTER_LIMIT environment variable overrides it, for the UI tests). */
export const REGISTER_LIMIT = 20;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ canUse?: (userId: number, settings: object) => void }} [options]
 *   canUse throws when a profile change uses something the user has not bought (the site supplies it from the shop; tests may omit it).
 *   Auth only passes it on to the profile; it knows nothing about the shop.
 * @returns {object}  the account operations (register, login, logout, userForToken, changePassword ...) and the profile ones
 * Side effects: none until a method is called.
 */
export function createAuth(db, { canUse = () => {} } = {}) {
  const attempts = new Map(); // "ip|username" -> { count, first }: slows down password guessing (entries older than the window are dropped as it is used)
  const profiles = createProfiles(db, { canUse });
  const byId = profiles.userById;

  /**
   * Counts one attempt against `key` and refuses it when there have been too many in the last 15 minutes.
   * @param {string} key  what is being limited (an address and username for logins, an address for registrations)
   * @param {number} [max]  attempts allowed in the window
   * @returns {void}
   * @throws {AuthError} status 429 when over the limit
   * Side effects: updates the in-memory `attempts` map.
   */
  function throttle(key, max = 10) {
    const now = Date.now();
    for (const [other, { first }] of attempts) if (now - first > THROTTLE_WINDOW_MS) attempts.delete(other); // forget old keys, or the map grows for ever
    const entry = attempts.get(key);
    if (!entry) {
      attempts.set(key, { count: 1, first: now });
      return;
    }
    entry.count += 1;
    if (entry.count > max) throw new AuthError('Too many attempts. Please wait a few minutes and try again.', 429);
  }

  /**
   * Starts a session for a user.
   * @param {number} userId
   * @returns {string}  the session token (the cookie value; only its hash is stored)
   * Side effects: inserts a sessions row.
   */
  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      hash(token),
      userId,
      now,
      now + SESSION_DAYS * DAY_MS,
    );
    return token;
  }

  return {
    /**
     * Makes an account and signs it in.
     * @param {{ username: string, password: string, displayName?: string, isBot?: boolean, ip?: string }} details
     *   `ip`, when given (the HTTP route always gives it), limits how many accounts one address can make in 15 minutes
     * @returns {Promise<{ user: object, token: string }>}
     * Side effects: inserts a user and a session; counts the attempt against the address.
     */
    async register({ username, password, displayName, isBot = false, ip }) {
      if (ip !== undefined) throttle(`register|${ip}`, Number(process.env.REGISTER_LIMIT) || REGISTER_LIMIT);
      username = String(username ?? '').trim();
      password = String(password ?? '');
      if (!USERNAME.test(username)) throw new AuthError('Usernames are 3 to 20 letters, numbers, dashes or underscores.');
      if (password.length < 8) throw new AuthError('Passwords must be at least 8 characters.');
      if (password.length > 200) throw new AuthError('That password is too long.');
      const name = String(displayName ?? username).trim().slice(0, 20) || username;
      if (db.prepare('SELECT 1 FROM users WHERE username_lower = ?').get(username.toLowerCase())) {
        throw new AuthError('That username is taken.', 409);
      }
      const passwordHash = await hashPassword(password);
      const { lastInsertRowid } = db
        .prepare('INSERT INTO users (username, username_lower, password_hash, display_name, is_bot, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(username, username.toLowerCase(), passwordHash, name, isBot ? 1 : 0, Date.now());
      const id = Number(lastInsertRowid);
      return { user: byId(id), token: createSession(id) };
    },

    /**
     * Signs a user in.
     * @param {{ username: string, password: string, ip?: string }} details
     * @returns {Promise<{ user: object, token: string }>}
     * @throws {AuthError} 401 for a wrong username or password, 429 when there have been too many attempts
     * Side effects: counts the attempt (cleared on success); inserts a session on success.
     */
    async login({ username, password, ip = '' }) {
      username = String(username ?? '').trim();
      throttle(`${ip}|${username.toLowerCase()}`);
      const row = db.prepare('SELECT * FROM users WHERE username_lower = ?').get(username.toLowerCase());
      // Always do the hashing work, so a missing user takes as long as a wrong password.
      const ok = await checkPassword(String(password ?? ''), row?.password_hash ?? 'scrypt$00$00');
      if (!row || !ok) throw new AuthError('Wrong username or password.', 401);
      attempts.delete(`${ip}|${username.toLowerCase()}`);
      return { user: publicUser(row), token: createSession(row.id) };
    },

    /**
     * Ends a session.
     * @param {string | undefined} token  the session token (nothing happens without one)
     * @returns {void}
     * Side effects: deletes the sessions row.
     */
    logout(token) {
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
    },

    /**
     * The signed-in user for a session token, or null.
     * @param {string | undefined} token
     * @returns {object | null}
     * Side effects: none.
     */
    userForToken(token) {
      if (!token || typeof token !== 'string') return null;
      const row = db
        .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
        .get(hash(token), Date.now());
      return row ? publicUser(row) : null;
    },

    // Profile operations are passed straight through from profile.js (see createProfiles) so callers only need `auth`.
    userById: profiles.userById,
    publicProfiles: profiles.publicProfiles,
    updateProfile: profiles.updateProfile,

    /**
     * Changes a password and signs out every other device.
     * @param {number} userId
     * @param {string} currentPassword
     * @param {string} newPassword
     * @param {string} [keepToken]  the session to keep signed in
     * @returns {Promise<void>}
     * @throws {AuthError} 401 for a wrong current password, 400 for an unusable new one
     * Side effects: updates the password hash; deletes the user's other sessions.
     */
    async changePassword(userId, currentPassword, newPassword, keepToken) {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!row || !(await checkPassword(String(currentPassword ?? ''), row.password_hash))) throw new AuthError('Your current password is wrong.', 401);
      if (String(newPassword ?? '').length < 8) throw new AuthError('Passwords must be at least 8 characters.');
      if (String(newPassword).length > 200) throw new AuthError('That password is too long.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(String(newPassword)), userId);
      // Sign out every other device.
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, hash(keepToken ?? ''));
    },

    /**
     * Removes sessions that have run out.
     * @returns {void}
     * Side effects: deletes sessions rows.
     */
    deleteExpiredSessions() {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    },
  };
}

/**
 * Reads a Cookie header.
 * @param {string} [header]
 * @returns {Record<string, string>}  cookie name -> value (malformed ones are skipped)
 * Side effects: none.
 */
export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    try {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // ignore a malformed cookie
    }
  }
  return cookies;
}

/**
 * The Set-Cookie value that signs a browser in.
 * @param {string} token  the session token
 * @param {{ secure?: boolean }} [options]  secure: add the Secure flag (the request came over HTTPS)
 * @returns {string}
 * Side effects: none.
 */
export function sessionCookie(token, { secure = false } = {}) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

// The Set-Cookie value that signs a browser out: the same cookie, emptied and expired at once.
export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
