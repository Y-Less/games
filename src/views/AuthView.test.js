import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { session } from '../session.js';
import AuthView from './AuthView.vue';

const USER = { id: 1, username: 'ann', displayName: 'Ann', background: { type: 'preset', value: 'night' }, cardBack: { type: 'preset', value: 'crimson' } };

function reply(body, status = 200) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => body };
}

let fetchMock;
let router;
let wrapper;

async function make(path = '/login') {
  router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/login', '/play/:game', '/stats'].map((p) => ({ path: p, component: { render: () => null } })),
  });
  await router.push(path);
  wrapper = mount(AuthView, { global: { plugins: [router] } });
  return wrapper;
}

const fill = async (w, { username = 'ann', password = 'secret12', displayName } = {}) => {
  await w.find('#username').setValue(username);
  if (displayName !== undefined) await w.find('#display').setValue(displayName);
  await w.find('#password').setValue(password);
};
const submit = async (w) => {
  await w.find('form').trigger('submit');
  await flushPromises();
};
const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)[1].body);

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(reply({ user: USER }));
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(session, { user: null, presets: { night: 'n' }, cardBacks: { crimson: 'c' } });
});
afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
});

describe('AuthView sign in', () => {
  it('starts in sign-in mode with no display-name field', async () => {
    const w = await make();
    expect(w.find('button[role="tab"][aria-selected="true"]').text()).toBe('Sign in');
    expect(w.find('#display').exists()).toBe(false);
    expect(w.find('form > button.primary').text()).toBe('Sign in');
  });

  it('disables the button until both fields are filled', async () => {
    const w = await make();
    const button = () => w.find('form > button.primary');
    expect(button().attributes('disabled')).toBeDefined();
    await w.find('#username').setValue('ann');
    expect(button().attributes('disabled')).toBeDefined();
    await w.find('#password').setValue('x');
    expect(button().attributes('disabled')).toBeUndefined();
  });

  it('posts the credentials, updates the session and goes home', async () => {
    const w = await make();
    await fill(w);
    await submit(w);
    expect(fetchMock.mock.calls.at(-1)[0]).toBe('/api/auth/login');
    expect(lastBody()).toEqual({ username: 'ann', password: 'secret12' });
    expect(session.user).toEqual(USER);
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('goes to a same-site next after signing in', async () => {
    const w = await make('/login?next=/play/dixnt%3Fboss-aware-you');
    await fill(w);
    await submit(w);
    expect(router.currentRoute.value.fullPath).toBe('/play/dixnt?boss-aware-you');
  });

  it.each([['https://evil.example'], ['//evil.example'], ['/\\evil.example'], ['stats']])('ignores next=%s', async (next) => {
    const w = await make(`/login?next=${encodeURIComponent(next)}`);
    await fill(w);
    await submit(w);
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('shows the server error, stays on the page and signs nobody in', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'Wrong username or password.' }, 401));
    const w = await make();
    await fill(w);
    await submit(w);
    expect(w.find('[role="alert"]').text()).toBe('Wrong username or password.');
    expect(session.user).toBeNull();
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('clears the error on the next attempt', async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: 'Nope.' }, 401));
    const w = await make();
    await fill(w);
    await submit(w);
    expect(w.find('[role="alert"]').exists()).toBe(true);
    await submit(w);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it('ignores a second submit while busy', async () => {
    let release;
    fetchMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const w = await make();
    await fill(w);
    await w.find('form').trigger('submit');
    await w.find('form').trigger('submit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(w.find('form > button.primary').attributes('disabled')).toBeDefined();
    release(reply({ user: USER }));
    await flushPromises();
    expect(w.find('form > button.primary').attributes('disabled')).toBeUndefined();
  });
});

describe('AuthView register', () => {
  it('switches mode, showing the display name and the password hint', async () => {
    const w = await make();
    await w.findAll('button[role="tab"]')[1].trigger('click');
    expect(w.find('button[role="tab"][aria-selected="true"]').text()).toBe('New account');
    expect(w.find('#display').exists()).toBe(true);
    expect(w.text()).toContain('at least 8 characters');
    expect(w.find('form > button.primary').text()).toBe('Create account');
  });

  it('posts the registration including the display name', async () => {
    const w = await make('/login?next=/stats');
    await w.findAll('button[role="tab"]')[1].trigger('click');
    await fill(w, { username: 'ann', password: 'secret12', displayName: 'Annie' });
    await submit(w);
    expect(fetchMock.mock.calls.at(-1)[0]).toBe('/api/auth/register');
    expect(lastBody()).toEqual({ username: 'ann', password: 'secret12', displayName: 'Annie' });
    expect(session.user).toEqual(USER);
    expect(router.currentRoute.value.fullPath).toBe('/stats');
  });

  it('uses the username as the display-name placeholder', async () => {
    const w = await make();
    await w.findAll('button[role="tab"]')[1].trigger('click');
    expect(w.find('#display').attributes('placeholder')).toBe('Same as your username');
    await w.find('#username').setValue('bob');
    expect(w.find('#display').attributes('placeholder')).toBe('bob');
  });

  it('shows a registration error', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'That username is taken.' }, 409));
    const w = await make();
    await w.findAll('button[role="tab"]')[1].trigger('click');
    await fill(w);
    await submit(w);
    expect(w.find('[role="alert"]').text()).toBe('That username is taken.');
  });
});
