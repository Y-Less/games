// Regression tests for the site's client: bugs that were fixed in src/ without a test being written for that part of
// them at the time.  Each test names the commit it pins and says what went wrong, and each asserts what that commit's
// message says is right, so that taking the fix back out fails here rather than in somebody's browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { api } from './api.js';
import { session } from './session.js';

// The real views are heavy and have nothing to do with what the shell does when the session ends.
vi.mock('./views/GamesView.vue', () => ({ default: { render: () => null } }));
vi.mock('./views/AuthView.vue', () => ({ default: { render: () => null } }));
vi.mock('./views/PlayView.vue', () => ({ default: { render: () => null } }));
vi.mock('./views/ProfileView.vue', () => ({ default: { render: () => null } }));
vi.mock('./views/StatsView.vue', () => ({ default: { render: () => null } }));

const { router } = await import('./router.js');
const { default: App } = await import('./App.vue');

const reply = (body, status) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body });

let fetchMock;
let shell;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(session, { ready: true, user: { id: 1, displayName: 'Ann' } });
});
afterEach(() => {
  shell?.unmount();
  shell = null;
  vi.unstubAllGlobals();
});

describe('a session that ends under a page', () => {
  // b3500eb "Site: an expired session signs the user out everywhere, and a request the server never answers is given
  // up".  Only the game socket noticed a refused session: every page showed the raw error text and carried on as if
  // somebody were still signed in.  (That api.js calls its handler on a 401 has a test; that the session is the one
  // listening did not.)
  it('is forgotten as soon as any request is refused as not signed in', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'Please sign in.' }, 401));
    await expect(api('GET', '/api/stats')).rejects.toThrow();
    expect(session.user).toBe(null);
  });

  // b3500eb "Site: an expired session signs the user out everywhere, and a request the server never answers is given
  // up".  With the user forgotten, the page they were on stayed where it was, unable to load anything; the shell now
  // "goes to the sign-in page with the way back".
  it('sends a private page to the sign-in page, remembering the way back', async () => {
    await router.replace('/play/nomination-whist');
    shell = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('play');

    fetchMock.mockResolvedValue(reply({ error: 'Please sign in.' }, 401));
    await expect(api('GET', '/api/stats')).rejects.toThrow();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.next).toBe('/play/nomination-whist');
  });
});
