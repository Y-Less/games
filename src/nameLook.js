// What a player's name pill looks like: the style (shared/nameStyles.js) and animation (shared/animations.js) they chose,
// as the CSS custom properties and attributes that the `.name-pill` rules in style.css draw.  StyledName wears it on the
// name itself; the scoreboard puts it on the player's whole chip.  Give it the player's account id (`userId`), or
// `styleId` / `animationId` to show a particular look whatever the player owns (the shop's previews).
import { nameStyleById } from '../shared/nameStyles.js';
import { profileOf } from './profiles.js';

/**
 * Works out the name-pill look (colours, animation) for a player.
 * @param {object} [options]
 * @param {?string} [options.userId]  account id whose chosen look is used when styleId/animationId are not given
 * @param {?string} [options.styleId]  force a particular style id (shop previews), whatever the player owns
 * @param {?string} [options.animationId]  force a particular animation id
 * @returns {{ id: string, animation: string, styled: boolean, css: (object|undefined) }}  style id, animation id,
 *   whether any look applies, and the CSS custom properties to bind (undefined when plain and not animated)
 * Side effects: none.
 */
export function nameLook({ userId = null, styleId = null, animationId = null } = {}) {
  const chosen = profileOf(userId)?.nameStyle;
  const style = nameStyleById(styleId ?? chosen?.style);
  const animation = animationId ?? chosen?.animation ?? 'none';
  const styled = style.id !== 'plain' || animation !== 'none';
  // A plain name that has an animation glows in gold.
  const glow = style.border === 'transparent' ? '#e0b84a' : style.border;
  const css = styled ? { '--ns-border': style.border, '--ns-fill': style.fill, '--ns-glow': glow, ...(style.text ? { '--ns-text': style.text } : {}) } : undefined;
  return { id: style.id, animation, styled, css };
}
