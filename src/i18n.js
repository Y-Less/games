// The site's languages. Every language is a set of JSON files found at build time: src/locales/<lang>.json for the site and
// modules/<id>/locales/<lang>.json for each game, merged into one message tree with each game's messages under its id
// ('hearts.lobby.intro'). English is bundled; any other language is fetched the first time it is chosen. Adding a language
// is adding those files: nothing else lists them. A game without a translation falls back to English for its own words.
// Depends on: vue-i18n and the locale files (via import.meta.glob, so Vite and vitest find them).
// Side effects: none until setLocale runs (it changes the i18n instance and the document's `lang`).
import { createI18n } from 'vue-i18n';
import siteEnglish from './locales/en.json';

/** The language every other one falls back to, and the one the source text is written in. */
export const FALLBACK = 'en';

const siteFiles = import.meta.glob('./locales/*.json', { import: 'default' });
const moduleFiles = import.meta.glob('../modules/*/locales/*.json', { import: 'default' });
const moduleEnglish = import.meta.glob('../modules/*/locales/en.json', { eager: true, import: 'default' });

/** The languages the site offers: every src/locales/<lang>.json, sorted. */
export const LANGUAGES = Object.keys(siteFiles)
  .map((file) => file.match(/([^/]+)\.json$/)[1])
  .sort();

// The module id a locale file belongs to ('../modules/hearts/locales/fr.json' -> 'hearts').
const moduleOf = (file) => file.match(/modules\/([^/]+)\//)[1];
// The site's messages with each module's under its id.
const bundle = (site, modules) => ({ ...site, ...Object.fromEntries(modules) });

export const i18n = createI18n({
  legacy: false,
  locale: FALLBACK,
  fallbackLocale: FALLBACK,
  messages: { [FALLBACK]: bundle(siteEnglish, Object.entries(moduleEnglish).map(([file, messages]) => [moduleOf(file), messages])) },
  fallbackWarn: false, // a game may lack a translation: English is the design, not a fault
  missingWarn: true, // a key nobody wrote, on the other hand, is a fault the tests must see
});

const loaded = new Set([FALLBACK]);
/**
 * Fetches a language's files (once) and registers its messages.
 * @param {string} lang  one of LANGUAGES
 * @returns {Promise<void>}
 * Side effects: network requests the first time; adds the messages to the i18n instance.
 */
export async function loadLocale(lang) {
  if (loaded.has(lang)) return;
  const site = siteFiles[`./locales/${lang}.json`];
  if (!site) throw new Error(`There is no language "${lang}".`);
  const modules = Object.entries(moduleFiles).filter(([file]) => file.endsWith(`/${lang}.json`));
  const [siteMessages, ...moduleMessages] = await Promise.all([site(), ...modules.map(([, load]) => load())]);
  i18n.global.setLocaleMessage(lang, bundle(siteMessages, moduleMessages.map((messages, i) => [moduleOf(modules[i][0]), messages])));
  loaded.add(lang);
}

/**
 * Switches the site to a language, loading it first if need be.
 * @param {string} lang  one of LANGUAGES (anything else: the fallback)
 * @returns {Promise<void>}
 * Side effects: may fetch files; changes the current locale and the document's `lang` attribute.
 */
export async function setLocale(lang) {
  const chosen = LANGUAGES.includes(lang) ? lang : FALLBACK;
  await loadLocale(chosen);
  i18n.global.locale.value = chosen;
  if (typeof document !== 'undefined') document.documentElement.lang = chosen;
}

/**
 * The language to show someone: their saved choice, else the first of the browser's languages the site has (an exact tag
 * first, then its primary subtag, so 'fr-CA' finds 'fr'), else the fallback.
 * @param {{ language?: string | null } | null} user  the signed-in user, or nobody
 * @returns {string} one of LANGUAGES
 * Side effects: none (reads navigator.languages).
 */
export function pickLocale(user) {
  if (user?.language && LANGUAGES.includes(user.language)) return user.language;
  const wanted = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
  for (const tag of wanted) {
    if (!tag) continue;
    if (LANGUAGES.includes(tag)) return tag;
    const primary = tag.split('-')[0];
    if (LANGUAGES.includes(primary)) return primary;
  }
  return FALLBACK;
}

/**
 * A language's name in that language ("Deutsch", "English"), for the language picker.
 * @param {string} lang  a language tag
 * @returns {string}
 * Side effects: none.
 */
export function languageName(lang) {
  try {
    return new Intl.DisplayNames([lang], { type: 'language' }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}
