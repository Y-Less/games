// What a person can choose on their profile: the preset backgrounds and card backs, the animation level ranges, and the
// checks that turn whatever a client sends into the clean value that is stored. (The browser does not repeat these
// checks: it is told the presets by /api/config and the server is the only judge, so this is a server-side file.)
import { numberFrom } from '../shared/input.js';
import { AVATAR_SLOTS, isAvatarOption, normaliseAvatar } from '../shared/avatar.js';
import { isBackgroundAnimation, isNameAnimation } from '../shared/animations.js';
import { isNameStyle } from '../shared/nameStyles.js';
import { normaliseMarker } from '../shared/markerColours.js';
import { AuthError } from './errors.js';

export const BACKGROUND_PRESETS = {
  night: 'radial-gradient(1200px 700px at 50% -10%, #254452 0%, #16252d 60%)',
  dusk: 'linear-gradient(160deg, #2b1f3d 0%, #4a2c4f 45%, #7a3e55 100%)',
  forest: 'linear-gradient(170deg, #12261c 0%, #1d3b2a 55%, #2f5a3c 100%)',
  ocean: 'linear-gradient(170deg, #0b1e36 0%, #12385c 55%, #1b5f84 100%)',
  ember: 'linear-gradient(165deg, #2a120e 0%, #522018 55%, #8a3a22 100%)',
  slate: 'linear-gradient(170deg, #1b1d22 0%, #2a2e36 100%)',
  wine: 'linear-gradient(165deg, #25101a 0%, #4a1a2e 55%, #7a2a44 100%)',
  lagoon: 'linear-gradient(170deg, #0a2326 0%, #115055 55%, #1c8081 100%)',
  violet: 'linear-gradient(165deg, #1d1433 0%, #37226a 55%, #5b3d99 100%)',
  // A very dark green-tinged slate: the slate background under a green panel (60%).
  pine: 'linear-gradient(170deg, #0b1611 0%, #111d19 100%)',
};

/** Card-back designs (CSS backgrounds). Card games draw every face-down card with the signed-in user's choice. */
export const CARD_BACK_PRESETS = {
  crimson:
    'repeating-linear-gradient(45deg, #8a2433 0 7px, #6b1a27 7px 14px), #6b1a27',
  navy: 'repeating-linear-gradient(135deg, #1f3a68 0 7px, #16294a 7px 14px), #16294a',
  forest: 'repeating-linear-gradient(45deg, #2f6a45 0 7px, #214c32 7px 14px), #214c32',
  gold: 'repeating-linear-gradient(135deg, #c79a3b 0 7px, #9c7425 7px 14px), #9c7425',
  teal: 'radial-gradient(circle at 50% 50%, #2e7d86 0 22%, #1d5058 23% 60%, #123b42 61%)',
  mono: 'repeating-linear-gradient(0deg, #2b2b2e 0 6px, #3a3a3e 6px 12px), #2b2b2e',
  plum: 'repeating-linear-gradient(45deg, #5b2a6e 0 6px, transparent 6px 12px), repeating-linear-gradient(-45deg, #7c3d92 0 6px, #4a2159 6px 12px), #4a2159',
  ocean: 'repeating-radial-gradient(circle at 50% 120%, #1c6e9c 0 6px, #14527a 6px 12px), #14527a',
  sunset: 'linear-gradient(160deg, #f6a04d 0%, #d6456b 50%, #4a2c6e 100%)',
  emerald: 'linear-gradient(45deg, rgb(0 0 0 / 0.25) 25%, transparent 25% 75%, rgb(0 0 0 / 0.25) 75%) 0 0 / 14px 14px, linear-gradient(45deg, rgb(0 0 0 / 0.25) 25%, transparent 25% 75%, rgb(0 0 0 / 0.25) 75%) 7px 7px / 14px 14px, #1f8a5b',
  rose: 'repeating-linear-gradient(90deg, #d99a8c 0 5px, #b9766a 5px 10px), #b9766a',
  midnight: 'radial-gradient(circle at 20% 25%, #fff 0 1px, transparent 2px) 0 0 / 28px 28px, radial-gradient(circle at 70% 65%, #cfe6ff 0 1px, transparent 2px) 0 0 / 34px 34px, linear-gradient(180deg, #0c1233, #1c1a52)',
  ruby: 'repeating-conic-gradient(#7a1020 0 25%, #a3172f 0 50%) 0 0 / 16px 16px',
  chequer: 'repeating-conic-gradient(#f1ede2 0 25%, #1c1c1f 0 50%) 0 0 / 16px 16px',
  lavender: 'radial-gradient(circle, #f2eaff 0 2px, transparent 3px) 0 0 / 12px 12px, #8f7ad1',
  amber: 'repeating-radial-gradient(circle at 50% 50%, #e0922b 0 5px, #a8650f 5px 10px), #a8650f',
  ice: 'repeating-linear-gradient(45deg, rgb(255 255 255 / 0.3) 0 2px, transparent 2px 9px), repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.3) 0 2px, transparent 2px 9px), #5a9fc9',
  gingham: 'repeating-linear-gradient(0deg, rgb(255 255 255 / 0.16) 0 8px, transparent 8px 16px), repeating-linear-gradient(90deg, rgb(255 255 255 / 0.16) 0 8px, transparent 8px 16px), #3b4a63',
  mint: 'repeating-linear-gradient(90deg, #a9e3cb 0 6px, #7ccaad 6px 12px), #7ccaad',
  carbon: 'radial-gradient(#0d0d0f 40%, transparent 42%) 0 0 / 8px 8px, radial-gradient(#0d0d0f 40%, transparent 42%) 4px 4px / 8px 8px, #26272b',
};

