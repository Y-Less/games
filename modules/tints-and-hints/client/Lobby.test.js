// The Tints and Hints lobby with computer players, and the pop-up's removal of one.
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

describe('Tints and Hints lobby computer players', () => {
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

describe('lobby marker colours', () => {
  it('offers any colour only to a player who has unlocked it, and shows a custom colour as chosen', async () => {
    const people = [person(1, 'Ann'), person(2, 'Bob')];
    const plain = make({ players: people });
    expect(plain.wrapper.find('input[aria-label="Choose any marker colour"]').exists()).toBe(false);
    expect(plain.wrapper.text()).toContain('Unlock any colour in the shop');

    const send = vi.fn();
    const state = { code: 'a-b-c', phase: 'lobby', you: 1, hostId: 1, turnsEach: 2, players: [{ ...people[0], colour: '#123456' }, people[1]], colours: ['#000001', '#aa0000'], canCustomColour: true, limits: { min: 2, max: 8, turns: { min: 1, max: 5 } } };
    const wrapper = mount(Lobby, { props: { state, send } });
    expect(wrapper.find('[title="Your own colour"]').exists()).toBe(true);
    const picker = wrapper.find('input[aria-label="Choose any marker colour"]');
    expect(picker.element.value).toBe('#123456');
    await picker.setValue('#abcdef');
    expect(send).toHaveBeenLastCalledWith('colour', { colour: '#abcdef' });
  });
});
