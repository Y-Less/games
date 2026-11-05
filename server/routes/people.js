// Finding the person a page is about.  The statistics and achievements pages are "yours" by default and somebody
// else's with a name on the end of the address (/stats/tom, /achievements/3243), and both routes resolve that name
// the same way, so they share this.
import { textFrom } from '../../shared/input.js';

/** A path segment that is all digits is an account id; anything else is the name somebody signs in with. */
const ID = /^\d{1,15}$/;

/**
 * The person a `:who` path segment names: an account id, or a username whatever its capitals.
 *
 * @param {object} auth  the auth module (userById, userByName)
 * @param {unknown} who  the path segment, as the client sent it
 * @returns {object | null} that person's public profile, or null when there is no such account
 * Side effects: reads the database.
 */
export function personNamed(auth, who) {
  const asked = textFrom(who).trim();
  if (!asked) return null;
  return ID.test(asked) ? auth.userById(Number(asked)) : auth.userByName(asked);
}

/**
 * The part of a person a page about them may show: who they are, and nothing else about the account.
 *
 * @param {object} user  a public profile from auth
 * @returns {{ id: number, username: string, displayName: string }}
 * Side effects: none.
 */
export const asSubject = (user) => ({ id: user.id, username: user.username, displayName: user.displayName });
