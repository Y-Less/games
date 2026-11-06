// How the signed-in user's choices look on the page: the background, the card back, whether animations play, and the
// CSS variables of the site theme and font.
// Depends on: shared/siteThemes.js (siteVariables), avatarArt.js (drawing an avatar card back) and sessionState.js
// (preset lists, current user).
import { siteVariables } from '../shared/siteThemes.js';
import { avatarMarkup } from './avatarArt.js';
import { session } from './sessionState.js';

/**
 * The CSS image for a background setting.  Anything unrecognised falls back to the default night sky.
 * @param {object} background  { type: 'preset'|'colour'|'gradient'|'image', ... }
 * @param {Record<string, string>} [presets]  the preset backgrounds by name
 * @returns {string}
 * Side effects: none.
 */
export function backgroundCss(background, presets = session.presets) {
  if (background?.type === 'preset' && presets[background.value]) return presets[background.value];
  if (background?.type === 'colour') return `linear-gradient(${background.value}, ${background.value})`;
  if (background?.type === 'gradient') return `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`;
  if (background?.type === 'image') return `linear-gradient(rgb(0 0 0 / 0.25), rgb(0 0 0 / 0.25)), url(/uploads/${encodeURIComponent(background.file)})`;
  return presets.night ?? '';
}

/**
 * An avatar as a CSS image: the same drawing AvatarFigure puts on the page, wrapped in an SVG document and inlined.
 * Nothing is uploaded or stored, so changing your avatar changes anything drawn with this at once.
 * @param {object | null} avatar  the chosen options (null draws the default avatar)
 * @returns {string} a `url("data:...")` value
 * Side effects: none.
 */
export function avatarImage(avatar) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${avatarMarkup(avatar)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * The CSS background for a card back.  Card games draw every face-down card with this (see .card-back in style.css).
 * @param {object} cardBack  { type: 'preset'|'image'|'avatar', ... }
 * @param {Record<string, string>} [presets]  the preset card backs by name
 * @param {object | null} [avatar]  the avatar to draw for an avatar card back (the signed-in user's by default)
 * @returns {string}
 * Side effects: none.
 */
export function cardBackCss(cardBack, presets = session.cardBacks, avatar = session.user?.avatar ?? null) {
  if (cardBack?.type === 'image') return `url(/uploads/${encodeURIComponent(cardBack.file)}) center / cover no-repeat`;
  if (cardBack?.type === 'avatar') return `${avatarImage(avatar)} center / cover no-repeat`;
  return presets[cardBack?.value] ?? presets.crimson ?? '#6b1a27';
}

/**
 * Puts a background on the page.
 * @param {object} background
 * @returns {void}
 * Side effects: sets the --site-bg variable on the document.
 */
export function applyBackground(background) {
  document.documentElement.style.setProperty('--site-bg', backgroundCss(background));
}

/**
 * Whether animations are playing for this user: their own choice, or else the device's motion setting.
 * @param {object | null} [user]
 * @returns {boolean}
 * Side effects: none.
 */
export function animationsPlaying(user = session.user) {
  if (typeof user?.playAnimations === 'boolean') return user.playAnimations;
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Applies everything about a user's looks to the page (null: the signed-out look).
 * @param {object | null} user
 * @returns {void}
 * Side effects: sets the background, card-back, theme and font variables and data-animations on the document.
 */
export function applyUserLook(user) {
  applyBackground(user?.background);
  // Animations follow the device's own motion setting unless the player has chosen always (on) or never (off) on their profile.
  document.documentElement.dataset.animations = user?.playAnimations === true ? 'on' : user?.playAnimations === false ? 'off' : 'auto';
  document.documentElement.style.setProperty('--card-back', cardBackCss(user?.cardBack));
  for (const [name, value] of Object.entries(siteVariables(user?.siteTheme, user?.siteFont))) document.documentElement.style.setProperty(name, value);
}
