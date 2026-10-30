// Which achievements exist and what to call them: the site's own (shared/achievements.js GLOBAL_ACHIEVEMENTS) and every
// game's, as listed in its module.json. Knows nothing about players, saved progress or coins.
import { GLOBAL_ACHIEVEMENTS } from '../shared/achievements.js';

export const GLOBAL = 'global';

/** The full id of an achievement: a bare key belongs to `game`, and "global.cards" is the site's. */
export const fullId = (game, key) => (key.startsWith(`${GLOBAL}.`) ? key : `${game}.${key}`);

/** The section an id belongs to: "hearts.moon" is in "hearts", "global.cards" in "global". */
export const sectionOf = (id) => id.split('.')[0];

/** @param {() => Array<{ id: string, name: string, achievements?: object[] }>} listGames */
export function createRegistry(listGames) {
  /** The global achievements, then each game that has any: { id, name, definitions }. */
  function sections() {
    return [
      { id: GLOBAL, name: 'Global', definitions: GLOBAL_ACHIEVEMENTS },
      ...listGames()
        .filter((g) => g.achievements?.length)
        .map((g) => ({ id: g.id, name: g.name, definitions: g.achievements })),
    ];
  }

  /** The section and definition for a full id, or null. */
  function find(id) {
    const section = sections().find((s) => s.id === sectionOf(id));
    const definition = section?.definitions.find((d) => `${section.id}.${d.key}` === id);
    return definition ? { section, definition } : null;
  }

  return { sections, find };
}