const isText = (value) => typeof value === 'string'; // whether a value is a string: returns a boolean
const COLOUR = /^#[0-9a-fA-F]{6}$/;

export const EFFECT_INTENSITY = { min: 10, max: 300, normal: 100 };
export const EFFECT_SPEED = { min: 25, max: 300, normal: 100 };

/**
 * Checks a background setting and returns the clean version that is stored.
 * @param {*} input  what the client sent
 * @returns {object}  { type: 'preset'|'colour'|'gradient'|'image', ... }
 * @throws {AuthError} 400 when it is not a valid background
 * Side effects: none.
 */
export function cleanBackground(input) {
  const type = input?.type;
  if (type === 'preset' && isText(input.value) && Object.hasOwn(BACKGROUND_PRESETS, input.value)) return { type, value: input.value };
  if (type === 'colour' && isText(input.value) && COLOUR.test(input.value)) return { type, value: input.value.toLowerCase() };
  if (type === 'gradient' && isText(input.from) && isText(input.to) && COLOUR.test(input.from) && COLOUR.test(input.to)) {
    const angle = Math.max(0, Math.min(360, Math.round(numberFrom(input.angle ?? 160))));
    return { type, from: input.from.toLowerCase(), to: input.to.toLowerCase(), angle: Number.isFinite(angle) ? angle : 160 };
  }
  if (type === 'image' && isText(input.file) && /^bg-\d+-[0-9a-f]{12}\.(png|jpg|webp)$/.test(input.file)) return { type, file: input.file };
  throw new AuthError('That is not a valid background.');
}

/**
 * Checks a card-back setting: one of the presets, or the user's own uploaded picture.
 * @param {*} input  what the client sent
 * @returns {{ type: 'preset', value: string } | { type: 'image', file: string }}
 * @throws {AuthError} 400 when it is not a valid card back
 * Side effects: none.
 */
export function cleanCardBack(input) {
  if (input?.type === 'preset' && isText(input.value) && Object.hasOwn(CARD_BACK_PRESETS, input.value)) return { type: 'preset', value: input.value };
  if (input?.type === 'image' && isText(input.file) && /^cb-\d+-[0-9a-f]{12}\.(png|jpg|webp)$/.test(input.file)) return { type: 'image', file: input.file };
  throw new AuthError('That is not a valid card back.');
}

