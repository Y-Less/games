import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SeatLobby from './SeatLobby.vue';

const full = [
  { id: 1, name: 'Ann', kind: 'human', isHost: true, isMe: true },
  { id: 2, name: 'Bob', kind: 'human' },
  { id: 'bot1', name: 'Robo', kind: 'bot' },
];
const partly = [...full.slice(0, 2), { kind: 'empty' }];
const mostlyEmpty = [full[0], { kind: 'empty' }, { kind: 'empty' }];

// A game for two to five, whose "fill" makes up the usual four.
const make = (props = {}, slots = {}) => mount(SeatLobby, { props: { seats: full, isHost: true, min: 2, max: 5, fillTo: 4, ...props }, slots });
const button = (w, text) => w.findAll('button').find((b) => b.text().includes(text));
const start = (w) => w.find('button.primary');

describe('SeatLobby seats', () => {
  it('renders each kind with its tags', () => {
    const w = make({ seats: [...full, { kind: 'empty' }, { id: 4, name: 'Dee', kind: 'human', away: true }] });
    const seats = w.findAll('li.seat');
    expect(seats.map((s) => s.classes().filter((c) => ['human', 'bot', 'empty'].includes(c))[0])).toEqual(['human', 'human', 'bot', 'empty', 'human']);
    expect(seats[0].text()).toContain('Ann');
    expect(seats[0].findAll('.tag').map((t) => t.text())).toEqual(['you', 'host']);
    expect(seats[2].findAll('.tag').map((t) => t.text())).toEqual(['computer']);
    expect(seats[3].text()).toContain('Empty seat');
    expect(seats[4].findAll('.tag').map((t) => t.text())).toEqual(['away']);
    expect(seats[0].classes('me')).toBe(true);
    expect(seats[4].classes('away')).toBe(true);
  });

  it('shows the default and a custom title', () => {
    expect(make().find('h2').text()).toBe('Waiting for players');
    expect(make({ title: 'Table 3' }).find('h2').text()).toBe('Table 3');
  });
});

describe('SeatLobby host controls', () => {
  it('lets the host remove bots and other humans, but not themselves', async () => {
    const w = make();
    const seats = w.findAll('li.seat');
    expect(seats[0].find('button').exists()).toBe(false);
    await seats[1].find('button').trigger('click');
    await seats[2].find('button').trigger('click');
    // Removal names a place by its slot, which for a game with numbered seats is the seat number (shared/layout.js).
    expect(w.emitted('kick')).toEqual([['s1']]);
    expect(w.emitted('removeBot')).toEqual([['s2']]);
  });

  it('offers to add a computer player in each empty seat', async () => {
    const w = make({ seats: partly });
    await button(w, 'Add a computer player').trigger('click');
    expect(w.emitted('addBot')).toHaveLength(1);
  });

  it('shows no per-seat buttons to a non-host', () => {
    const w = make({ seats: [...full, { kind: 'empty' }], isHost: false });
    expect(w.findAll('li.seat button')).toHaveLength(0);
  });

  it('offers fill until a normal table is made up, and says how many that is', async () => {
    // Three at a table of three is already more than the two this fill would make up, so there is nothing to offer.
    expect(button(make({ seats: full, fillTo: 2 }), 'Fill')).toBeUndefined();
    const w = make({ seats: mostlyEmpty });
    const fill = button(w, 'Fill up to');
    expect(fill.text()).toBe('Fill up to 3 seats with computer players'); // never more than the seats there are
    await fill.trigger('click');
    expect(w.emitted('fillBots')).toEqual([[3]]);
  });

  it('hides every bot button when bots are not allowed', () => {
    const w = make({ seats: mostlyEmpty, allowBots: false });
    expect(button(w, 'computer')).toBeUndefined();
    expect(button(w, 'Fill')).toBeUndefined();
  });

  it('still lets the host remove an existing bot when bots are not allowed', () => {
    const w = make({ allowBots: false });
    expect(w.findAll('li.seat')[2].find('button').exists()).toBe(true);
  });
});

describe('SeatLobby start', () => {
  it('enables Start once enough are here, empty seats or not', async () => {
    const w = make({ seats: partly }); // two people and an empty seat, at a game for two
    expect(start(w).attributes('disabled')).toBeUndefined();
    await start(w).trigger('click');
    expect(w.emitted('start')).toHaveLength(1);
  });

  it('disables Start while there are too few, and counts how many more are needed', async () => {
    const w = make({ seats: mostlyEmpty, min: 3 });
    expect(start(w).attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('2 more seats to fill.');
    await start(w).trigger('click');
    expect(w.emitted('start')).toBeUndefined();
    expect(make({ seats: partly, min: 3 }).text()).toContain('1 more seat to fill.');
  });

  it('needs at least one human', () => {
    const w = make({ seats: [{ id: 'b1', name: 'R1', kind: 'bot' }, { id: 'b2', name: 'R2', kind: 'bot' }] });
    expect(start(w).attributes('disabled')).toBeDefined();
  });

  it('disables Start while starting', () => {
    expect(start(make({ starting: true })).attributes('disabled')).toBeDefined();
  });

  it('uses a custom start label', () => {
    expect(start(make({ startLabel: 'Deal!' })).text()).toBe('Deal!');
    expect(start(make()).text()).toBe('Start the game');
  });

  it('shows a non-host the waiting text and no Start button', () => {
    const w = make({ isHost: false, seats: partly });
    expect(w.text()).toContain('Waiting for the host to start.');
    expect(start(w).exists()).toBe(false);
    expect(w.text()).not.toContain('more seat');
  });
});

describe('SeatLobby slots', () => {
  it('renders settings and footer slots', () => {
    const w = make({}, { settings: '<div class="s">Options</div>', footer: '<span class="f">Note</span>' });
    expect(w.find('.s').text()).toBe('Options');
    expect(w.find('.f').text()).toBe('Note');
  });
});
