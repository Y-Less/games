import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from './session.js';

// The real views are heavy and irrelevant to the guards.
vi.mock('./views/GamesView.vue', () => ({ default: { render: () => null } }));
vi.mock('./views/AuthView.vue', () => ({ default: { render: () => null } }));
vi.mock('./views/PlayView.vue', () => ({ default: { render: () => null } }));
vi.mock('./views/ProfileView.vue', () => ({ default: { render: () => null } }));
vi.mock('./views/StatsView.vue', () => ({ default: { render: () => null } }));

const { router } = await import('./router.js');

const USER = { id: 1, displayName: 'Ann' };

async function go(path) {
  await router.push(path);
  return router.currentRoute.value;
}

beforeEach(async () => {
  session.ready = false; // guards are inert until ready, so this lets us park on a protected page
  session.user = null;
  await router.replace('/profile');
  session.ready = true;
});

describe('router guards', () => {
  it('lets everything through until the session is known', async () => {
    session.ready = false;
    expect((await go('/stats')).name).toBe('stats');
  });

  it('sends a signed-out user to login, remembering the page they wanted', async () => {
    const route = await go('/stats');
    expect(route.name).toBe('login');
    expect(route.query.next).toBe('/stats');
  });

  it('remembers the full path including the query', async () => {
    const route = await go('/play/dixnt?boss-aware-you');
    expect(route.name).toBe('login');
    expect(route.query.next).toBe('/play/dixnt?boss-aware-you');
  });

  it('keeps a signed-out user on the login page', async () => {
    expect((await go('/login')).name).toBe('login');
  });

  it('lets a signed-in user reach protected pages', async () => {
    session.user = USER;
    expect((await go('/stats')).name).toBe('stats');
    expect((await go('/play/hearts')).params.game).toBe('hearts');
  });

  it('sends a signed-in user leaving login to a same-site next', async () => {
    session.user = USER;
    const route = await go('/login?next=/play/dixnt%3Fboss-aware-you');
    expect(route.name).toBe('play');
    expect(route.fullPath).toBe('/play/dixnt?boss-aware-you');
  });

  it('sends a signed-in user from login to the home page when there is no next', async () => {
    session.user = USER;
    expect((await go('/login')).fullPath).toBe('/');
  });

  it.each([['https://evil.example/x'], ['//evil.example'], ['/\\evil.example'], ['evil'], ['javascript:alert(1)']])(
    'never follows next=%s off the site',
    async (next) => {
      session.user = USER;
      const route = await go(`/login?next=${encodeURIComponent(next)}`);
      expect(route.fullPath).toBe('/');
    },
  );

  it('ignores a repeated next parameter', async () => {
    session.user = USER;
    expect((await go('/login?next=/stats&next=/profile')).fullPath).toBe('/');
  });
});

describe('router redirects', () => {
  beforeEach(() => {
    session.user = USER;
  });

  it('turns an old /invite link into /play/dixnt, keeping the query', async () => {
    const route = await go('/invite?boss-aware-you');
    expect(route.name).toBe('play');
    expect(route.params.game).toBe('dixnt');
    expect(route.fullPath).toBe('/play/dixnt?boss-aware-you');
  });

  it('keeps a code= query too', async () => {
    expect((await go('/invite?code=boss-aware-you')).fullPath).toBe('/play/dixnt?code=boss-aware-you');
  });

  it.each([['/nowhere'], ['/a/b/c'], ['/play']])('sends unknown path %s home', async (path) => {
    expect((await go(path)).fullPath).toBe('/');
  });
});
