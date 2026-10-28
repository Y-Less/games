import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { session } from './session.js';
import { playBar, useLeave } from './playBar.js';

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
  playBar.game = { name: 'Nomination Whist', hasRules: false };
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
  it('leaves the game and goes back to the games homepage', async () => {
    const leave = vi.fn(() => Promise.resolve());
    await startPlaying({ leave });
    expect(router.currentRoute.value.name).toBe('play');
    await button(w, 'Leave game').trigger('click');
    await flushPromises();
    expect(leave).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.name).toBe('games');
    expect(router.currentRoute.value.path).toBe('/');
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
    expect(router.currentRoute.value.name).toBe('games');
  });
});
