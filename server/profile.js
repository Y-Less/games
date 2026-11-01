// The profile: how a users row becomes what the site shows (publicUser, publicProfile) and how a profile change is
// checked and saved. Every setting is one row of SETTINGS, so adding one means adding a row (and its column in db.js).
import { textFrom } from '../shared/input.js';
import { normaliseAvatar } from '../shared/avatar.js';
import { isBackgroundAnimation } from '../shared/animations.js';
import { DEFAULT_NAME_STYLE } from '../shared/nameStyles.js';
import { normaliseMarker } from '../shared/markerColours.js';
import { DEFAULT_FONT, DEFAULT_THEME, isSiteFont, isSiteTheme } from '../shared/siteThemes.js';
import { isLanguageTag } from '../shared/languages.js';
import { AuthError } from './errors.js';
import {
  EFFECT_INTENSITY,
  EFFECT_SPEED,
  cleanAvatar,
  cleanBackground,
  cleanBackgroundAnimation,
  cleanCardBack,
  cleanChoice,
  cleanEffectLevel,
  cleanMarkerColour,
  cleanNameStyle,
  cleanPlayAnimations,
} from './profileSettings.js';

const asJson = JSON.stringify; // a `store` for settings kept as JSON text: returns the JSON string of the value // a `store` for settings kept as JSON text: returns the JSON string of the value
const asIs = (value) => value; // a `store` for settings kept as plain text: returns the value unchanged

/**
 * The profile settings, in the order they are checked and saved.
 * - key: the property of a profile change (and of the user the site shows)
 * - column: the users column it is stored in
 * - clean(input): the clean value, or throws an AuthError (the whole change is refused before anything is saved)
 * - check(cleaned, userId): optional second check, run once every setting has been cleaned
 * - store(cleaned): the value written to the column
 * - gated: true when the user must own what they chose (the `canUse` check sees these, cleaned)
 */
export const SETTINGS = [
  {
    key: 'displayName',
    column: 'display_name',
    /**
     * Tidies a display name.
     * @param {*} input  what the client sent
     * @returns {string} the trimmed name (1 to 20 characters)
     * Side effects: none; throws an AuthError when the length is wrong.
     */
    clean(input) {
      const name = textFrom(input).trim();
      if (!name || name.length > 20) throw new AuthError('displayNameLength');
      return name;
    },
    store: asIs,
  },
  {
    key: 'background',
    column: 'background',
    gated: true,
    clean: cleanBackground,
    // A picture can only be chosen by the user who uploaded it (upload file names start with the owner's id).
    /**
     * @param {{ type: string, file?: string }} background  the cleaned background
     * @param {number} userId  the user making the change
     * @returns {void}
     * Side effects: none; throws an AuthError when the picture belongs to someone else.
     */
    check(background, userId) {
      if (background.type === 'image' && !background.file.startsWith(`bg-${userId}-`)) throw new AuthError('invalidBackground');
    },
    store: asJson,
  },
  {
    key: 'cardBack',
    column: 'card_back',
    gated: true,
    clean: cleanCardBack,
    /**
     * @param {{ type: string, file?: string }} cardBack  the cleaned card back
     * @param {number} userId  the user making the change
     * @returns {void}
     * Side effects: none; throws an AuthError when the picture belongs to someone else.
     */
    check(cardBack, userId) {
      if (cardBack.type === 'image' && !cardBack.file.startsWith(`cb-${userId}-`)) throw new AuthError('invalidCardBack');
    },
    store: asJson,
  },
  { key: 'nameStyle', column: 'name_style', gated: true, clean: cleanNameStyle, store: asJson },
  { key: 'avatar', column: 'avatar', gated: true, clean: cleanAvatar, store: asJson },
  { key: 'markerColour', column: 'marker_colour', gated: true, clean: cleanMarkerColour, store: asIs },
  { key: 'siteTheme', column: 'site_theme', gated: true, clean: (input) => cleanChoice(input, isSiteTheme, 'invalidSiteTheme'), store: asIs },
  { key: 'siteFont', column: 'site_font', gated: true, clean: (input) => cleanChoice(input, isSiteFont, 'invalidSiteFont'), store: asIs },
  // The site's language: a tag the client has files for, or null to follow the browser. The server keeps no list of
  // languages (the client finds its own files), so any well-formed tag is accepted.
  { key: 'language', column: 'language', clean: (input) => (input === null ? null : cleanChoice(input, isLanguageTag, 'invalidLanguage')), store: asIs },
  { key: 'playAnimations', column: 'animations_choice', clean: cleanPlayAnimations, store: (play) => (play === null ? null : play ? 1 : 0) },
  { key: 'backgroundAnimation', column: 'background_animation', gated: true, clean: cleanBackgroundAnimation, store: asIs },
  { key: 'effectIntensity', column: 'effect_intensity', gated: true, clean: (input) => cleanEffectLevel(input, EFFECT_INTENSITY), store: asIs },
  { key: 'effectSpeed', column: 'effect_speed', gated: true, clean: (input) => cleanEffectLevel(input, EFFECT_SPEED), store: asIs },
];

