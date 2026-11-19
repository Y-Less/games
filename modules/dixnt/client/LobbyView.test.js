import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, reactive } from 'vue';
import LobbyView from './components/LobbyView.vue';
import { DIXNT_KEY } from './useDixnt.js';

const person = (id, name, extra = {}) => ({ id, slot: `s-${id}`, name, bot: false, ai: null, online: true, ...extra });
const bot = (id, name) => ({ id, slot: `s-${id}`, name, bot: true, ai: null, online: true });

function make({ players, me = 'ann', host = 'ann', maxPlayers = 12, settings = {} }) {
  const state = {
    code: 'boss-aware-you',
    phase: 'lobby',
    minPlayers: 3,
    maxPlayers,
    hostId: host,
    you: me,
    players,
    judging: 'everyone',
    noChooser: false,
    categories: [{ key: 'all', label: 'All', description: '', count: 400, selected: true }],
    availableCards: 400,
    handSize: 8,
    rounds: 2,
    pointsPerVote: 1,
    pointsChooserCorrect: 1,
    pointsFooledChooser: 5,
    pointsFavourite: 2,
    ...settings,
  };
  const store = reactive({ state });
  const send = vi.fn();
  const api = { store, send, players: computed(() => state.players), isHost: computed(() => state.hostId === state.you) };
  const wrapper = mount(LobbyView, { global: { provide: { [DIXNT_KEY]: api } } });
  return { wrapper, send };
}
const button = (w, text) => w.findAll('button').find((b) => b.text().includes(text));
// The shared players panel (src/components/PlayerListPanel.vue) draws one row per player.
const seats = (w) => w.findAll('ul.players li.row');

describe('Dixnt lobby computer players', () => {
  it('lists people and computer players with their tags', () => {
    const { wrapper } = make({ players: [person('ann', 'Ann'), person('bob', 'Bob', { online: false }), bot('b1', 'Ada')] });
    const rows = seats(wrapper);
    expect(rows).toHaveLength(3);
    expect(rows[0].text()).toContain('(you)');
    expect(rows[0].text()).toContain('host');
    expect(rows[1].text()).toContain('away');
    expect(rows[2].text()).toContain('computer');
  });

  it('lets the host add a computer player, fill up to the minimum and remove bots and people', async () => {
    const { wrapper, send } = make({ players: [person('ann', 'Ann'), person('bob', 'Bob'), bot('b1', 'Ada')] });
    await button(wrapper, 'Add a computer player').trigger('click');
    expect(send).toHaveBeenLastCalledWith('addBot');
    const rows = seats(wrapper);
    expect(rows[0].find('button').exists()).toBe(false); // not oneself
    await rows[1].find('button').trigger('click');
    expect(send).toHaveBeenLastCalledWith('kick', { slot: 's-bob' });
    await rows[2].find('button').trigger('click');
    expect(send).toHaveBeenLastCalledWith('removeBot', { slot: 's-b1' });
    expect(button(wrapper, 'Fill up to 4'), 'two left, so a table of four is still offered').toBeDefined();
  });

  it('offers to fill up to a normal table while there are fewer than that', async () => {
    const { wrapper, send } = make({ players: [person('ann', 'Ann')] });
    await button(wrapper, 'Fill up to 4').trigger('click');
    expect(send).toHaveBeenLastCalledWith('fillBots', { count: 4 });
    expect(button(wrapper, 'Need 2 more players')).toBeDefined();
  });

  it('stops offering bots at a full table', () => {
    const players = [person('ann', 'Ann'), ...Array.from({ length: 11 }, (_, i) => bot(`b${i}`, `Bot ${i}`))];
    const { wrapper } = make({ players });
    expect(button(wrapper, 'Add a computer player').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('The table is full (12 seats)');
  });

  it('sends the whole settings message when the host changes one', async () => {
    const { wrapper, send } = make({ players: [person('ann', 'Ann'), person('bob', 'Bob'), bot('b1', 'Ada')] });
    const styles = wrapper.findAll('input[name="judging"]');
    await styles[1].trigger('change');
    expect(send).toHaveBeenLastCalledWith('settings', { judging: 'chooser' });
    const numbers = wrapper.findAll('input.num');
    numbers[0].element.value = '6';
    await numbers[0].trigger('change');
    expect(send).toHaveBeenLastCalledWith('settings', { handSize: '6' });
    numbers[1].element.value = '3';
    await numbers[1].trigger('change');
    expect(send).toHaveBeenLastCalledWith('settings', { rounds: '3' });
    await wrapper.find('.category input[type="checkbox"]').trigger('change');
    expect(send).toHaveBeenLastCalledWith('settings', { categories: [] });
  });

  // "No chooser" sits beside the play style, and goes only with the styles that end in a vote, so "Favourite card"
  // is put out of reach while it is on rather than left to be refused by the server.
  it('lets the host turn the chooser off, and takes the favourite style off the table while it is', async () => {
    const { wrapper, send } = make({ players: [person('ann', 'Ann'), person('bob', 'Bob'), bot('b1', 'Ada')] });
    const noChooser = () => wrapper.find('.option input[type="checkbox"]');
    expect(wrapper.findAll('input[name="judging"]').every((r) => r.attributes('disabled') === undefined)).toBe(true);
    noChooser().element.checked = true;
    await noChooser().trigger('change');
    expect(send).toHaveBeenLastCalledWith('settings', { noChooser: true });

    const { wrapper: on } = make({ players: [person('ann', 'Ann'), person('bob', 'Bob'), bot('b1', 'Ada')], settings: { noChooser: true } });
    const styles = on.findAll('input[name="judging"]');
    expect([styles[0].attributes('disabled'), styles[1].attributes('disabled')]).toEqual([undefined, undefined]);
    expect(styles[2].attributes('disabled')).toBeDefined();
    expect(on.text()).toContain('this one needs the chooser');
    expect(on.text()).toContain('a word or phrase is picked at random');
    expect(on.text()).toContain("times each player's turn comes round");
  });

  it('shows nobody but the host any bot controls', () => {
    const { wrapper } = make({ players: [person('ann', 'Ann'), person('bob', 'Bob'), bot('b1', 'Ada')], me: 'bob' });
    expect(button(wrapper, 'Add a computer player')).toBeUndefined();
    expect(button(wrapper, 'Remove')).toBeUndefined();
    expect(wrapper.text()).toContain('Waiting for the host to start');
  });
});
