// Accounts: registration, login, sessions (an opaque random cookie; only its hash is stored) and the profile.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { AVATAR_SLOTS, isAvatarOption, normaliseAvatar } from '../shared/avatar.js';
import { isBackgroundAnimation, isNameAnimation } from '../shared/animations.js';
import { DEFAULT_NAME_STYLE, isNameStyle } from '../shared/nameStyles.js';
import { normaliseMarker } from '../shared/markerColours.js';

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = 'sid';
export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const BACKGROUND_PRESETS = {
  night: 'radial-gradient(1200px 700px at 50% -10%, #254452 0%, #16252d 60%)',
  dusk: 'linear-gradient(160deg, #2b1f3d 0%, #4a2c4f 45%, #7a3e55 100%)',
  forest: 'linear-gradient(170deg, #12261c 0%, #1d3b2a 55%, #2f5a3c 100%)',
  ocean: 'linear-gradient(170deg, #0b1e36 0%, #12385c 55%, #1b5f84 100%)',
  ember: 'linear-gradient(165deg, #2a120e 0%, #522018 55%, #8a3a22 100%)',
  slate: 'linear-gradient(170deg, #1b1d22 0%, #2a2e36 100%)',
  // A very dark green-tinged slate: the slate background under a green panel (60%).
  pine: 'linear-gradient(170deg, #0b1611 0%, #111d19 100%)',
};

/** Card-back designs (CSS backgrounds). Card games draw every face-down card with the signed-in user's choice. */
export const CARD_BACK_PRESETS = {
  crimson:
    'repeating-linear-gradient(45deg, #8a2433 0 7px, #6b1a27 7px 14px), #6b1a27',
  navy: 'repeating-linear-gradient(135deg, #1f3a68 0 7px, #16294a 7px 14px), #16294a',
  forest: 'repeating-linear-gradient(45deg, #2f6a45 0 7px, #214c32 7px 14px), #214c32',
  gold: 'repeating-linear-gradient(135deg, #c79a3b 0 7px, #9c7425 7px 14px), #9c7425',
  teal: 'radial-gradient(circle at 50% 50%, #2e7d86 0 22%, #1d5058 23% 60%, #123b42 61%)',
  mono: 'repeating-linear-gradient(0deg, #2b2b2e 0 6px, #3a3a3e 6px 12px), #2b2b2e',
};

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;
const KEY_LENGTH = 64;
const isText = (value) => typeof value === 'string';
const COLOUR = /^#[0-9a-fA-F]{6}$/;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  // Always do the full amount of work, and only accept a stored key of the length we wrote (a damaged hash such as
  // "scrypt$zz$zz" decodes to an empty key, which must never match anything).
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  return expected.length === KEY_LENGTH && crypto.timingSafeEqual(actual, expected);
}

/** Checks a background setting and returns the clean version that is stored. */
export function cleanBackground(input) {
  const type = input?.type;
  if (type === 'preset' && isText(input.value) && Object.hasOwn(BACKGROUND_PRESETS, input.value)) return { type, value: input.value };
  if (type === 'colour' && isText(input.value) && COLOUR.test(input.value)) return { type, value: input.value.toLowerCase() };
  if (type === 'gradient' && isText(input.from) && isText(input.to) && COLOUR.test(input.from) && COLOUR.test(input.to)) {
    const angle = Math.max(0, Math.min(360, Math.round(Number(input.angle ?? 160))));
    return { type, from: input.from.toLowerCase(), to: input.to.toLowerCase(), angle: Number.isFinite(angle) ? angle : 160 };
  }
  if (type === 'image' && isText(input.file) && /^bg-\d+-[0-9a-f]{12}\.(png|jpg|webp)$/.test(input.file)) return { type, file: input.file };
  throw new AuthError('That is not a valid background.');
}

/** Checks a card-back setting: one of the presets, or the user's own uploaded picture. */
export function cleanCardBack(input) {
  if (input?.type === 'preset' && isText(input.value) && Object.hasOwn(CARD_BACK_PRESETS, input.value)) return { type: 'preset', value: input.value };
  if (input?.type === 'image' && isText(input.file) && /^cb-\d+-[0-9a-f]{12}\.(png|jpg|webp)$/.test(input.file)) return { type: 'image', file: input.file };
  throw new AuthError('That is not a valid card back.');
}

/**
 * Checks a name style: the id of one of the styles in shared/nameStyles.js and, optionally, one of the animations in
 * shared/animations.js ({ style, animation }; a still name is stored without `animation`).
 */
