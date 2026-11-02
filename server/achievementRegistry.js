// Which achievements exist and what to call them: the site's own (shared/achievements.js GLOBAL_ACHIEVEMENTS) and every
// game's, as listed in its module.json.  Knows nothing about players, saved progress, or coins.
// Depends on: ../shared/achievements.js (the global definitions).
import { GLOBAL_ACHIEVEMENTS } from '../shared/achievements.js';

export const GLOBAL = 'global'; // the section id (and key prefix) of the site's own achievements

/**
 * The full id of an achievement: a bare key belongs to `game`, and "global.cards" is the site's.
 * @param {string} game  the game id a bare key belongs to
 * @param {string} key  a bare key or an already-full "global.<key>" id
 * @returns {string} the full id
 * Side effects: none.
 */
export const fullId = (game, key) => (key.startsWith(`${GLOBAL}.`) ? key : `${game}.${key}`);

/**
 * The section an id belongs to: "hearts.moon" is in "hearts", "global.cards" in "global".
 * @param {string} id  a full achievement id
 * @returns {string} the part before the first dot
 * Side effects: none.
 */
export const sectionOf = (id) => id.split('.')[0];

/**
 * Makes a registry over the live list of games (read on every call, so late-loaded modules show up).
 * @param {() => Array<{ id: string, name: string, achievements?: object[] }>} listGames  the loaded games
 * @returns {{ sections: () => object[], find: (id: string) => object | null }} lookups over the definitions
 * Side effects: none.
 */
export function createRegistry(listGames) {
  /**
   * The global achievements, then each game that has any: { id, name, definitions }.
   * @returns {Array<{ id: string, name: string, definitions: object[] }>} the sections in display order
   * Side effects: none.
   */
  function sections() {
    return [
      { id: GLOBAL, name: 'Global', definitions: GLOBAL_ACHIEVEMENTS },
      ...listGames()
        .filter((g) => g.achievements?.length)
        .map((g) => ({ id: g.id, name: g.name, definitions: g.achievements })),
    ];
  }

  /**
   * The section and definition for a full id, or null.
   * @param {string} id  a full achievement id such as "hearts.moon"
   * @returns {{ section: object, definition: object } | null} the match, or null when unknown
   * Side effects: none.
   */
  function find(id) {
    const section = sections().find((s) => s.id === sectionOf(id));
    const definition = section?.definitions.find((d) => `${section.id}.${d.key}` === id);
    return definition ? { section, definition } : null;
  }

  return { sections, find };
}
