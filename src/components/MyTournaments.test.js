// The list of the tournaments you are in, which is how somebody comes back to one days after the last round.
//
// What is asserted here is what the player is shown and where each row would take them — not the shape of the reply,
// which shared/tournamentRoom.js owns.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { flushPromises } from '@vue/test-utils';
import MyTournaments from './MyTournaments.vue';
import { api } from '../api.js';
import { session } from '../session.js';

// Only the fetch is stood in for; session.js registers its own handler with the rest of api.js at import time.
vi.mock('../api.js', async (importOriginal) => ({ ...(await importOriginal()), api: vi.fn() }));

/** One row as the site sends it, with whatever this test is about changed. */
const row = (extra = {}) => ({
  game: 'hearts',
  name: 'Hearts',
  code: 'boss-aware-you',
  over: false,
  round: 2,
  rounds: 3,
  people: 4,
  waiting: true,
  youReady: false,
  readyNow: 2,
  readyOf: 4,
  yourTable: null,
  updatedAt: 10,
  ...extra,
});

/** Mounts the list with these rows already answered for. */
async function listOf(rows) {
  api.mockResolvedValue({ tournaments: rows });
  const w = mount(MyTournaments, { global: { stubs: { RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } } } });
  await flushPromises();
  return w;
}

describe('the list of your tournaments', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    session.games = [{ id: 'hearts', name: 'Hearts', category: 'cards', minPlayers: 3, maxPlayers: 7 }];
  });

  it('says nothing at all when you are in none', async () => {
    const w = await listOf([]);
    expect(w.text()).toBe('');
  });

  it('names the game and the round, and links to the tournament', async () => {
    const w = await listOf([row()]);
    expect(w.text()).toContain('Hearts');
    expect(w.text()).toContain('Round 2 of 3');
    expect(w.find('a').attributes('href')).toBe('/play/hearts?boss-aware-you');
  });

  it('says which one is waiting on you, and marks it out from the rest', async () => {
    const w = await listOf([row(), row({ code: 'other-code-here', youReady: true, readyNow: 3 })]);
    const entries = w.findAll('.entry');
    expect(entries[0].text()).toContain('waiting for you to be ready');
    expect(entries[0].classes()).toContain('urgent');
    expect(entries[1].text()).toContain('3 of 4 ready');
    expect(entries[1].classes()).not.toContain('urgent');
  });

  it('takes you straight to your game when one of yours is open', async () => {
    const w = await listOf([row({ waiting: false, yourTable: 'this-game-here' })]);
    expect(w.text()).toContain('your game is open');
    expect(w.find('a').attributes('href')).toBe('/play/hearts?this-game-here');
  });

  it('leaves out a tournament that has been played to the end', async () => {
    const w = await listOf([row({ over: true })]);
    expect(w.text()).toBe('');
  });

  it('shows the rest of the page when the list cannot be fetched', async () => {
    api.mockRejectedValue(new Error('offline'));
    const w = mount(MyTournaments);
    await flushPromises();
    expect(w.text()).toBe('');
  });
});
