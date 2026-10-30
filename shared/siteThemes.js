// The look of the site, in two parts that a player chooses separately in the shop: a colour theme (the dark surfaces, lines
// and accent that every page is drawn with) and a font. The first of each is free and is what everyone starts with. A theme
// only sets the CSS variables in `vars` (see src/style.css), and a font sets --display (titles) and --body (everything else).
export const SITE_THEMES = [
  { id: 'harbour', name: 'Harbour', price: 0, vars: { bg: '#16252d', raised: '#1f3540', sunken: '#112027', line: '#34505c', muted: '#9fb3b8', amber: '#e0a84a' } },
  { id: 'arctic', name: 'Arctic', price: 400, vars: { bg: '#1a2b3a', raised: '#243b4f', sunken: '#121f2b', line: '#3f6180', muted: '#a4b9cc', amber: '#8fd3f0' } },
  { id: 'midnight', name: 'Midnight', price: 400, vars: { bg: '#121526', raised: '#1c2038', sunken: '#0d0f1d', line: '#353b63', muted: '#a3a8c8', amber: '#e0a84a' } },
  { id: 'forest', name: 'Forest', price: 400, vars: { bg: '#14241c', raised: '#1d3428', sunken: '#0f1b15', line: '#35543f', muted: '#a3bdaa', amber: '#d9b44a' } },
  { id: 'plum', name: 'Plum', price: 400, vars: { bg: '#231a2c', raised: '#33263f', sunken: '#1a1222', line: '#55406a', muted: '#bba8c8', amber: '#ff8fc8' } },
  { id: 'wine', name: 'Wine', price: 400, vars: { bg: '#2a171b', raised: '#3d2328', sunken: '#1f1013', line: '#63393f', muted: '#c9a8ad', amber: '#e0a84a' } },
  { id: 'copper', name: 'Copper', price: 400, vars: { bg: '#261c14', raised: '#37281c', sunken: '#1b130d', line: '#5c452f', muted: '#c4b09a', amber: '#ea8a3c' } },
  { id: 'lagoon', name: 'Lagoon', price: 400, vars: { bg: '#0f2a2e', raised: '#173a40', sunken: '#0a1f22', line: '#2c5f66', muted: '#a0c4c8', amber: '#ff8a73' } },
  { id: 'noir', name: 'Noir', price: 400, vars: { bg: '#0c0c0e', raised: '#1a1a1f', sunken: '#060607', line: '#3a3a44', muted: '#b4b4be', amber: '#b6f23a' } },
  { id: 'graphite', name: 'Graphite', price: 400, vars: { bg: '#1c1d20', raised: '#2a2c31', sunken: '#141518', line: '#46484f', muted: '#a9acb3', amber: '#e0a84a' } },
];

const GEORGIA = "Georgia, 'Times New Roman', serif";
const PALATINO = "'Iowan Old Style', 'Palatino Linotype', Palatino, serif";
const ROUNDED = "ui-rounded, 'SF Pro Rounded', 'Varela Round', Nunito, 'Segoe UI', sans-serif";
const HUMANIST = "Optima, Candara, 'Gill Sans', 'Trebuchet MS', sans-serif";
const GARAMOND = "Garamond, 'EB Garamond', Baskerville, 'Baskerville Old Face', 'Times New Roman', serif";
const COMIC = "'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', 'Comic Sans', cursive";
const WINGDINGS = "Wingdings, 'Wingdings 2', Webdings, fantasy";
const GREAT_VIBES = "'Great Vibes', cursive"; // bundled (src/main.js): a flowing, swashed script
const EMILYS_CANDY = "'Emilys Candy', fantasy"; // bundled: letters decorated with scallops and dots
const MONO = "ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace";
export const SITE_FONTS = [
  { id: 'classic', name: 'Classic', price: 0, display: GEORGIA, body: GEORGIA },
  { id: 'palatino', name: 'Palatino', price: 300, display: PALATINO, body: PALATINO },
  { id: 'rounded', name: 'Rounded', price: 300, display: ROUNDED, body: ROUNDED },
  { id: 'humanist', name: 'Humanist', price: 300, display: HUMANIST, body: HUMANIST },
  { id: 'mono', name: 'Monospace', price: 300, display: MONO, body: MONO },
  { id: 'garamond', name: 'Garamond', price: 300, display: GARAMOND, body: GARAMOND },
  { id: 'comic', name: 'Comic Sans', price: 300, display: COMIC, body: COMIC },
  { id: 'great-vibes', name: 'Great Vibes', price: 300, display: GREAT_VIBES, body: GREAT_VIBES },
  { id: 'emilys-candy', name: 'Emilys Candy', price: 300, display: EMILYS_CANDY, body: EMILYS_CANDY },
  { id: 'wingdings', name: 'Wingdings', price: 300, display: WINGDINGS, body: WINGDINGS },
];

export const DEFAULT_THEME = SITE_THEMES[0].id;
export const DEFAULT_FONT = SITE_FONTS[0].id;
export const themeById = (id) => SITE_THEMES.find((t) => t.id === id) ?? SITE_THEMES[0];
export const fontById = (id) => SITE_FONTS.find((f) => f.id === id) ?? SITE_FONTS[0];
export const isSiteTheme = (id) => typeof id === 'string' && SITE_THEMES.some((t) => t.id === id);
export const isSiteFont = (id) => typeof id === 'string' && SITE_FONTS.some((f) => f.id === id);

/** The CSS variables for a theme and a font, as { '--bg': ... }. */
export function siteVariables(themeId, fontId) {
  const { vars } = themeById(themeId);
  const font = fontById(fontId);
  return { '--bg': vars.bg, '--bg-raised': vars.raised, '--bg-sunken': vars.sunken, '--line': vars.line, '--muted': vars.muted, '--amber': vars.amber, '--display': font.display, '--body': font.body };
}