export function cleanNameStyle(input) {
  if (!(isText(input?.style) && isNameStyle(input.style))) throw new AuthError('That is not a valid name style.');
  if (input.animation === undefined || input.animation === 'none') return { style: input.style };
  if (!isNameAnimation(input.animation)) throw new AuthError('That is not a valid name animation.');
  return { style: input.style, animation: input.animation };
}

/** Checks the play-animations setting: true (always), false (never) or null (follow the device's own motion setting). */
export function cleanPlayAnimations(input) {
  if (typeof input === 'boolean' || input === null) return input;
  throw new AuthError('Play animations must be always, never or follow the device.');
}

export const EFFECT_INTENSITY = { min: 10, max: 300, normal: 100 };
export const EFFECT_SPEED = { min: 25, max: 300, normal: 100 };

/** Checks a background animation level (a whole percentage within the given range). */
export function cleanEffectLevel(input, { min, max }, what) {
  if (!Number.isInteger(input) || input < min || input > max) throw new AuthError(`The ${what} must be a whole number from ${min} to ${max}.`);
  return input;
}

/** Checks a background animation: one of the ids in shared/animations.js. */
export function cleanBackgroundAnimation(input) {
  if (isBackgroundAnimation(input)) return input;
  throw new AuthError('That is not a valid background animation.');
}

/** Checks a default marker colour: a #rrggbb colour (kept in lower case), or null for none. */
export function cleanMarkerColour(input) {
  if (input === null) return null;
  const colour = normaliseMarker(input);
  if (!colour) throw new AuthError('A marker colour is six hex digits such as #ff2d95.');
  return colour;
}

function parseNameStyle(text) {
  try {
    return cleanNameStyle(JSON.parse(text));
  } catch {
    return { ...DEFAULT_NAME_STYLE };
  }
}

/** Checks an avatar: an object with, for each slot, the id of one of its options in shared/avatar.js (a missing slot gets the default). */
export function cleanAvatar(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AuthError('That is not a valid avatar.');
  for (const { slot } of AVATAR_SLOTS) {
    if (input[slot] !== undefined && !isAvatarOption(slot, input[slot])) throw new AuthError('That is not a valid avatar.');
  }
  return normaliseAvatar(input);
}

function parseAvatar(text) {
  try {
    return normaliseAvatar(JSON.parse(text));
  } catch {
    return normaliseAvatar(null);
  }
}

/** What other players may see of someone: their name, how it is dressed and their avatar. */
const publicProfile = (row) => ({ displayName: row.display_name, nameStyle: parseNameStyle(row.name_style), avatar: parseAvatar(row.avatar) });

function publicUser(row) {
  let background;
  try {
    background = JSON.parse(row.background);
  } catch {
    background = { type: 'preset', value: 'night' };
  }
  let cardBack;
  try {
    cardBack = JSON.parse(row.card_back);
  } catch {
    cardBack = { type: 'preset', value: 'crimson' };
  }
  return { id: row.id, username: row.username, displayName: row.display_name, isBot: Boolean(row.is_bot), background, cardBack, nameStyle: parseNameStyle(row.name_style), avatar: parseAvatar(row.avatar), markerColour: normaliseMarker(row.marker_colour), backgroundAnimation: isBackgroundAnimation(row.background_animation) ? row.background_animation : 'none', effectIntensity: row.effect_intensity ?? EFFECT_INTENSITY.normal, effectSpeed: row.effect_speed ?? EFFECT_SPEED.normal, playAnimations: row.animations_choice === null || row.animations_choice === undefined ? null : row.animations_choice !== 0 };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ canUse?: (userId: number, settings: { background?: object, cardBack?: object, nameStyle?: object, avatar?: object, markerColour?: string | null, backgroundAnimation?: string }) => void }} [options]
 *   canUse throws when a profile change uses something the user has not bought (the shop supplies it; tests may omit it).
 */
