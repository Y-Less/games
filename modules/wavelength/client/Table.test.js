// The Wavelength screen mounted with a fake socket: what each player sees in each phase, solo and team, and what the
// controls send.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Wavelength from './Wavelength.vue';

const BANDS = [{ within: 2.5, points: 4 }, { within: 7.5, points: 3 }, { within: 12.5, points: 2 }];
const player = (id, name, extra = {}) => ({ id, name, colour: id === 1 ? '#ff0000' : id === 2 ? '#0000ff' : '#00ff00', score: 0, online: true, bot: false, guessed: false, ready: false, placement: null, winner: false, ...extra });
function view(extra = {}) {
  const players = extra.players ?? [player(1, 'Ann'), player(2, 'Bob'), player(3, 'Cy')];
  return {
    code: 'a-b-c',
    phase: 'guessing',
    you: 1,
    hostId: 1,
    turnsEach: 1,
    mode: 'solo',
    turn: 1,
    turnsTotal: 3,
    psychic: 2,
    spectrum: { left: 'Cold', right: 'Hot' },
    target: null,
    clue: 'a hot bath',
    marker: null,
    guesses: [],
    bands: BANDS,
    result: null,
    players,
    scoreboard: { players: players.map((p) => ({ id: p.id, name: p.name, score: p.score, isMe: p.id === 1, away: false })), rounds: [], lowIsBetter: false },
    colours: ['#ff0000', '#0000ff', '#00ff00'],
    canCustomColour: false,
    limits: { min: 2, max: 8, turns: { min: 1, max: 5 } },
    ...extra,
  };
}
const asPsychic = (extra = {}) => view({ psychic: 1, target: 62, ...extra });
const revealed = (extra = {}) =>
  view({
    phase: 'reveal',
    target: 62,
    guesses: [{ id: 1, position: 60 }, { id: 3, position: 20 }],
    result: { target: 62, psychic: 2, psychicName: 'Bob', psychicPoints: 2, entries: [{ id: 1, name: 'Ann', position: 60, points: 4, bullseye: true }, { id: 3, name: 'Cy', position: 20, points: 0, bullseye: false }] },
    ...extra,
  });

function fakeSocket() {
  const handlers = {};
  return { connected: false, handlers, emit: vi.fn((event, payload, ack) => ack?.({ ok: true })), on: vi.fn((e, f) => (handlers[e] = f)), off: vi.fn((e) => delete handlers[e]) };
}
let wrapper;
async function mountGame(state) {
  const socket = fakeSocket();
  wrapper = mount(Wavelength, { props: { socket, setSearch: vi.fn() }, attachTo: document.body });
  socket.handlers.state(state);
  await flushPromises();
  return { wrapper, socket, show: async (next) => { socket.handlers.state(next); await flushPromises(); } };
}
const button = (text) => wrapper.findAll('button').find((b) => b.text() === text);
const sent = (socket, event) => socket.emit.mock.calls.filter((c) => c[0] === event).map((c) => c[1]);

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
});

