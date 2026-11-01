// The site is translatable, and stays so: every word a player can see comes from a locale file, every key a component or
// a server asks for exists in English, and every key in English is asked for by something. This test reads the source
// itself (through Vite's raw imports), so it needs no browser and runs with the rest of the client tests. One case per
// unit (the site, then each game), so a game can be checked on its own: `vitest run src/i18n.test.js -t hearts`.
//
// What counts as text in a template: a text node, or a static `title`, `aria-label`, `placeholder` (and the other
// attributes listed below) with two or more letters in a row. What counts as text in a script or a .js file: a string
// literal of three or more words that starts with a capital letter or ends in punctuation, which is what a sentence
// looks like and a CSS class list or a key does not. Comments, imports, console output and thrown Errors (for
// developers, not players) are left out.
import { describe, expect, it } from 'vitest';
import siteMessages from './locales/en.json';

const moduleMessages = import.meta.glob('../modules/*/locales/en.json', { eager: true, import: 'default' });
const sources = import.meta.glob(['./**/*.{vue,js}', '../modules/*/client/**/*.{vue,js}', '../modules/*/*.js', '../shared/*.js', '../server/**/*.js'], { query: '?raw', import: 'default', eager: true });

/**
 * Source files whose English is not the interface: tests, test kits and fixtures (for developers), and a game's content
 * (Just One's word list, Wavelength's spectra), which is translated as content, not as keys.
 */
