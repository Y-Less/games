// Changing a lobby's settings, which every game does the same two ways.
//
// A host sends several settings in one message (how many the game is for, how many rounds, how long a turn), and each
// game checks and applies them one after another.  That left a message refused for its third setting with its first
// two already applied: the host was told no, and the table had changed anyway.  A change is all or nothing here.
//
// A new room is the other way about, on purpose: the settings it is made with are a wish list, and one the host got
// wrong is left at its default without spoiling the rest.
//
// Depends on: nothing.

/**
 * Runs a change to a room so that a refusal leaves the room exactly as it was.
 *
 * The room is copied before the change and put back if the change is refused.  It is put back *into the same object*,
 * since the room is held by its store, its scheduler, and whoever called; what is inside it (the list of players, say)
 * is the copy, so a caller must not keep hold of a part of the room across a change that might be refused.  Rooms are
 * plain data (they are saved as JSON), which is what makes copying one safe.
 *
 * @template {{ ok: boolean }} T
 * @param {object} room  the room the change is made to
 * @param {() => T} change  makes the change, answering `{ ok: true }` or a refusal
 * @returns {T} what the change answered
 * Side effects: whatever the change does when it succeeds; none when it is refused (or throws, which is passed on).
 */
export function allOrNothing(room, change) {
  const before = structuredClone(room);
  const restore = () => {
    for (const key of Object.keys(room)) delete room[key];
    Object.assign(room, before);
  };
  let outcome;
  try {
    outcome = change();
  } catch (error) {
    restore();
    throw error;
  }
  if (!outcome?.ok) restore();
  return outcome;
}

/**
 * Applies the settings a new room was asked for, one at a time, so that one the host got wrong is left at its default
 * and the others still count.
 *
 * @param {unknown} settings  what the host asked for (anything that is not an object asks for nothing)
 * @param {(one: object) => unknown} apply  applies an object holding a single setting
 * @returns {void}
 * Side effects: calls `apply` once for each setting that was given.
 */
export function eachSetting(settings, apply) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
  for (const key of Object.keys(settings)) {
    if (settings[key] !== undefined) apply({ [key]: settings[key] });
  }
}
