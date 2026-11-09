import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayerListPanel from './PlayerListPanel.vue';

const players = [
  { id: 1, slot: 's0', name: 'Ann', online: true },
  { id: 2, slot: 's1', name: 'Bob', online: false },
  { id: 'b1', slot: 's2', name: 'Robo', bot: true, online: true },
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
    // Removal names a place by its slot, whatever kind of game it is (shared/layout.js).
    expect(w.emitted().kick).toEqual([['s1']]);
    expect(w.emitted().removeBot).toEqual([['s2']]);
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

  it('fills to a normal table of four, and never past the game or the host', async () => {
    // Not "as many as will fit": a game for twelve filling to twelve would be a surprise.
    const roomy = make({ players: players.slice(0, 1), min: 2, max: 12 });
    await button(roomy, 'Fill up to 4 players').trigger('click');
    expect(roomy.emitted().fillBots).toEqual([[4]]);
    // A game that wants more than four still asks for what it wants.
    const five = make({ players: players.slice(0, 1), min: 5, max: 8 });
    expect(button(five, 'Fill up to 5 players')).toBeDefined();
    // One that cannot hold four is not offered four.
    const pair = make({ players: players.slice(0, 1), min: 2, max: 2 });
    await button(pair, 'Fill up to 2 players').trigger('click');
    expect(pair.emitted().fillBots).toEqual([[2]]);
    // And a host who has capped the room is not offered more than the cap.
    const capped = make({ players: players.slice(0, 1), min: 2, max: 12, size: 3 });
    await button(capped, 'Fill up to 3 players').trigger('click');
    expect(capped.emitted().fillBots).toEqual([[3]]);
  });

  it('lets the host say how many the room will hold, between those here and what the game allows', async () => {
    const w = make({ players, min: 2, max: 8, size: 5 });
    expect(w.text()).toContain('Players (3 of 5)');
    await w.findAll('button').find((b) => b.attributes('aria-label') === 'Room for more players').trigger('click');
    expect(w.emitted().size).toEqual([[6]]);
    await w.findAll('button').find((b) => b.attributes('aria-label') === 'Room for fewer players').trigger('click');
    expect(w.emitted().size).toEqual([[6], [4]]);
    const tight = make({ players, min: 2, max: 8, size: 3 });
    expect(tight.findAll('button').find((b) => b.attributes('aria-label') === 'Room for fewer players').attributes('disabled')).toBeDefined();
  });

  it('renders the lead slot for each player and the default slot after the list', () => {
    const w = make({}, { lead: '<i class="lead">{{ params.player.id }}</i>', default: '<p class="extra">more</p>' });
    expect(w.findAll('.lead').map((e) => e.text())).toEqual(['1', '2', 'b1']);
    expect(w.find('.extra').exists()).toBe(true);
  });
});
