// The list of the games you have on the go, which is how somebody picks one up again days after setting it down.
//
// What is asserted here is what the player is shown and where each row would take them — not the shape of the reply,
// which shared/roomServer.js owns.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { flushPromises } from '@vue/test-utils';
import MyGames from './MyGames.vue';
import { api } from '../api.js';
import { session } from '../session.js';

// Only the fetch is stood in for; session.js registers its own handler with the rest of api.js at import time.
vi.mock('../api.js', async (importOriginal) => ({ ...(await importOriginal()), api: vi.fn() }));

/** One tournament as the site sends it, with whatever this test is about changed. */
const tournament = (extra = {}) => ({
  kind: 'tournament',
  game: 'hearts',
  name: 'Hearts',
  code: 'boss-aware-you',
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

/** One ordinary game as the site sends it. */
const game = (extra = {}) => ({
  kind: 'game',
  game: 'hearts',
  name: 'Hearts',
  code: 'four-five-six',
  others: ['Bob', 'Hazel'],
  updatedAt: 20,
  ...extra,
});

/** Mounts the list with these rows already answered for. */
async function listOf(rows) {
  api.mockResolvedValue({ games: rows });
  const w = mount(MyGames, { global: { stubs: { RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } } } });
  await flushPromises();
  return w;
}

describe('the list of your games', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    session.games = [{ id: 'hearts', name: 'Hearts', category: 'cards', minPlayers: 3, maxPlayers: 7 }];
  });

  it('says you have none when you have none, rather than showing an empty page', async () => {
    const w = await listOf([]);
    expect(w.text()).toContain('You have no games on the go.');
    expect(w.findAll('.entry')).toHaveLength(0);
  });

  it('names a game and who else is at it, and leads back into it', async () => {
    // Two games of Hearts are told apart by the people playing them and by nothing else, so the names are the row.
    const w = await listOf([game()]);
    expect(w.text()).toContain('Hearts');
    expect(w.text()).toContain('with Bob, Hazel');
    expect(w.text()).toContain('being played');
    expect(w.find('a').attributes('href')).toBe('/play/hearts?four-five-six');
    expect(w.find('a').text()).toBe('Carry on');
  });

  it('says nothing of company it has not got', async () => {
    const w = await listOf([game({ others: [] })]);
    expect(w.text()).toContain('being played');
    expect(w.text()).not.toContain('with');
  });

  it('names the game and the round of a tournament, and links to the tournament', async () => {
    const w = await listOf([tournament()]);
    expect(w.text()).toContain('Round 2 of 3');
    expect(w.find('a').attributes('href')).toBe('/play/hearts?boss-aware-you');
  });

  it('says which tournament is waiting on you, and marks it out from the rest', async () => {
    const w = await listOf([tournament(), tournament({ code: 'other-code-here', youReady: true, readyNow: 3 }), game()]);
    const entries = w.findAll('.entry');
    expect(entries[0].text()).toContain('waiting for you to be ready');
    expect(entries[0].classes()).toContain('urgent');
    expect(entries[1].text()).toContain('3 of 4 ready');
    expect(entries[1].classes()).not.toContain('urgent');
    expect(entries[2].classes()).not.toContain('urgent', 'an ordinary game is not asking for anything');
  });

  it('takes you straight to your table when a tournament has one open for you', async () => {
    const w = await listOf([tournament({ waiting: false, yourTable: 'this-game-here' })]);
    expect(w.text()).toContain('your game is open');
    expect(w.find('a').attributes('href')).toBe('/play/hearts?this-game-here');
  });

  it('keeps the order it was sent in, which is the newest news first', async () => {
    const w = await listOf([game(), tournament()]);
    expect(w.findAll('.entry').map((entry) => entry.find('a').attributes('href'))).toEqual(['/play/hearts?four-five-six', '/play/hearts?boss-aware-you']);
  });

  it('says it could not ask rather than saying you have none', async () => {
    // The two read the same to a glance and mean opposite things: one sends you to start a game, the other to wait.
    api.mockRejectedValue(new Error('offline'));
    const w = mount(MyGames);
    await flushPromises();
    expect(w.text()).toContain('could not be fetched');
    expect(w.text()).not.toContain('You have no games on the go.');
  });
});
