import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, reactive } from 'vue';
import LobbyView from './components/LobbyView.vue';
import { DIXNT_KEY } from './useDixnt.js';

const person = (id, name, extra = {}) => ({ id, name, bot: false, ai: null, connected: true, ...extra });
const bot = (id, name) => ({ id, name, bot: true, ai: null, connected: true });

function make({ players, me = 'ann', host = 'ann', maxPlayers = 12 }) {
  const state = {
    code: 'boss-aware-you',
    phase: 'lobby',
    minPlayers: 3,
    maxPlayers,
    hostId: host,
    me: { id: me },
    players,
    judging: 'everyone',
    categories: [{ key: 'all', label: 'All', description: '', count: 400, selected: true }],
    availableCards: 400,
    handSize: 8,
    roundsEach: 2,
    pointsPerVote: 100,
    pointsChooserCorrect: 100,
    pointsFooledChooser: 500,
    pointsFavourite: 200,
  };
  const store = reactive({ state });
  const send = vi.fn();
  const api = { store, send, players: computed(() => state.players), isHost: computed(() => state.hostId === state.me.id) };
  const wrapper = mount(LobbyView, { global: { provide: { [DIXNT_KEY]: api } } });
  return { wrapper, send };
}
const button = (w, text) => w.findAll('button').find((b) => b.text().includes(text));
const seats = (w) => w.findAll('ul.seats li.seat');

describe('Dixnt lobby computer players', () => {
  it('lists people and computer players with their tags', () => {
    const { wrapper } = make({ players: [person('ann', 'Ann'), person('bob', 'Bob', { connected: false }), bot('b1', 'Ada')] });
    const rows = seats(wrapper);
    expect(rows).toHaveLength(3);
    expect(rows[0].findAll('.tag').map((t) => t.text())).toEqual(['you', 'host']);
    expect(rows[1].findAll('.tag').map((t) => t.text())).toEqual(['away']);
    expect(rows[2].findAll('.tag').map((t) => t.text())).toEqual(['computer']);
  });

  it('lets the host add a computer player, fill up to the minimum and remove bots and people', async () => {
    const { wrapper, send } = make({ players: [person('ann', 'Ann'), person('bob', 'Bob'), bot('b1', 'Ada')] });
    await button(wrapper, 'Add a computer player').trigger('click');
    expect(send).toHaveBeenLastCalledWith('addBot');
    const rows = seats(wrapper);
    expect(rows[0].find('button').exists()).toBe(false); // not oneself
    await rows[1].find('button').trigger('click');
    expect(send).toHaveBeenLastCalledWith('removePlayer', { targetId: 'bob' });
    await rows[2].find('button').trigger('click');
    expect(send).toHaveBeenLastCalledWith('removeBot', { targetId: 'b1' });
    expect(button(wrapper, 'Fill up to'), 'enough players already').toBeUndefined();
  });

  it('offers to fill up to the minimum only while there are too few players', async () => {
    const { wrapper, send } = make({ players: [person('ann', 'Ann')] });
    await button(wrapper, 'Fill up to 3 players').trigger('click');
    expect(send).toHaveBeenLastCalledWith('fillBots', { count: 3 });
    expect(button(wrapper, 'Need 2 more players')).toBeDefined();
  });

  it('stops offering bots at a full table', () => {
    const players = [person('ann', 'Ann'), ...Array.from({ length: 11 }, (_, i) => bot(`b${i}`, `Bot ${i}`))];
    const { wrapper } = make({ players });
    expect(button(wrapper, 'Add a computer player').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('The table is full (12 players)');
  });

  it('shows nobody but the host any bot controls', () => {
    const { wrapper } = make({ players: [person('ann', 'Ann'), person('bob', 'Bob'), bot('b1', 'Ada')], me: 'bob' });
    expect(button(wrapper, 'Add a computer player')).toBeUndefined();
    expect(button(wrapper, 'Remove')).toBeUndefined();
    expect(wrapper.text()).toContain('Waiting for the host to start');
  });
});
