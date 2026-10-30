import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FONT, DEFAULT_THEME, SITE_FONTS, SITE_THEMES, isSiteFont, isSiteTheme, siteVariables } from './siteThemes.js';

const HEX = /^#[0-9a-f]{6}$/;
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test('the first theme and font are free and are the defaults; serif is the default font', () => {
  assert.equal(DEFAULT_THEME, SITE_THEMES[0].id);
  assert.equal(SITE_THEMES[0].price, 0);
  assert.equal(DEFAULT_FONT, 'serif');
  assert.equal(SITE_FONTS[0].price, 0);
});

test('every theme and font has a unique id and whole prices, and every theme keeps text readable', () => {
  for (const list of [SITE_THEMES, SITE_FONTS]) {
    assert.equal(new Set(list.map((x) => x.id)).size, list.length);
    for (const x of list) assert.ok(Number.isInteger(x.price) && x.price >= 0 && x.name, x.id);
  }
  for (const { id, vars } of SITE_THEMES) {
    for (const colour of Object.values(vars)) assert.match(colour, HEX, id);
    assert.ok(contrast(vars.muted, vars.bg) >= 4.5, `${id}: muted text on the page`);
    assert.ok(contrast(vars.muted, vars.raised) >= 4, `${id}: muted text on a panel`);
    assert.ok(contrast(vars.amber, vars.raised) >= 4.5, `${id}: the accent on a panel`);
    assert.ok(luminance(vars.sunken) <= luminance(vars.bg) && luminance(vars.bg) <= luminance(vars.raised), `${id}: sunken, page, raised`);
  }
});

test('the variables for a theme and font; unknown ids fall back to the defaults', () => {
  const vars = siteVariables('plum', 'mono');
  assert.equal(vars['--bg'], SITE_THEMES.find((t) => t.id === 'plum').vars.bg);
  assert.match(vars['--display'], /monospace/);
  assert.deepEqual(siteVariables('nope', undefined), siteVariables(DEFAULT_THEME, DEFAULT_FONT));
  assert.ok(isSiteTheme('forest') && !isSiteTheme('x') && !isSiteTheme(null));
  assert.ok(isSiteFont('serif') && !isSiteFont('x') && !isSiteFont(3));
});
