import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const handlers = {};
const fakeSocket = { on: vi.fn((event, fn) => (handlers[event] = fn)), close: vi.fn() };
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }));

const { session } = await import('../session.js');
const { feed, stopFeed } = await import('../achievementFeed.js');
const { default: AchievementPopups } = await import('./AchievementPopups.vue');

const unlock = (id, level, name = 'Played cards', text = 'Play 100 cards') => ({ id, level, levels: 5, game: 'Global', name, text, coins: 1000 });
const popup = () => document.body.querySelector('.achievement');

let wrapper;
let fetchMock;
let pending;
beforeEach(() => {
  vi.useFakeTimers();
  for (const key of Object.keys(handlers)) delete handlers[key];
  feed.queue.splice(0);
  pending = [];
  fetchMock = vi.fn(async (url, options) => {
    const body = url === '/api/achievements/pending' ? { unlocks: pending } : { ok: true };
    return { ok: true, status: 200, text: async () => JSON.stringify(body), options };
  });
  vi.stubGlobal('fetch', fetchMock);
  session.user = { id: 1, displayName: 'Ann' };
  wrapper = mount(AchievementPopups, { attachTo: document.body });
});
afterEach(() => {
  wrapper.unmount();
  stopFeed();
  session.user = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const arrive = async (unlocks, event = 'achievements') => {
  pending = unlocks;
  handlers[event]();
  await vi.advanceTimersByTimeAsync(0);
  await flushPromises();
};
const seenPosts = () => fetchMock.mock.calls.filter(([url]) => url === '/api/achievements/seen').map(([, init]) => JSON.parse(init.body));

describe('AchievementPopups', () => {
  it('shows nothing until something is unlocked, and asks what is waiting as soon as it connects', async () => {
    expect(popup()).toBeNull();
    await arrive([unlock('global.cards', 1)], 'connect');
    expect(popup()).not.toBeNull();
  });

  it('shows the achievement, its level, what it asked for and the coins', async () => {
    await arrive([unlock('global.cards', 2, 'Played cards', 'Play 500 cards')]);
    const text = popup().textContent;
    expect(text).toContain('Achievement unlocked: Played cards');
    expect(text).toContain('level 2: Play 500 cards');
    expect(text).toContain('+1,000 coins');
    expect(popup().getAttribute('role')).toBe('status');
  });

  it('leaves the level out for an achievement that has only one', async () => {
    await arrive([{ ...unlock('hearts.perfect', 1, 'Perfect game', 'Finish a game with no points'), levels: 1, game: 'Hearts' }]);
    expect(popup().textContent).toContain('Hearts: Finish a game with no points');
    expect(popup().textContent).not.toContain('level 1');
  });

  it('stays until OK is clicked, however long that takes, and then tells the server it was shown', async () => {
    await arrive([unlock('global.cards', 1)]);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(popup()).not.toBeNull();
    expect(seenPosts()).toEqual([]);
    popup().querySelector('button').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(popup()).toBeNull();
    expect(seenPosts()).toEqual([{ items: [{ id: 'global.cards', level: 1 }] }]);
    expect(feed.queue).toHaveLength(0);
  });

  it('closes at once with OK', async () => {
    await arrive([unlock('global.cards', 1)]);
    popup().querySelector('button').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(popup()).toBeNull();
    expect(seenPosts()).toHaveLength(1);
  });

  it('shows two or three one after another, not together', async () => {
    await arrive([unlock('global.cards', 1), unlock('hearts.moon', 1, 'Shot the moon', 'Shoot the moon')]);
    expect(popup().textContent).toContain('Played cards');
    popup().querySelector('button').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(popup().textContent).toContain('Shot the moon');
    expect(document.body.querySelectorAll('.achievement')).toHaveLength(1);
  });

  it('shows many that arrive together as one pop-up with the total', async () => {
    await arrive([1, 2, 3, 4, 5].map((n) => unlock('global.cards', n)));
    expect(popup().textContent).toContain('5 achievements unlocked!');
    expect(popup().textContent).toContain('+5,000 coins');
    popup().querySelector('button').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(seenPosts()[0].items).toHaveLength(5);
    expect(popup()).toBeNull();
  });

  it('does not queue the same unlock twice, and stops and forgets when the person signs out', async () => {
    await arrive([unlock('global.cards', 1)]);
    await arrive([unlock('global.cards', 1)]);
    expect(feed.queue).toHaveLength(1);
    session.user = null;
    await flushPromises();
    expect(popup()).toBeNull();
    expect(feed.queue).toHaveLength(0);
    expect(fakeSocket.close).toHaveBeenCalled();
  });
});