export function createAuth(db, { canUse = () => {} } = {}) {
  const attempts = new Map(); // "ip|username" -> { count, first }: slows down password guessing

  function throttle(key) {
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || now - entry.first > 15 * 60 * 1000) {
      attempts.set(key, { count: 1, first: now });
      return;
    }
    entry.count += 1;
    if (entry.count > 10) throw new AuthError('Too many attempts. Please wait a few minutes and try again.', 429);
  }

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

  const byId = (id) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return row ? publicUser(row) : null;
  };

  return {
    async register({ username, password, displayName, isBot = false }) {
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

    logout(token) {
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
    },

    /** The signed-in user for a session token, or null. */
    userForToken(token) {
      if (!token || typeof token !== 'string') return null;
      const row = db
        .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
        .get(hash(token), Date.now());
      return row ? publicUser(row) : null;
    },

    userById: byId,

    /** Up to 100 users' public profiles as { [id]: { displayName, nameStyle, avatar } }; unknown ids are left out. */
    publicProfiles(ids) {
      const out = {};
      const select = db.prepare('SELECT display_name, name_style, avatar FROM users WHERE id = ?');
      for (const id of [...new Set(ids)].slice(0, 100)) {
        const row = Number.isInteger(id) ? select.get(id) : null;
        if (row) out[id] = publicProfile(row);
      }
      return out;
    },

    updateProfile(userId, { displayName, background, cardBack, nameStyle, avatar, markerColour, backgroundAnimation, playAnimations, effectIntensity, effectSpeed }) {
      // Check everything first, so a refused change changes nothing.
      let name;
      if (displayName !== undefined) {
        name = String(displayName).trim();
        if (!name || name.length > 20) throw new AuthError('Display names are 1 to 20 characters.');
      }
      const cleanedBackground = background === undefined ? undefined : cleanBackground(background);
      const cleanedCardBack = cardBack === undefined ? undefined : cleanCardBack(cardBack);
      const cleanedNameStyle = nameStyle === undefined ? undefined : cleanNameStyle(nameStyle);
      const cleanedAvatar = avatar === undefined ? undefined : cleanAvatar(avatar);
      const cleanedMarker = markerColour === undefined ? undefined : cleanMarkerColour(markerColour);
      const cleanedPlay = playAnimations === undefined ? undefined : cleanPlayAnimations(playAnimations);
      const cleanedBackgroundAnimation = backgroundAnimation === undefined ? undefined : cleanBackgroundAnimation(backgroundAnimation);
      const cleanedIntensity = effectIntensity === undefined ? undefined : cleanEffectLevel(effectIntensity, EFFECT_INTENSITY, 'intensity');
      const cleanedSpeed = effectSpeed === undefined ? undefined : cleanEffectLevel(effectSpeed, EFFECT_SPEED, 'speed');
      // A picture can only be chosen by the user who uploaded it (upload file names start with the owner's id).
      if (cleanedBackground?.type === 'image' && !cleanedBackground.file.startsWith(`bg-${userId}-`)) throw new AuthError('That is not a valid background.');
      if (cleanedCardBack?.type === 'image' && !cleanedCardBack.file.startsWith(`cb-${userId}-`)) throw new AuthError('That is not a valid card back.');
      canUse(userId, { background: cleanedBackground, cardBack: cleanedCardBack, nameStyle: cleanedNameStyle, avatar: cleanedAvatar, markerColour: cleanedMarker, backgroundAnimation: cleanedBackgroundAnimation, effectIntensity: cleanedIntensity, effectSpeed: cleanedSpeed });
      if (name !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, userId);
      if (cleanedBackground !== undefined) db.prepare('UPDATE users SET background = ? WHERE id = ?').run(JSON.stringify(cleanedBackground), userId);
      if (cleanedCardBack !== undefined) db.prepare('UPDATE users SET card_back = ? WHERE id = ?').run(JSON.stringify(cleanedCardBack), userId);
      if (cleanedNameStyle !== undefined) db.prepare('UPDATE users SET name_style = ? WHERE id = ?').run(JSON.stringify(cleanedNameStyle), userId);
      if (cleanedAvatar !== undefined) db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(JSON.stringify(cleanedAvatar), userId);
      if (cleanedMarker !== undefined) db.prepare('UPDATE users SET marker_colour = ? WHERE id = ?').run(cleanedMarker, userId);
      if (cleanedPlay !== undefined) db.prepare('UPDATE users SET animations_choice = ? WHERE id = ?').run(cleanedPlay === null ? null : cleanedPlay ? 1 : 0, userId);
      if (cleanedBackgroundAnimation !== undefined) db.prepare('UPDATE users SET background_animation = ? WHERE id = ?').run(cleanedBackgroundAnimation, userId);
      if (cleanedIntensity !== undefined) db.prepare('UPDATE users SET effect_intensity = ? WHERE id = ?').run(cleanedIntensity, userId);
      if (cleanedSpeed !== undefined) db.prepare('UPDATE users SET effect_speed = ? WHERE id = ?').run(cleanedSpeed, userId);
      return byId(userId);
    },

    async changePassword(userId, currentPassword, newPassword, keepToken) {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!row || !(await checkPassword(String(currentPassword ?? ''), row.password_hash))) throw new AuthError('Your current password is wrong.', 401);
      if (String(newPassword ?? '').length < 8) throw new AuthError('Passwords must be at least 8 characters.');
      if (String(newPassword).length > 200) throw new AuthError('That password is too long.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(String(newPassword)), userId);
      // Sign out every other device.
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, hash(keepToken ?? ''));
    },

    deleteExpiredSessions() {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    },
  };
}

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

export function sessionCookie(token, { secure = false } = {}) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