describe('Wavelength screen, everyone for themselves', () => {
  it('shows a guesser the dial without the target, and turns the dial from the slider to a locked guess', async () => {
    const { socket } = await mountGame(view());
    expect(wrapper.find('.wedge').exists()).toBe(false); // no target
    expect(wrapper.find('.clue').text()).toContain('a hot bath');
    expect(button('Lock in guess').attributes('disabled')).toBeDefined(); // nothing chosen yet
    await wrapper.find('input[type="range"]').setValue('33');
    expect(wrapper.find('.needle').exists()).toBe(true);
    expect(button('Lock in guess').attributes('disabled')).toBeUndefined();
    await button('Lock in guess').trigger('click');
    expect(socket.emit).toHaveBeenCalledWith('guess', { position: 33 }, expect.any(Function));
  });

  it('shows the psychic the target and a clue form that sends the clue', async () => {
    const { socket } = await mountGame(asPsychic({ phase: 'clue', clue: '' }));
    expect(wrapper.findAll('.wedge')).toHaveLength(3);
    expect(wrapper.find('.slider').attributes('disabled')).toBeDefined();
    expect(button('Send clue').attributes('disabled')).toBeDefined();
    await wrapper.find('form.clue-form input').setValue('a hot bath');
    await wrapper.find('form.clue-form').trigger('submit');
    expect(socket.emit).toHaveBeenCalledWith('clue', { text: 'a hot bath' }, expect.any(Function));
  });

  it('waits for the clue, and does not let anyone turn the dial yet', async () => {
    await mountGame(view({ phase: 'clue', clue: '' }));
    expect(wrapper.text()).toContain("Waiting for Bob's clue");
    expect(wrapper.find('.slider').attributes('disabled')).toBeDefined();
    expect(button('Lock in guess')).toBeUndefined();
  });

  it('keeps your locked guess as a needle while others finish, but draws it only once, as a marker, at the reveal', async () => {
    const { show } = await mountGame(view({ players: [player(1, 'Ann', { guessed: true }), player(2, 'Bob'), player(3, 'Cy')], guesses: [{ id: 1, position: 60 }] }));
    expect(wrapper.find('.needle').exists()).toBe(true);
    expect(wrapper.find('.slider').attributes('disabled')).toBeDefined(); // locked
    await show(revealed());
    expect(wrapper.find('.needle').exists()).toBe(false); // the regression: it used to sit on top of its own marker
    expect(wrapper.findAll('svg.face .pin')).toHaveLength(2);
    expect(wrapper.findAll('svg.face .wedge')).toHaveLength(3);
  });

  it('shows the other players in slim bars, with the psychic marked and who has guessed', async () => {
    await mountGame(view({ players: [player(1, 'Ann'), player(2, 'Bob'), player(3, 'Cy', { guessed: true })] }));
    const bars = wrapper.findAll('.bars .bar');
    expect(bars.map((b) => b.find('.who').text())).toEqual(['Bob', 'Cy']);
    expect(bars[0].text()).toContain('psychic');
    expect(bars[1].text()).toContain('guessed');
  });

  it('says how the game ended', async () => {
    await mountGame(view({ phase: 'finished', turn: 3, players: [player(1, 'Ann', { score: 9, placement: 1, winner: true }), player(2, 'Bob', { score: 4, placement: 2 }), player(3, 'Cy', { score: 4, placement: 2 })], result: null }));
    expect(wrapper.text()).toContain('Ann wins with 9 points.');
  });
});