/**
 * Reads a stored name style, falling back to the plain default when it is damaged.
 * @param {string} text  the name_style column
 * @returns {{ style: string, animation?: string }}
 * Side effects: none.
 */
function parseNameStyle(text) {
  try {
    return cleanNameStyle(JSON.parse(text));
  } catch {
    return { ...DEFAULT_NAME_STYLE };
  }
}

/**
 * Reads a stored avatar, falling back to the default avatar when it is damaged.
 * @param {string} text  the avatar column
 * @returns {object}
 * Side effects: none.
 */
function parseAvatar(text) {
  try {
    return normaliseAvatar(JSON.parse(text));
  } catch {
    return normaliseAvatar(null);
  }
}

/**
 * Reads a JSON column, using `fallback` when it is damaged.
 * @param {string} text  the stored text
 * @param {object} fallback  what to use instead
 * @returns {object}
 * Side effects: none.
 */
function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * What other players may see of someone: their name, how it is dressed and their avatar.
 * @param {{ display_name: string, name_style: string, avatar: string }} row  a users row
 * @returns {{ displayName: string, nameStyle: object, avatar: object }}
 * Side effects: none.
 */
export const publicProfile = (row) => ({ displayName: row.display_name, nameStyle: parseNameStyle(row.name_style), avatar: parseAvatar(row.avatar) });

/**
 * A users row as the site shows it to its owner.
 * @param {object} row  a users row
 * @returns {object}  the user, with every setting filled in (damaged or missing values get their defaults)
 * Side effects: none.
 */
export function publicUser(row) {
  const background = parseJson(row.background, { type: 'preset', value: 'night' });
  const cardBack = parseJson(row.card_back, { type: 'preset', value: 'crimson' });
  return { id: row.id, username: row.username, displayName: row.display_name, isBot: Boolean(row.is_bot), background, cardBack, nameStyle: parseNameStyle(row.name_style), avatar: parseAvatar(row.avatar), markerColour: normaliseMarker(row.marker_colour), siteTheme: isSiteTheme(row.site_theme) ? row.site_theme : DEFAULT_THEME, siteFont: isSiteFont(row.site_font) ? row.site_font : DEFAULT_FONT, backgroundAnimation: isBackgroundAnimation(row.background_animation) ? row.background_animation : 'none', effectIntensity: row.effect_intensity ?? EFFECT_INTENSITY.normal, effectSpeed: row.effect_speed ?? EFFECT_SPEED.normal, language: isLanguageTag(row.language) ? row.language : null, playAnimations: row.animations_choice === null || row.animations_choice === undefined ? null : row.animations_choice !== 0 };
}

/**
 * The profile operations on a database.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ canUse?: (userId: number, settings: object) => void }} [options]
 *   canUse throws when a profile change uses something the user has not bought (the site wires the shop's check in; tests may omit it).
 * @returns {{ userById: (id: number) => object | null, publicProfiles: (ids: number[]) => object, updateProfile: (userId: number, changes: object) => object }}
 * Side effects: none until a method is called.
 */
export function createProfiles(db, { canUse = () => {} } = {}) {
  /**
   * One user as the site shows them.
   * @param {number} id
   * @returns {object | null}  null when there is no such user
   * Side effects: reads the database.
   */
  function userById(id) {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return row ? publicUser(row) : null;
  }

  /**
   * Up to 100 users' public profiles as { [id]: { displayName, nameStyle, avatar } }; unknown ids are left out.
   * @param {number[]} ids
   * @returns {object}
   * Side effects: reads the database.
   */
  function publicProfiles(ids) {
    const out = {};
    const select = db.prepare('SELECT display_name, name_style, avatar FROM users WHERE id = ?');
    for (const id of [...new Set(ids)].slice(0, 100)) {
      const row = Number.isInteger(id) ? select.get(id) : null;
      if (row) out[id] = publicProfile(row);
    }
    return out;
  }

  /**
   * Changes some of a user's profile settings (any property of SETTINGS that is not undefined).
   * @param {number} userId
   * @param {object} changes  the new values, as the client sent them
   * @returns {object}  the user after the change
   * @throws {AuthError} when a value is invalid, or `canUse` refuses it; a refused change changes nothing
   * Side effects: one UPDATE per changed setting.
   */
  function updateProfile(userId, changes) {
    const given = SETTINGS.filter(({ key }) => changes[key] !== undefined);
    // Check everything first, so a refused change changes nothing.
    const cleaned = new Map(given.map((setting) => [setting.key, setting.clean(changes[setting.key])]));
    for (const setting of given) setting.check?.(cleaned.get(setting.key), userId);
    canUse(userId, Object.fromEntries(SETTINGS.filter((s) => s.gated).map(({ key }) => [key, cleaned.get(key)])));
    for (const setting of given) db.prepare(`UPDATE users SET ${setting.column} = ? WHERE id = ?`).run(setting.store(cleaned.get(setting.key)), userId);
    return userById(userId);
  }

  return { userById, publicProfiles, updateProfile };
}
