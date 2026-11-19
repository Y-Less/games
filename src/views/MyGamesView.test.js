import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { api } from '../api.js';
import { session } from '../session.js';
import MyGamesView from './MyGamesView.vue';

// Only the fetch is stood in for; session.js registers its own handler with the rest of api.js at import time.
vi.mock('../api.js', async (importOriginal) => ({ ...(await importOriginal()), api: vi.fn() }));

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] });

/** The page, with the server answering these rows. */
async function pageOf(rows) {
  vi.mocked(api).mockResolvedValue({ games: rows });
  const w = mount(MyGamesView, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  vi.mocked(api).mockReset();
  session.games = [{ id: 'hearts', name: 'Hearts', category: 'cards', minPlayers: 3, maxPlayers: 7 }];
});

describe('the Your games page', () => {
  it('is titled for the menu item that leads to it', async () => {
    expect((await pageOf([])).find('h1').text()).toBe('Your games');
  });

  it('lists a game being played, with the way back into it', async () => {
    const w = await pageOf([{ kind: 'game', game: 'hearts', name: 'Hearts', code: 'four-five-six', others: ['Bob'], updatedAt: 20 }]);
    expect(w.text()).toContain('Hearts');
    expect(w.text()).toContain('with Bob');
    expect(w.find('.entry a').attributes('href')).toBe('/play/hearts?four-five-six');
  });

  it('says so plainly when there is nothing on the go, rather than leaving the page blank under its title', async () => {
    const w = await pageOf([]);
    expect(w.text()).toContain('You have no games on the go.');
  });
});