describe('Wavelength screen, one team', () => {
  const team = (extra = {}) => view({ mode: 'team', ...extra });

  it('shows every guesser the shared marker, lets any of them move it, and sends moves straight away at first', async () => {
    const { socket } = await mountGame(team({ marker: 40 }));
    expect(wrapper.find('.needle').exists()).toBe(true);
    expect(wrapper.find('input[type="range"]').element.value).toBe('40');
    expect(wrapper.find('.slider').attributes('disabled')).toBeUndefined();
    await wrapper.find('input[type="range"]').setValue('55');
    expect(sent(socket, 'marker')).toEqual([{ position: 55 }]);
    expect(wrapper.text()).toContain('Move the marker together');
  });

  it('sends a burst of moves at a steady pace, ending on the last one', async () => {
    const { socket } = await mountGame(team({ marker: 40 }));
    const slider = wrapper.find('input[type="range"]');
    await slider.setValue('41');
    await slider.setValue('42');
    await slider.setValue('43');
    expect(sent(socket, 'marker')).toEqual([{ position: 41 }]); // the rest wait their turn
    vi.advanceTimersByTime(100);
    expect(sent(socket, 'marker')).toEqual([{ position: 41 }, { position: 43 }]); // one message with the latest
  });

  it('shows your own position while you turn it, then the team\'s again', async () => {
    const { show } = await mountGame(team({ marker: 40 }));
    await wrapper.find('input[type="range"]').setValue('70');
    expect(wrapper.find('.needle line').attributes('x2')).not.toBe(undefined);
    const mine = wrapper.find('.needle line').attributes('x2');
    vi.advanceTimersByTime(1000);
    await show(team({ marker: 20 }));
    expect(wrapper.find('.needle line').attributes('x2')).not.toBe(mine); // now where the server says
  });

  it('locks in at the team marker, and only once there is one', async () => {
    const { socket, show } = await mountGame(team());
    expect(button('Lock in').attributes('disabled')).toBeDefined();
    await show(team({ marker: 48 }));
    expect(button('Lock in').attributes('disabled')).toBeUndefined();
    await button('Lock in').trigger('click');
    expect(sent(socket, 'lock')).toHaveLength(1);
    expect(sent(socket, 'guess')).toHaveLength(0);
  });

  it('sends a move that is still waiting before it locks in, so the lock is where the team sees it', async () => {
    const { socket } = await mountGame(team({ marker: 40 }));
    const slider = wrapper.find('input[type="range"]');
    await slider.setValue('41');
    await slider.setValue('44');
    await button('Lock in').trigger('click');
    const order = socket.emit.mock.calls.map((c) => c[0] === 'marker' ? `marker:${c[1].position}` : c[0]).filter((e) => e !== 'resume');
    expect(order).toEqual(['marker:41', 'marker:44', 'lock']);
  });

  it('gives the psychic nothing to move, no marker and no lock button', async () => {
    await mountGame(asPsychic({ mode: 'team' }));
    expect(wrapper.find('.needle').exists()).toBe(false);
    expect(wrapper.find('.slider').attributes('disabled')).toBeDefined();
    expect(button('Lock in')).toBeUndefined();
    expect(wrapper.findAll('.wedge')).toHaveLength(3);
    expect(wrapper.text()).toContain('Your team is moving the marker together');
  });

  it('shows the team marker at the reveal as one pin, and what the team scored', async () => {
    await mountGame(team({ ...revealed(), mode: 'team', marker: 60, guesses: [{ id: 1, position: 60 }, { id: 3, position: 60 }], result: { ...revealed().result, team: true, lockedBy: 3, psychicPoints: 4 } }));
    expect(wrapper.findAll('svg.face .pin')).toHaveLength(1);
    expect(wrapper.find('.needle').exists()).toBe(false);
    expect(wrapper.text()).toContain('Your team scores 4 for this turn.');
  });

  it('does not show who has guessed, since nobody guesses alone', async () => {
    await mountGame(team({ players: [player(1, 'Ann'), player(2, 'Bob'), player(3, 'Cy', { guessed: true })] }));
    expect(wrapper.find('.bars').text()).not.toContain('guessed');
  });

  it('ends with the team\'s score out of the most it could have', async () => {
    await mountGame(team({ phase: 'finished', turn: 3, players: [player(1, 'Ann', { score: 8, placement: 1, winner: true }), player(2, 'Bob', { score: 8, placement: 1, winner: true }), player(3, 'Cy', { score: 8, placement: 1, winner: true })] }));
    expect(wrapper.text()).toContain('Your team scored 8 of 12 points.');
  });
});

describe('Wavelength turn pop-up', () => {
  const popups = () => document.body.querySelectorAll('.your-turn').length;

  it('tells the psychic it is their turn to give the clue', async () => {
    document.body.innerHTML = '';
    await mountGame(asPsychic({ phase: 'clue', clue: '' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(popups()).toBe(1);
  });

  it('says nothing to the guessers, who all go together, when the clue arrives', async () => {
    document.body.innerHTML = '';
    const { show } = await mountGame(view({ phase: 'clue', clue: '' }));
    expect(popups()).toBe(0);
    await show(view());
    await vi.advanceTimersByTimeAsync(0);
    expect(wrapper.text()).toContain('Your turn: read the clue');
    expect(popups()).toBe(0);
  });

  it('says nothing to the psychic while the guessers guess, nor to a team that moves one marker together', async () => {
    document.body.innerHTML = '';
    await mountGame(asPsychic());
    await vi.advanceTimersByTimeAsync(0);
    expect(popups()).toBe(0);
    wrapper.unmount();
    document.body.innerHTML = '';
    await mountGame(view({ mode: 'team', marker: 30 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(popups()).toBe(0);
  });
});
