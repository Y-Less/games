// The Help button's text for every page except a game (a game's own rules.md is shown there): one Markdown file per page
// and language in src/help/<lang>/<page>.md, found at build time. A page without a file in the current language shows
// the English one. The texts may quote `{coinsPerLevel}`, `{coinsLevel5}` and `{singleLevelCoins}`, filled in from the
// real amounts so the help cannot drift from them.
// Depends on: shared/achievements.js (the amounts), i18n.js (the dialog title and the fallback language); read by App.vue.
import { COINS_PER_LEVEL, SINGLE_LEVEL_COINS } from '../shared/achievements.js';
import { FALLBACK, i18n } from './i18n.js';

// Every help file, by path, as text.
const files = import.meta.glob('./help/*/*.md', { query: '?raw', import: 'default', eager: true });

// The amounts the texts may quote.
const AMOUNTS = { coinsPerLevel: COINS_PER_LEVEL, coinsLevel5: COINS_PER_LEVEL * 5, singleLevelCoins: SINGLE_LEVEL_COINS };

/**
 * The help text for a page.
 * @param {{ name: string }} route  the current route (only its name is used)
 * @param {string} [lang]  the language wanted (default: the fallback)
 * @returns {?{ title: string, markdown: string }}  the dialog title and Markdown, or null when the page has no help
 * Side effects: none.
 */
export function pageHelp(route, lang = FALLBACK) {
  const markdown = files[`./help/${lang}/${route.name}.md`] ?? files[`./help/${FALLBACK}/${route.name}.md`];
  if (!markdown) return null;
  return { title: i18n.global.t('common.help'), markdown: markdown.replace(/\{(\w+)\}/g, (match, name) => (name in AMOUNTS ? String(AMOUNTS[name]) : match)) };
}
