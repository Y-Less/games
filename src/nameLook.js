// What a player's name pill looks like: the style (shared/nameStyles.js) and animation (shared/animations.js) they chose,
// as the CSS custom properties and attributes that the `.name-pill` rules in style.css draw. StyledName wears it on the
// name itself; the scoreboard puts it on the player's whole chip. Give it the player's account id (`userId`), or
// `styleId` / `animationId` to show a particular look whatever the player owns (the shop's previews).
import { nameStyleById } from '../shared/nameStyles.js';
import { profileOf } from './profiles.js';

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
