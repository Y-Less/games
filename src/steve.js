// A secret for people who open the browser's console: it prints a banner, and the function the banner names unlocks the
// global "Steve's Achievement" for whoever is signed in.  What it says back comes from the site's locale file (steve.*),
// in the language the site is showing.
import banner from './steve.txt?raw';
import { api } from './api.js';
import { i18n } from './i18n.js';

// The ASCII banner printed to the console (trailing whitespace removed).
export const STEVE_BANNER = banner.trimEnd();

// The site's words, in whatever language it is showing (this runs outside any component, so it reads the instance).
const t = (key, params) => i18n.global.t(key, params ?? {});

/**
 * Asks the server to unlock the achievement.  Returns what to tell the person who typed it in the console.
 * @param {Function} [call]  the API caller (api by default; replaceable in tests)
 * @returns {Promise<string>}  a message for the console: success, or a hint to sign in
 * Side effects: one POST to /api/achievements/steve.
 */
export async function claimSteve(call = api) {
  try {
    await call('POST', '/api/achievements/steve', {}); // (the site refuses a POST that is not JSON)
    return t('steve.yours');
  } catch (error) {
    return t('steve.signInFirst', { reason: error.message });
  }
}

/**
 * Prints the banner and defines window.claim_steves_achievement.
 * @param {object} [target]  the object to hang the function on (window in the browser)
 * @param {Function} [log]  the printer (console.log by default)
 * @returns {void}
 * Side effects: sets target.claim_steves_achievement and logs the banner.
 */
export function installSteve(target = globalThis, log = console.log) {
  target.claim_steves_achievement = () => claimSteve();
  log(STEVE_BANNER);
}
