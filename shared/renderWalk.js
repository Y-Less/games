// A test helper for the client tests (vitest + jsdom): mounts a game module's root component on a stand-in socket and
// feeds it every view a whole seeded game produced (see each module's views.js), collecting anything that goes wrong on
// the way: an error thrown while rendering, a Vue warning (a property read on something that is not there, a bad prop)
// or a console error.  A table that cannot draw some state of a real game is a crash waiting for a player, and this
// finds it without a browser.
// Depends on: @vue/test-utils (test-only) and nothing else; the modules' root components take the props PlayView gives them.
import { flushPromises, mount } from '@vue/test-utils';

/**
 * A stand-in for the platform socket: remembers the handlers a component registers, answers every emit with { ok: true }
 * (a `resume` with a code gets it back, as the server would), and lets the test fire events.
 * @returns {object} the fake socket, with `handlers` (event name -> listener) and `fire(event, ...args)`
 * Side effects: none.
 */
export function fakeSocket() {
  const handlers = {};
  return {
    connected: true,
    handlers,
    on: (event, handler) => (handlers[event] = handler),
    off: (event) => delete handlers[event],
    emit: (event, payload, ack) => ack?.({ ok: true, ...(event === 'resume' || event === 'join' || event === 'create' ? { code: payload?.code || 'a-b-c' } : {}) }),
    close: () => {},
    fire: (event, ...args) => handlers[event]?.(...args),
  };
}

/**
 * Whether a view is one a seated member would receive (strangers are never attached to a room, so their views are not
 * something a table has to draw).
 * @param {object | null} view  a parsed view
 * @returns {boolean}
 * Side effects: none.
 */
export function isMemberView(view) {
  if (!view) return false;
  if (view.me !== undefined) return view.me !== null; // Dixnt
  if (Array.isArray(view.seats) && typeof view.you === 'number') return view.you !== -1 && Boolean(view.seats[view.you]);
  if (Array.isArray(view.players)) return view.players.some((p) => p.id === view.you);
  return true;
}

/**
 * Mounts `Root` and sends it every view in turn, as the server would, then unmounts it.
 * @param {object} Root  the module's root component (its client/index.js default export)
 * @param {Array<string | object | null>} views  the recorded views (JSON text or objects), in order
 * @param {object} [options]
 * @param {object} [options.user]  the signed-in user prop (default { id: 1, displayName: 'Ann' })
 * @param {(view: object | null) => boolean} [options.keep]  which views to send (default isMemberView)
 * @param {(view: object) => object} [options.decorate]  what the server adds to a view before sending it (Dixnt stamps the code)
 * @param {number} [options.step]  send every step-th kept view (default 1: all of them), for a table that is slow to draw in jsdom
 * @returns {Promise<{ sent: number, problems: string[] }>} how many views were sent and every error or warning seen
 * Side effects: mounts and unmounts a component in the test DOM; replaces console.warn/error while running.
 */
export async function walkViews(Root, views, { user = { id: 1, displayName: 'Ann' }, keep = isMemberView, decorate = (view) => view, step = 1 } = {}) {
  const problems = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...args) => problems.push(`warn: ${args.map(String).join(' ')}`);
  console.error = (...args) => problems.push(`error: ${args.map(String).join(' ')}`);
  const socket = fakeSocket();
  let sent = 0;
  let wrapper;
  try {
    wrapper = mount(Root, {
      props: { socket, user, search: '', setSearch: () => {} },
      global: { config: { errorHandler: (error) => problems.push(`thrown: ${error?.stack ?? error}`), warnHandler: (message) => problems.push(`warn: ${message}`) } },
    });
    await flushPromises();
    socket.fire('connect');
    await flushPromises();
    let kept = 0;
    for (const raw of views) {
      const view = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!keep(view)) continue;
      if (kept++ % step !== 0) continue;
      socket.fire('state', decorate(view));
      await flushPromises();
      if (!wrapper.html()) problems.push(`nothing drawn for ${view?.phase}`);
      sent++;
    }
  } catch (error) {
    problems.push(`thrown: ${error?.stack ?? error}`);
  } finally {
    wrapper?.unmount();
    console.warn = original.warn;
    console.error = original.error;
  }
  return { sent, problems };
}
