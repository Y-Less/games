// The tour's screens: the lobby, the vote, the game in hand, and the end.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

const nothing = { template: '<i />' };
let wrapper;
afterEach(() => wrapper?.unmount());

/** A view like the server's, with whatever this test cares about on top. */
const view = (extra = {}) => ({
  phase: 'voting',
  code: 'boss-aware-you',
  you: 1,
  hostId: 1,
  isHost: true,
  size: 4,
  min: 2,
  max: 12,
  fillTo: 4,
  suitable: 6,
  players: [
    { slot: 's0', id: 1, userId: 1, name: 'Ann', bot: false, online: true, voted: false },
    { slot: 's1', id: 2, userId: 2, name: 'Bob', bot: false, online: true, voted: false },
    { slot: 's2', id: 'bot:1', userId: null, name: 'Ada', bot: true, online: true, voted: true },
  ],
  choices: [
    { id: 'hearts', name: 'Hearts', votes: 0 },
    { id: 'gtk', name: 'GTK', votes: 2 },
    { id: 'draw', name: 'Draw', votes: 0 },
  ],
  endVotes: 0,
  yourVote: null,
  until: 0,
  current: null,
  played: [],
  trouble: null,
  ...extra,
});

/** Mounts a screen with a router, since the table links to the game being played. */
async function show(component, state, send = vi.fn(() => Promise.resolve({ ok: true }))) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: nothing }] });
  router.push('/'); // memory history starts nowhere, and isReady() waits for a first navigation
  await router.isReady();
  wrapper = mount(component, { props: { state, send }, global: { plugins: [router] } });
  return { wrapper, send };
}

describe('the lobby', () => {
  it('says how many games suit this many people, and lets the host start', async () => {
    const { wrapper: w, send } = await show(Lobby, view({ phase: 'lobby' }));
    expect(w.text()).toContain('Three of the 6 games that suit this many');
    const start = w.findAll('button').find((b) => b.text() === 'Start the tour');
    expect(start.attributes('disabled')).toBeUndefined();
    await start.trigger('click');
    expect(send).toHaveBeenCalledWith('start');
  });

  it('will not let anybody start a tour with nothing to play', async () => {
    const { wrapper: w } = await show(Lobby, view({ phase: 'lobby', suitable: 0 }));
    expect(w.text()).toContain('No game here suits 3 players');
    expect(w.findAll('button').find((b) => b.text() === 'Start the tour').attributes('disabled')).toBeDefined();
  });

  it('shows somebody who is not the host that they are waiting', async () => {
    const { wrapper: w } = await show(Lobby, view({ phase: 'lobby', isHost: false, you: 2 }));
    expect(w.text()).toContain('Waiting for the host');
    expect(w.findAll('button').some((b) => b.text() === 'Start the tour')).toBe(false);
  });
});

describe('the vote', () => {
  it('offers every choice with its votes, and ending as well', async () => {
    const { wrapper: w, send } = await show(Table, view());
    const choices = w.findAll('.choice').map((b) => b.text().replace(/\s+/g, ''));
    expect(choices).toEqual(['Hearts0votes', 'GTK2votes', 'Draw0votes', 'Endthetour0votes']);
    await w.findAll('.choice')[1].trigger('click');
    expect(send).toHaveBeenCalledWith('vote', { choice: 'gtk' });
  });

  it('votes to end with the standing fourth choice', async () => {
    const { wrapper: w, send } = await show(Table, view());
    await w.find('.choice.end').trigger('click');
    expect(send).toHaveBeenCalledWith('vote', { choice: 'end' });
  });

  it('marks the one you picked', async () => {
    const { wrapper: w } = await show(Table, view({ yourVote: 'gtk' }));
    expect(w.findAll('.choice')[1].classes()).toContain('mine');
    expect(w.findAll('.choice')[1].attributes('aria-pressed')).toBe('true');
    expect(w.findAll('.choice')[0].attributes('aria-pressed')).toBe('false');
  });

  it('names the people it is still waiting for, and never the computer players', async () => {
    const { wrapper: w } = await show(Table, view());
    expect(w.text()).toContain('Waiting for Ann and Bob to vote.');
    expect(w.text()).not.toContain('Ada');
  });

  it('says so when a game would not open', async () => {
    const { wrapper: w } = await show(Table, view({ trouble: 'gameFull' }));
    expect(w.text()).toContain('would not open');
  });
});

describe('while a game is being played', () => {
  it('names it and links to it, and lists what has been played', async () => {
    const state = view({ phase: 'playing', current: { game: 'hearts', code: 'x-y-z', name: 'Hearts' }, played: [{ game: 'hearts', code: 'x-y-z', name: 'Hearts' }] });
    const { wrapper: w } = await show(Table, state);
    expect(w.text()).toContain('Playing Hearts');
    expect(w.find('a').attributes('href')).toBe('/play/hearts?x-y-z');
    expect(w.text()).toContain('Played so far');
  });

  it('says something while the chosen game is being opened', async () => {
    const { wrapper: w } = await show(Table, view({ phase: 'opening' }));
    expect(w.text()).toContain('Opening the game');
  });
});

describe('the end', () => {
  it('counts what was played and offers another tour to the host', async () => {
    const played = [{ game: 'hearts', code: 'a', name: 'Hearts' }, { game: 'gtk', code: 'b', name: 'GTK' }];
    const { wrapper: w, send } = await show(Table, view({ phase: 'finished', played }));
    expect(w.text()).toContain('You played 2 games.');
    expect(w.text()).toContain('Hearts');
    await w.findAll('button').find((b) => b.text() === 'Start another tour').trigger('click');
    expect(send).toHaveBeenCalledWith('again');
  });

  it('is honest about a tour that played nothing, and offers nothing to anybody else', async () => {
    const { wrapper: w } = await show(Table, view({ phase: 'finished', isHost: false }));
    expect(w.text()).toContain('ended before anything was played');
    expect(w.findAll('button').some((b) => b.text() === 'Start another tour')).toBe(false);
  });
});
