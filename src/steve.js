// A secret for people who open the browser's console: it prints a banner, and the function the banner names unlocks the
// global "Steve's Achievement" for whoever is signed in.
import banner from './steve.txt?raw';
import { api } from './session.js';

export const STEVE_BANNER = banner.trimEnd();

/** Asks the server to unlock the achievement. Returns what to tell the person who typed it in the console. */
export async function claimSteve(call = api) {
  try {
    await call('POST', '/api/achievements/steve', {}); // (the site refuses a POST that is not JSON)
    return "Steve's Achievement is yours.";
  } catch (error) {
    return `Sign in first, then try again. (${error.message})`;
  }
}

/** Prints the banner and defines window.claim_steves_achievement. */
export function installSteve(target = globalThis, log = console.log) {
  target.claim_steves_achievement = () => claimSteve();
  log(STEVE_BANNER);
}
