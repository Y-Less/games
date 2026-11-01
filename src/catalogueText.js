// Names the server defines in English and a language may override by key: a game's name and description (module.json),
// its statistics labels and achievements, the site's own achievements, shop items, avatar parts and game categories.
// English is the definition itself; another language's file holds a translation under the key, and a missing one falls
// back to the server's English, so a half-translated catalogue still shows every name.
//   <game>.meta.name, <game>.meta.description, <game>.stats.<key>, <game>.achievements.<key>.{name,text,one}
//   siteAchievements.<key>.{name,text,one}, shop.<itemId>, avatar.slots.<slot>, avatar.options.<slot>.<id>, categories.<key>
// Depends on: ./i18n.js and ./messageText.js.
import { i18n } from './i18n.js';
import { hasText, intlLocale } from './messageText.js';

/**
 * The text under a key, or the fallback when no language has it.
 * @param {string} key  a full key
 * @param {string} fallback  the server's English
 * @param {object} [params]  named values
 * @returns {string}
 * Side effects: none.
 */
export const named = (key, fallback, params) => (hasText(key) ? i18n.global.t(key, params ?? {}) : fallback);

/** The achievements section that is the site's own rather than a game's (server/achievements.js). */
const SITE_SECTION = 'global';

/**
 * The key an achievement's texts live under.
 * @param {string} sectionId  the game id, or the site's own section
 * @param {string} key  the achievement key
 * @returns {string}
 * Side effects: none.
 */
const achievementKey = (sectionId, key) => (sectionId === SITE_SECTION ? `siteAchievements.${key}` : `${sectionId}.achievements.${key}`);

/** A number in the current language's digits and grouping. */
const number = (n) => n.toLocaleString(intlLocale());

export const catalogue = {
  /** @param {{ id: string, name: string }} game  a manifest from /api/config. @returns {string} */
  gameName: (game) => named(`${game.id}.meta.name`, game.name),
  /** @param {{ id: string, description: string }} game  @returns {string} */
  gameDescription: (game) => named(`${game.id}.meta.description`, game.description),
  /** @param {string} key  a manifest category ('cards', 'party' ...). @returns {string} the heading, or the key itself */
  categoryLabel: (key) => named(`categories.${key}`, key),
  /** @param {string} gameId  @param {{ key: string, label: string }} stat  @returns {string} */
  statLabel: (gameId, stat) => named(`${gameId}.stats.${stat.key}`, stat.label),
  /** @param {string} sectionId  the game id or 'global'. @param {{ key: string, name: string }} achievement  @returns {string} */
  achievementName: (sectionId, achievement) => named(`${achievementKey(sectionId, achievement.key)}.name`, achievement.name),
  /**
   * What a level of an achievement asks for, with the number put in ("Shoot the moon 5 times"); the `one` text when the
   * number is 1 and a language gives one. The server's text (already numbered) is the fallback.
   * @param {string} sectionId  @param {{ key: string }} achievement  @param {number} n  the level's number  @param {string} fallback
   * @returns {string}
   */
  achievementText(sectionId, achievement, n, fallback) {
    const base = achievementKey(sectionId, achievement.key);
    if (n === 1 && hasText(`${base}.one`)) return i18n.global.t(`${base}.one`);
    return hasText(`${base}.text`) ? i18n.global.t(`${base}.text`, { n: number(n) }) : fallback;
  },
  /** @param {{ id: string, name: string }} item  a shop item  @returns {string} */
  shopItemName: (item) => named(`shop.${item.id}`, item.name),
  /** @param {{ slot: string, label: string }} slot  an AVATAR_SLOTS entry  @returns {string} */
  avatarSlotLabel: (slot) => named(`avatar.slots.${slot.slot}`, slot.label),
  /** @param {string} slot  @param {{ id: string, name: string }} option  @returns {string} */
  avatarOptionName: (slot, option) => named(`avatar.options.${slot}.${option.id}`, option.name),
};