const NOT_PLAYER_FACING = /(\.test\.js|testSetup\.js|testkit\.js|renderWalk\.js|views\.js|fixtures\/|\/sim\/|\/arena\.js|\/testing\.js|\/words\.js|\/spectra\.js)$/;
/** Attributes whose static value is read out or shown. */
const TEXT_ATTRIBUTES = ['title', 'aria-label', 'aria-description', 'aria-roledescription', 'placeholder', 'alt', 'label', 'empty', 'intro', 'noun', 'headline', 'message', 'create-label', 'start-label', 'log-title', 'status-title', 'confirm-text', 'legend'];
/** Template text that is not a word in any language. */
const NOT_WORDS = /^(?:Aa|JOKER|[\s\d.,:;/+\-–—×…·•%()&#;'"?!|]*)$/;

const moduleOf = (file) => file.match(/modules\/([^/]+)\//)?.[1] ?? null;
const units = ['site', ...Object.keys(moduleMessages).map(moduleOf).sort()];
const filesOf = (unit) => Object.entries(sources).filter(([file]) => !NOT_PLAYER_FACING.test(file) && (unit === 'site' ? file.startsWith('./') : moduleOf(file) === unit));
const messagesOf = (unit) => (unit === 'site' ? siteMessages : Object.entries(moduleMessages).find(([file]) => moduleOf(file) === unit)[1]);

/**
 * Every leaf key of a message tree, dotted.
 * @param {object} tree  @param {string} [prefix]  @returns {string[]}
 */
function leafKeys(tree, prefix = '') {
  return Object.entries(tree).flatMap(([key, value]) => (value && typeof value === 'object' ? leafKeys(value, `${prefix}${key}.`) : [`${prefix}${key}`]));
}
const siteKeys = new Set(leafKeys(siteMessages));

/** Strips comments from a script (crudely: // to end of line, and /* ... *\/), keeping line breaks so line numbers hold. */
const stripComments = (code) => code.replace(/\/\*[\s*][\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^(\s*)\/\/.*$/gm, '$1').replace(/([;{}(,])\s*\/\/[^\n]*$/gm, '$1');

/** The <template> part of a .vue file (the outermost one), or '' for a .js file. */
const templateOf = (file, code) => (file.endsWith('.vue') ? (code.match(/^<template>([\s\S]*)^<\/template>/m)?.[1] ?? '') : '');
/** The scripts of a file: the <script> parts of a .vue file, or the whole of a .js file. */
const scriptsOf = (file, code) => (file.endsWith('.vue') ? [...code.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]) : [code]);

/**
 * Text a player could see that is written straight into a template: text nodes and static text attributes.
 * @param {string} template  @returns {string[]} what was found, as "text" fragments
 */
function hardCodedInTemplate(template) {
  const found = [];
  const plain = template.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{[\s\S]*?\}\}/g, '');
  for (const [, text] of plain.matchAll(/>([^<>]*)</g)) {
    const words = text.replace(/&[a-z#0-9]+;/gi, '').trim();
    if (/[A-Za-z]{2,}/.test(words) && !NOT_WORDS.test(words)) found.push(words);
  }
  for (const [, name, value] of plain.matchAll(/(?<![:@.\w-])\s([a-z-]+)="([^"]*)"/g)) {
    if (TEXT_ATTRIBUTES.includes(name) && /[A-Za-z]{2,}/.test(value)) found.push(`${name}="${value}"`);
  }
  return found;
}

/**
 * String literals in a script that read like sentences.
 * @param {string} script  @returns {string[]}
 */
function hardCodedInScript(script) {
  const found = [];
  for (const line of stripComments(script).split('\n')) {
    if (/^\s*import\b|import\.meta\.glob|console\.|throw new |new Error\(|assert\.|\bError\(`/.test(line)) continue;
    for (const [, text] of line.matchAll(/(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g).map((m) => [m[0], m[1] ?? m[2] ?? m[3]])) {
      const words = text.replace(/\$\{[^}]*\}/g, 'x').trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
      if (words.length >= 3 && (/^[A-Z]/.test(text.trim()) || /[.!?:]$/.test(text.trim()))) found.push(text);
    }
  }
  return found;
}

/**
 * The static keys a file asks for: t/$t/te/named-style lookups, server messages (msg) and refusal codes (fail, AuthError,
 * ShopError, `error: '...'`) are `keys`, which must exist; every other quoted literal is a `literal`, which may name a key
 * indirectly (a table of keys picked by a value, say); and a template literal's start is a `prefix` (`t(\`pass.${side}\`)`).
 */
function keysAskedFor(code) {
  const plain = stripComments(code);
  const lookups = [...plain.matchAll(/(?<![\w$.])(?:\$t|t|te|named)\(\s*'([^'`]+)'/g)].map((m) => m[1]);
  const messages = [...plain.matchAll(/\bmsg\(\s*'([^'`]+)'/g)].map((m) => m[1]);
  const codes = [...plain.matchAll(/\b(?:fail|AuthError|ShopError)\(\s*'([^'`]+)'/g), ...plain.matchAll(/\berror:\s*'([A-Za-z]+)'/g)].map((m) => `errors.${m[1]}`);
  const literals = [...plain.matchAll(/'([\w.-]+)'/g)].flatMap((m) => [m[1], `errors.${m[1]}`]);
  const prefixes = [...plain.matchAll(/(?:\$t|t|te|msg|named)\(\s*`([^`$]*)\$\{/g)].map((m) => m[1]);
  return { keys: [...lookups, ...messages, ...codes], literals, prefixes };
}

describe.each(units)('%s is translatable', (unit) => {
  const files = filesOf(unit);
  const messages = messagesOf(unit);
  const ownKeys = new Set(leafKeys(messages));
  const has = (key) => ownKeys.has(key) || siteKeys.has(key);

  it('writes no text straight into a template or a script', () => {
    const problems = [];
    for (const [file, code] of files) {
      for (const text of hardCodedInTemplate(templateOf(file, code))) problems.push(`${file}: template: ${text}`);
      for (const script of scriptsOf(file, code)) for (const text of hardCodedInScript(script)) problems.push(`${file}: script: ${text}`);
    }
    expect(problems).toEqual([]);
  });

  it('asks only for keys that exist in English', () => {
    const missing = [];
    for (const [file, code] of files) {
      const { keys } = keysAskedFor(code);
      for (const key of keys) if (!has(key)) missing.push(`${file}: ${key}`);
    }
    expect(missing).toEqual([]);
  });

  it('has no English nobody asks for', () => {
    // A key is asked for by name, by its code (for `errors.`), or through a template literal that starts with its path.
    const askers = unit === 'site' ? Object.entries(sources).filter(([file]) => !NOT_PLAYER_FACING.test(file)) : files;
    const asked = new Set();
    const prefixes = [];
    for (const [, code] of askers) {
      const found = keysAskedFor(code);
      for (const key of [...found.keys, ...found.literals]) asked.add(key);
      prefixes.push(...found.prefixes);
    }
    const unused = leafKeys(messages).filter((key) => !asked.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)) && !key.startsWith('cards.') && !key.startsWith('ordinal.'));
    expect(unused).toEqual([]);
  });
});