/**
 * Checks a name style: the id of one of the styles in shared/nameStyles.js and, optionally, one of the animations in
 * shared/animations.js ({ style, animation }; a still name is stored without `animation`).
 * @param {*} input  what the client sent
 * @returns {{ style: string, animation?: string }}
 * @throws {AuthError} 400 for an unknown style or animation
 * Side effects: none.
 */
export function cleanNameStyle(input) {
  if (!(isText(input?.style) && isNameStyle(input.style))) throw new AuthError('That is not a valid name style.');
  if (input.animation === undefined || input.animation === 'none') return { style: input.style };
  if (!isNameAnimation(input.animation)) throw new AuthError('That is not a valid name animation.');
  return { style: input.style, animation: input.animation };
}

/**
 * Checks the play-animations setting: true (always), false (never) or null (follow the device's own motion setting).
 * @param {*} input  what the client sent
 * @returns {boolean | null}
 * @throws {AuthError} 400 for anything else
 * Side effects: none.
 */
export function cleanPlayAnimations(input) {
  if (typeof input === 'boolean' || input === null) return input;
  throw new AuthError('Play animations must be always, never or follow the device.');
}

/**
 * Checks a background animation level (a whole percentage within the given range).
 * @param {*} input  what the client sent
 * @param {{ min: number, max: number }} range  the allowed range
 * @param {string} what  the name used in the error message ('intensity' or 'speed')
 * @returns {number}
 * @throws {AuthError} 400 when it is not a whole number in range
 * Side effects: none.
 */
export function cleanEffectLevel(input, { min, max }, what) {
  if (!Number.isInteger(input) || input < min || input > max) throw new AuthError(`The ${what} must be a whole number from ${min} to ${max}.`);
  return input;
}

/**
 * Checks a background animation: one of the ids in shared/animations.js.
 * @param {*} input  what the client sent
 * @returns {string}
 * @throws {AuthError} 400 for an unknown animation
 * Side effects: none.
 */
export function cleanBackgroundAnimation(input) {
  if (isBackgroundAnimation(input)) return input;
  throw new AuthError('That is not a valid background animation.');
}

/**
 * Checks a colour theme or font choice: the id of one that exists.
 * @param {*} input  what the client sent
 * @param {(value: *) => boolean} isValid  whether the id exists
 * @param {string} what  the name used in the error message ('colour theme' or 'font')
 * @returns {*} the input, unchanged
 * @throws {AuthError} 400 when it does not exist
 * Side effects: none.
 */
export function cleanChoice(input, isValid, what) {
  if (!isValid(input)) throw new AuthError(`That is not a ${what}.`);
  return input;
}

/**
 * Checks a default marker colour: a #rrggbb colour (kept in lower case), or null for none.
 * @param {*} input  what the client sent
 * @returns {string | null}
 * @throws {AuthError} 400 when it is not a colour
 * Side effects: none.
 */
export function cleanMarkerColour(input) {
  if (input === null) return null;
  const colour = normaliseMarker(input);
  if (!colour) throw new AuthError('A marker colour is six hex digits such as #ff2d95.');
  return colour;
}

/**
 * Checks an avatar: an object with, for each slot, the id of one of its options in shared/avatar.js (a missing slot gets the default).
 * @param {*} input  what the client sent
 * @returns {object}  the avatar with every slot filled in
 * @throws {AuthError} 400 when it is not a valid avatar
 * Side effects: none.
 */
export function cleanAvatar(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AuthError('That is not a valid avatar.');
  for (const { slot } of AVATAR_SLOTS) {
    if (input[slot] !== undefined && !isAvatarOption(slot, input[slot])) throw new AuthError('That is not a valid avatar.');
  }
  return normaliseAvatar(input);
}
