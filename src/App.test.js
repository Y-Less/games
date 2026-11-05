import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { session } from './session.js';
import { playBar, useLeave } from './playBar.js';
import en from './locales/en.json';

vi.mock('./profiles.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, clearProfiles: vi.fn(real.clearProfiles) };
});

// The real views are heavy and irrelevant to the header.
vi.mock('./views/GamesView.vue', () => ({ default: { render: () => null } }));
vi.mock('./views/AuthView.vue', () => ({ default: { render: () => null } }));
vi.mock('./views/PlayView.vue', () => ({ default: { render: () => null } }));
vi.mock('./views/ProfileView.vue', () => ({ default: { render: () => null } }));
vi.mock('./views/StatsView.vue', () => ({ default: { render: () => null } }));

const { router } = await import('./router.js');
const { default: App } = await import('./App.vue');

const registers = (options) => defineComponent({ setup: () => (useLeave(options), () => null) });
const button = (w, text) => w.findAll('button').find((b) => b.text() === text);

let w;
let game;

async function startPlaying(options) {
  session.ready = true;
  session.user = { id: 1, displayName: 'Ann' };
  await router.replace('/play/nomination-whist');
  w = mount(App, { global: { plugins: [router] } });
  playBar.game = { name: 'Nomination Whist' };
  game = mount(registers(options));
  await nextTick();
}

beforeEach(() => {
  session.ready = true;
});

afterEach(() => {
  game?.unmount();
  w?.unmount();
  playBar.game = null;
});

describe('the Leave game button', () => {
  it('leaves the game and stays on the game, whose own lobby takes over, rather than going to the homepage', async () => {
    const leave = vi.fn(() => Promise.resolve());
    await startPlaying({ leave });
    expect(router.currentRoute.value.name).toBe('play');
    await button(w, 'Leave game').trigger('click');
    await flushPromises();
    expect(leave).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.name).toBe('play');
    expect(router.currentRoute.value.params.game).toBe('nomination-whist');
  });

  it('asks first when the game wants confirmation, and stays put if you stay', async () => {
    const leave = vi.fn(() => Promise.resolve());
    await startPlaying({ leave, confirmText: 'A computer player takes your seat if you leave.' });
    await button(w, 'Leave game').trigger('click');
    expect(leave).not.toHaveBeenCalled();
    await button(w, 'Stay').trigger('click');
    expect(router.currentRoute.value.name).toBe('play');
    await button(w, 'Leave game').trigger('click');
    await button(w, 'Yes, leave').trigger('click');
    await flushPromises();
    expect(leave).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.name).toBe('play');
  });
});

describe('the Help button', () => {
  it('is always in the bar, and opens help for the page you are on', async () => {
    session.ready = true;
    session.user = { id: 1, displayName: 'Ann' };
    await router.replace('/stats');
    w = mount(App, { global: { plugins: [router] } });
    await button(w, 'Help').trigger('click');
    expect(w.find('[role="dialog"]').text()).toContain('Your results across every game');
    await button(w, 'Close').trigger('click');
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    await router.replace('/profile');
    await flushPromises();
    expect(button(w, 'Help')).toBeTruthy();
  });

  it('opens the game rules instead while playing', async () => {
    const openRules = vi.fn();
    await startPlaying({ leave: vi.fn() });
    playBar.game = { name: 'Nomination Whist', openRules };
    await button(w, 'Help').trigger('click');
    expect(openRules).toHaveBeenCalledOnce();
    expect(w.find('[role="dialog"]').exists()).toBe(false);
  });
});

describe('the site name', () => {
  // The lines the site picks between.  The test reads them from the English rather than repeating them, so adding
  // one is a change in a single place.
  const TAGLINES = Object.values(en.nav.taglines);

  it('carries one of its lines underneath, inside the link home', async () => {
    session.ready = true;
    session.user = { id: 1, displayName: 'Ann' };
    await router.replace('/');
    w = mount(App, { global: { plugins: [router] } });
    const brand = w.find('a.brand');
    expect(brand.attributes('href')).toBe('/');
    expect(brand.find('.brand-name').text()).toBe('Game Gang');
    expect(TAGLINES).toContain(brand.find('.tagline').text());
    expect(TAGLINES).toHaveLength(3);
  });

  it('picks a line at random, and picks again for every page opened', async () => {
    session.ready = true;
    session.user = { id: 1, displayName: 'Ann' };
    // Chance is taken out of it: each page opened takes the next number, and so the next line along.
    const rolls = [0, 0.5, 0.9, 0];
    let roll = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => rolls[roll++ % rolls.length]);
    onTestFinished(() => vi.restoreAllMocks()); // chance is given back, however this test ends

    await router.replace('/');
    w = mount(App, { global: { plugins: [router] } });
    const shown = () => w.find('.tagline').text();
    expect(shown()).toBe(TAGLINES[0]);
    for (const [path, wanted] of [['/stats', TAGLINES[1]], ['/profile', TAGLINES[2]], ['/', TAGLINES[0]]]) {
      await router.push(path);
      await nextTick();
      expect(shown(), `after going to ${path}`).toBe(wanted);
    }
  });
});

describe('the account menu', () => {
  it('shows your name in your own style and animation', async () => {
    session.ready = true;
    session.user = { id: 1, displayName: 'Ann', nameStyle: { style: 'ruby', animation: 'glow' } };
    await router.replace('/');
    w = mount(App, { global: { plugins: [router] } });
    const name = w.find('button.styled-name');
    expect(name.text()).toBe('Ann ▾');
    expect(name.attributes('data-name-style')).toBe('ruby');
    expect(name.attributes('data-animation')).toBe('glow');
  });
  it('shows your avatar, centred at the top of the menu when it is open', async () => {
    session.ready = true;
    session.user = { id: 1, displayName: 'Ann', avatar: { hair: 'curly' } };
    await router.replace('/');
    w = mount(App, { global: { plugins: [router] } });
    expect(w.find('.dropdown').exists()).toBe(false);
    await w.find('button.styled-name').trigger('click');
    const menu = w.find('.dropdown');
    expect(menu.element.firstElementChild.classList.contains('my-avatar')).toBe(true);
    expect(menu.find('.my-avatar').element.tagName.toLowerCase()).toBe('svg');
  });
});

describe('signing out', () => {
  it('forgets the cached profiles of other players', async () => {
    const { clearProfiles } = await import('./profiles.js');
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    session.user = { id: 1, displayName: 'Ann' };
    await router.replace('/');
    w = mount(App, { global: { plugins: [router] } });
    await w.find('.account button').trigger('click'); // open the account menu
    await button(w, 'Sign out').trigger('click');
    await flushPromises();
    expect(clearProfiles).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
