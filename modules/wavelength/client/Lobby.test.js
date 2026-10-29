// The Wavelength lobby with computer players, and the pop-up's removal of one.
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Lobby from './Lobby.vue';

const person = (id, name, extra = {}) => ({ id, name, colour: `#00000${id}`, online: true, bot: false, ai: null, ...extra });
const bot = (id, name) => ({ id, name, colour: '#aa0000', online: true, bot: true, ai: null });

function make({ players, you = 1, hostId = 1, max = 8 }) {
  const send = vi.fn();
  const state = { code: 'a-b-c', phase: 'lobby', you, hostId, turnsEach: 2, players, colours: ['#000001', '#aa0000'], limits: { min: 2, max, turns: { min: 1, max: 5 } } };
  return { wrapper: mount(Lobby, { props: { state, send } }), send };
}
const button = (w, text) => w.findAll('button').find((b) => b.text().includes(text));

describe('Wavelength lobby computer players', () => {
  it('marks computer players and lets the host add, fill and remove them', async () => {
    const { wrapper, send } = make({ players: [person(1, 'Ann'), bot('bot:1', 'Ada')] });
    expect(wrapper.findAll('.players li')[1].text()).toContain('computer');
    expect(wrapper.findAll('.players li')[1].find('.bot-icon').exists()).toBe(true);
    await button(wrapper, 'Add a computer player').trigger('click');
    expect(send).toHaveBeenLastCalledWith('addBot');
    await wrapper.findAll('.players li')[1].find('button.quiet').trigger('click');
    expect(send).toHaveBeenLastCalledWith('removeBot', { seat: 'bot:1' });
    expect(button(wrapper, 'Fill up to'), 'enough players already').toBeUndefined();
  });

  it('offers to fill up to the minimum while there are too few players', async () => {
    const { wrapper, send } = make({ players: [person(1, 'Ann')] });
    await button(wrapper, 'Fill up to 2 players').trigger('click');
    expect(send).toHaveBeenLastCalledWith('fillBots', { count: 2 });
  });

  it('removes a person with kick, and stops offering computers at a full table', async () => {
    const { wrapper, send } = make({ players: [person(1, 'Ann'), person(2, 'Bob'), bot('bot:1', 'Ada')], max: 3 });
    await wrapper.findAll('.players li')[1].find('button.quiet').trigger('click');
    expect(send).toHaveBeenLastCalledWith('kick', { userId: 2 });
    expect(button(wrapper, 'Add a computer player').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('The table is full (3 players)');
  });

  it('shows nobody but the host any computer-player controls', () => {
    const { wrapper } = make({ players: [person(1, 'Ann'), person(2, 'Bob'), bot('bot:1', 'Ada')], you: 2 });
    expect(button(wrapper, 'Add a computer player')).toBeUndefined();
    expect(button(wrapper, 'Remove')).toBeUndefined();
  });
});
