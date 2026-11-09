// Does a view tell its reader something it should not?  Every game keeps secrets — a hand of cards, the word only the
// drawer knows, the dice still in the bag, the target only the psychic sees — and viewFor is what keeps them.  A bug
// there is silent: the game plays correctly and the wrong player simply knows too much, which no ordinary test notices.
//
// Modules had grown five of these checks independently (azulejo and gaudi's `viewLeaks`, splendour's `assertNoLeaks`,
// tints-and-hints' `checkView`, and another `assertNoLeaks` written out again inside cribbage's e2e test).  Reading all
// five, they answer two different questions that had become tangled together:
//
//   1. Secrecy — does this view name something its reader may not see?  Underneath, that is always:
//
//        work out what this viewer may see -> serialise the view -> pull every identifier out of it
//        -> complain about any that is not allowed
//
//      What differs between games is only the policy.  That part stays in the module, as one function; the mechanism
//      is here.  A new game gets the same protection by writing that one function.
//
//   2. Consistency — is this a legal view at all?  A phase in range, no duplicate players, derived counts matching
//      their source, scores matching the scoreboard.  That is most of tints-and-hints' `checkView` and half of
//      azulejo's `viewLeaks`.  It is a different concern and this file deliberately does not do it.
//
// Not every secret is an identifier, so there are two policies rather than one: `allowed` with `pattern` for the games
// whose secrets are ids (a card, a die, a tile), and `forbidden` for the games whose secret is a value in its own
// right — the word in Draw and Scribblers, the target in Wavelength, the dice still in Gaudi's bag.
//
// `leaks` returns the problems and `assertNoLeaks` throws on them, because modules already use both styles.
//
// Depends on: node:assert/strict (for the throwing form).
import assert from 'node:assert/strict';

/**
 * The identifiers a view names that this viewer was not meant to see.
 *
 * @param {object | null | undefined} view  the view as the server would send it; null or undefined has no leaks
 * @param {object} policy
 * @param {Iterable<string | number>} policy.allowed  every identifier this viewer may see.  An id found in the view and
 *   not in here is a leak — so this is the whole of the game's secrecy rule, written as a set.
 * @param {RegExp} policy.pattern  matches one identifier anywhere in the serialised view.  It must be global, and
 *   either match the id itself or capture it in group 1 (`/"id":(\d+)/g` and `/\bC\d+\b/g` both work).
 * @param {Array<{ text: string, why: string }>} [policy.forbidden]  text that must not appear in the view at all,
 *   whatever the ids say: a word, a spectrum's target, the name of a face-down card.  `why` is shown in the message.
 * @param {string} [policy.who]  whose view this is, shown in the messages ('the spectator', 'seat 2')
 * @returns {string[]} one line per problem, empty when the view is clean
 * Side effects: none.
 */
export function leaks(view, { allowed, pattern, forbidden = [], who = 'this view' }) {
  if (view === null || view === undefined) return [];
  const problems = [];
  const text = JSON.stringify(view);
  const permitted = new Set();
  for (const id of allowed) permitted.add(String(id));

  if (!pattern.global) throw new Error('leaks(): the identifier pattern must be global, or only the first id is checked');
  for (const match of text.matchAll(pattern)) {
    const id = String(match[1] ?? match[0]);
    if (!permitted.has(id)) problems.push(`${who}: was sent ${id}, which is not theirs to see`);
  }
  for (const { text: secret, why } of forbidden) {
    if (secret !== null && secret !== undefined && text.includes(JSON.stringify(secret).slice(1, -1))) problems.push(`${who}: ${why}`);
  }
  return [...new Set(problems)]; // the same id leaking twice is one problem to fix
}

/**
 * The same check, as an assertion.
 *
 * @param {object | null | undefined} view  the view to check
 * @param {object} policy  as `leaks`
 * @returns {void}
 * @throws {assert.AssertionError} naming the first problem, with the rest listed after it
 * Side effects: none.
 */
export function assertNoLeaks(view, policy) {
  const problems = leaks(view, policy);
  assert.equal(problems.length, 0, problems.join('\n'));
}

/**
 * Every view of a whole recorded game, checked at once.  `recordedViews` (every module has one) plays a seeded game and
 * keeps every view it sent, to every player and to a spectator, in every phase; this runs the leak check over all of
 * them, which is the cheapest way for a game to be sure it never leaks at any point of any phase.
 *
 * @param {Array<{ view: object, policy: object }>} views  each view with the policy for the player who received it
 * @returns {string[]} every problem found, across every view
 * Side effects: none.
 */
export function leaksInRun(views) {
  return views.flatMap(({ view, policy }) => leaks(view, policy));
}
