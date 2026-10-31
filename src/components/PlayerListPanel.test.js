import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayerListPanel from './PlayerListPanel.vue';

const players = [
  { id: 1, name: 'Ann', online: true },
  { id: 2, name: 'Bob', online: false },
  { id: 'b1', name: 'Robo', bot: true, online: true },
];
const make = (props = {}, slots = {}) => mount(PlayerListPanel, { props: { players, you: 1, hostId: 1, isHost: true, min: 4, max: 6, ...props }, slots });
const button = (w, text) => w.findAll('button').find((b) => b.text().includes(text));

describe('PlayerListPanel', () => {
  it('lists the players with their tags and the count', () => {
    const w = make();
    expect(w.find('h3').text()).toBe('Players (3 of 6)');
    const rows = w.findAll('li');
    expect(rows[0].text()).toContain('(you)');
    expect(rows[0].text()).toContain('host');
    expect(rows[1].text()).toContain('away');
    expect(rows[2].text()).toContain('computer');
  });

  it('gives the host Remove for others and bots, but not themselves', async () => {
    const w = make();
    const rows = w.findAll('li');
    expect(rows[0].find('button').exists()).toBe(false);
    await rows[1].find('button').trigger('click');
    await rows[2].find('button').trigger('click');
    expect(w.emitted().kick).toEqual([[2]]);
    expect(w.emitted().removeBot).toEqual([['b1']]);
  });

  it('offers add and fill to the host only, and says when full', async () => {
    const w = make();
    await button(w, 'Add a computer player').trigger('click');
    await button(w, 'Fill up to 4').trigger('click');
    expect(w.emitted().addBot).toHaveLength(1);
    expect(w.emitted().fillBots).toEqual([[4]]);
    expect(make({ isHost: false }).findAll('button')).toHaveLength(0);
    const full = make({ min: 2, max: 3 });
    expect(button(full, 'Add a computer player').attributes('disabled')).toBeDefined();
    expect(button(full, 'Fill up')).toBeUndefined();
    expect(full.text()).toContain('The table is full (3 players).');
  });

  it('renders the lead slot for each player and the default slot after the list', () => {
    const w = make({}, { lead: '<i class="lead">{{ params.player.id }}</i>', default: '<p class="extra">more</p>' });
    expect(w.findAll('.lead').map((e) => e.text())).toEqual(['1', '2', 'b1']);
    expect(w.find('.extra').exists()).toBe(true);
  });
});
