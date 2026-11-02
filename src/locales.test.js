// Every translation is checked against the English it stands in for. A language file may leave a key out, because the
// English then shows through, but it may not invent one, lose a value's placeholders, or give a count fewer forms than
// the language needs. Each language is its own case, so `vitest run src/locales.test.js -t ja` checks one of them.
//
// What is NOT checked here: whether the words are any good. That is for a reader of the language.
import { describe, expect, it } from 'vitest';
import { FALLBACK, LANGUAGES, PLURAL_FORMS } from './i18n.js';

const siteFiles = import.meta.glob('./locales/*.json', { eager: true, import: 'default' });
const moduleFiles = import.meta.glob('../modules/*/locales/*.json', { eager: true, import: 'default' });

const langOf = (file) => file.match(/([^/]+)\.json$/)[1];
const unitOf = (file) => file.match(/modules\/([^/]+)\//)?.[1] ?? 'site';

/** Every file of a language, as { unit: messages }. */
const filesFor = (lang) =>
  Object.fromEntries(
    [...Object.entries(siteFiles), ...Object.entries(moduleFiles)].filter(([file]) => langOf(file) === lang).map(([file, messages]) => [unitOf(file), messages]),
  );

/**
 * Every leaf of a message tree, dotted.
 * @param {object} tree  @param {string} [prefix]  @returns {Array<[string, string]>}
 */
function leaves(tree, prefix = '') {
  return Object.entries(tree ?? {}).flatMap(([key, value]) => (value && typeof value === 'object' ? leaves(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]));
}

/** The named placeholders in a message ("{name} took {n}" -> ['n', 'name']), ignoring vue-i18n's literal escapes. */
const placeholders = (text) => [...String(text).matchAll(/\{\s*([A-Za-z_]\w*)\s*\}/g)].map((m) => m[1]).sort();
/** How many forms a message offers for a count ("one | many" -> 2). */
const formCount = (text) => String(text).split('|').length;

const english = filesFor(FALLBACK);
const others = LANGUAGES.filter((lang) => lang !== FALLBACK);

it('English is the language everything else is measured against', () => {
  expect(LANGUAGES).toContain(FALLBACK);
  expect(Object.keys(english).sort()).toContain('site');
});

describe.runIf(others.length).each(others)('the %s translation', (lang) => {
  const files = filesFor(lang);
  // How many forms this language may give a count: as many as its own rules use, or English's two.
  const mostForms = Math.max(2, PLURAL_FORMS[lang]?.length ?? 0);

  it('translates units the site actually has', () => {
    expect(Object.keys(files).filter((unit) => !english[unit])).toEqual([]);
  });

  it('invents no key that the English does not have', () => {
    const unknown = [];
    for (const [unit, messages] of Object.entries(files)) {
      const known = new Set(leaves(english[unit] ?? {}).map(([key]) => key));
      for (const [key] of leaves(messages)) if (!known.has(key)) unknown.push(`${unit}: ${key}`);
    }
    expect(unknown).toEqual([]);
  });

  it('keeps every value a string, so nothing renders as an object', () => {
    const wrong = [];
    for (const [unit, messages] of Object.entries(files)) for (const [key, value] of leaves(messages)) if (typeof value !== 'string') wrong.push(`${unit}: ${key} is ${typeof value}`);
    expect(wrong).toEqual([]);
  });

  it('keeps the placeholders of the English it replaces', () => {
    const lost = [];
    for (const [unit, messages] of Object.entries(files)) {
      const source = Object.fromEntries(leaves(english[unit] ?? {}));
      for (const [key, value] of leaves(messages)) {
        if (typeof source[key] !== 'string') continue;
        const [want, got] = [placeholders(source[key]), placeholders(value)];
        if (String(want) !== String(got)) lost.push(`${unit}: ${key} has {${got.join('}, {')}} where the English has {${want.join('}, {')}}`);
      }
    }
    expect(lost).toEqual([]);
  });

  it('gives a count no more forms than the language uses', () => {
    const tooMany = [];
    for (const [unit, messages] of Object.entries(files)) for (const [key, value] of leaves(messages)) if (formCount(value) > mostForms) tooMany.push(`${unit}: ${key} has ${formCount(value)} forms, and ${lang} uses at most ${mostForms}`);
    expect(tooMany).toEqual([]);
  });

  it('says something wherever the English pluralises, so a count never reads as the wrong form', () => {
    // A language with its own rules (Russian) must give every plural message its full set of forms; one with a single
    // form (Japanese) may give one. What it may not do is offer fewer forms than it has categories.
    const needed = PLURAL_FORMS[lang]?.length ?? 0;
    if (!needed) return;
    const short = [];
    for (const [unit, messages] of Object.entries(files)) {
      const source = Object.fromEntries(leaves(english[unit] ?? {}));
      for (const [key, value] of leaves(messages)) {
        if (typeof source[key] === 'string' && formCount(source[key]) > 1 && formCount(value) !== needed) short.push(`${unit}: ${key} has ${formCount(value)} forms, and ${lang} needs ${needed}`);
      }
    }
    expect(short).toEqual([]);
  });
});
