// The Dixnt table on the standard layout: the layout sums, the Status words, the move log, and the whole screen mounted
// with a fake socket (header Leave, the three zones, the bars, no Leave button in the play area).
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Dixnt from './Dixnt.vue';
import { ASPECT, CAPTION, barSpan, fitCards, handCard } from './layout.js';
import { newEntries, roundNumber } from './moveLog.js';
import { statusFor, styleName } from './status.js';
import { leaveOffer, playBar } from '../../../src/playBar.js';

// ---- a state shaped like the server's view ----
const player = (id, name, extra = {}) => ({ id, name, score: 0, turns: 0, waiting: false, connected: true, bot: false, ai: null, isChooser: false, hasPlayed: false, hasVoted: false, ...extra });
function view(extra = {}, me = {}) {
  const players = extra.players ?? [player('ann', 'Ann', { isChooser: true }), player('bob', 'Bob'), player('cy', 'Cy', { bot: true }), player('di', 'Di', { bot: true })];
  return {
    code: 'a-b-c',
    phase: 'picking',
    round: 1,
    roundsEach: 1,
    completedRounds: 0,
    totalRounds: 4,
    winners: [],
    handSize: 6,
    chooserId: 'ann',
    hostId: 'ann',
    minPlayers: 3,
    maxPlayers: 12,
    pointsPerVote: 100,
    pointsChooserCorrect: 100,
    pointsFooledChooser: 500,
    pointsFavourite: 200,
    judging: 'everyone',
    categories: [],
    availableCards: 400,
    drawCount: 30,
    discardCount: 2,
    word: 'Dragon',
    wordHidden: false,
    me: { id: 'ann', waiting: false, isChooser: true, hand: [1, 2, 3, 4, 5, 6], myPick: null, myVote: null, isImposter: false, ...me },
    players,
    scoreboard: { players: players.map((p) => ({ id: p.id, name: p.name, score: p.score, isMe: p.id === 'ann', bot: p.bot, away: false })), rounds: [], lowIsBetter: false },
    table: [],
    voteTargets: [],
    results: null,
    ...extra,
  };
}
const asBob = (extra = {}, me = {}) => {
  const v = view(extra, { id: 'bob', isChooser: false, ...me });
  v.players = v.players.map((p) => ({ ...p }));
  return v;
};

function fakeSocket() {
  const handlers = {};
  return {
    connected: false,
    handlers,
    emit: vi.fn((event, payload, ack) => ack?.({ ok: true })),
    on: vi.fn((e, f) => (handlers[e] = f)),
    off: vi.fn((e) => delete handlers[e]),
  };
}
async function mountGame(state) {
  const socket = fakeSocket();
  const wrapper = mount(Dixnt, { props: { socket, user: { id: 1, displayName: 'Ann' }, setSearch: vi.fn() }, attachTo: document.body });
  socket.handlers.connect?.();
  socket.handlers.state(state);
  await flushPromises();
  return { wrapper, socket };
}

describe('Dixnt layout sums', () => {
  it('fits the biggest cards in one row when they can, and in rows when the room is short', () => {
    const one = fitCards(4, 1334, 200, { gap: 12 });
    expect(one.rows).toBe(1);
    expect(one.height + CAPTION).toBeLessThanOrEqual(200);
    expect(one.width / one.height).toBeCloseTo(ASPECT, 1);
    const many = fitCards(12, 600, 700, { gap: 12 });
    expect(many.rows).toBeGreaterThan(1);
    expect(many.columns * many.width + (many.columns - 1) * 12).toBeLessThanOrEqual(600);
    expect(many.rows * (many.height + CAPTION) + (many.rows - 1) * 12).toBeLessThanOrEqual(700);
  });

  it('sizes the hand from the room, never wider than the room', () => {
    const roomy = handCard(1334, 420, 6);
    expect(roomy.height).toBeLessThanOrEqual(Math.round(420 * 0.42));
    expect(roomy.width * 6 + 10 * 5).toBeLessThanOrEqual(1334);
    const narrow = handCard(500, 420, 8);
    expect(narrow.width * 8 + 10 * 7).toBeLessThanOrEqual(500);
  });

  it('gives the bars whole columns of the 12 on the frame', () => {
    expect(12 % barSpan(3)).toBe(0);
    expect(12 % barSpan(7)).toBe(0);
  });
});

describe('Dixnt Status words', () => {
  it('tells the chooser what to do, and the others who is choosing', () => {
    expect(statusFor(view({ phase: 'word' })).headline).toMatch(/choose a word/);
    expect(statusFor(view({ phase: 'word' })).mine).toBe(true);
    const other = statusFor(asBob({ phase: 'word', players: view().players.map((p) => p) }));
    expect(other.headline).toBe('Ann is choosing a word…');
    expect(other.mine).toBe(false);
  });

  it('covers picking: play, played and the imposter', () => {
    expect(statusFor(asBob()).headline).toMatch(/play the card that fits/i);
    expect(statusFor(asBob({ wordHidden: true, word: null })).headline).toMatch(/did not see the word/);
    const played = statusFor(asBob({}, { myPick: 3 }));
    expect(played.headline).toBe('Card played.');
    expect(played.lines.map((l) => l.text ?? l).join(' ')).toMatch(/swap it/);
  });

  it('covers voting by style and the results', () => {
    expect(statusFor(asBob({ phase: 'voting' })).headline).toMatch(/vote for the player/);
    expect(statusFor(asBob({ phase: 'voting' }, { myVote: 'cy' })).headline).toMatch(/vote is in/);
    expect(statusFor(view({ phase: 'voting', judging: 'favourite' }, { myVote: null })).headline).toMatch(/pick the card you like best/);
    expect(statusFor(asBob({ phase: 'voting', judging: 'chooser' })).headline).toBe('Ann will decide who was in the dark.');
    const results = { judging: 'everyone', imposterId: 'cy', groupCorrect: true, votes: { bob: 'cy' }, tally: { cy: 1, ann: 0, bob: 0, di: 0 }, deltas: {} };
    const done = statusFor(view({ phase: 'results', results }));
    expect(done.headline).toBe('Cy was the imposter!');
    expect(done.lines.map((l) => l.text ?? l).join(' ')).toMatch(/Votes for Cy: Bob/);
  });

  it('names the winner at the end, with the way on for the host and for the others', () => {
    const over = (isHost) => statusFor(view({ phase: 'finished', winners: ['bob'], completedRounds: 4 }), { isHost });
    expect(over(true).headline).toBe('Bob wins!');
    expect(over(true).lines.map((l) => l.text).join(' ')).toMatch(/Back to the lobby/);
    expect(over(false).lines.map((l) => l.text).join(' ')).toMatch(/Waiting for the host/);
    expect(styleName('favourite')).toBe('Favourite card');
  });
});

describe('Dixnt move log', () => {
  const stepped = (before, after) => newEntries(before, after);
  it('notes each round, the word, every card played and every vote, and the result', () => {
    const word = view({ phase: 'word' });
    expect(stepped(null, word)).toEqual(['Round 1: Ann is choosing a word.']);
    const picking = view({ phase: 'picking' });
    expect(stepped(word, picking)).toEqual(['Ann chose the word.']);
    const played = view({ phase: 'picking', players: picking.players.map((p) => (p.id === 'bob' ? { ...p, hasPlayed: true } : p)) });
    expect(stepped(picking, played)).toEqual(['Bob played a card.']);
    const voting = view({ phase: 'voting', players: picking.players });
    expect(stepped(played, voting)).toEqual(['All the cards are on the table.']);
    const voted = view({ phase: 'voting', players: voting.players.map((p) => (p.id === 'cy' ? { ...p, hasVoted: true } : p)) });
    expect(stepped(voting, voted)).toEqual(['Cy voted.']);
    const results = view({ phase: 'results', results: { judging: 'everyone', imposterId: 'di', groupCorrect: false } });
    expect(stepped(voted, results)).toEqual(['Di was the imposter. They fooled the table.']);
    const favourite = view({ phase: 'results', results: { judging: 'favourite', winnerId: 'bob' } });
    expect(stepped(voted, favourite)).toEqual(['Ann picked Bob’s card.']);
  });

  it('notes a skipped round and the end of the game, and nothing for the lobby or a repeated state', () => {
    const picking = view({ phase: 'picking' });
    const next = view({ phase: 'word', chooserId: 'bob', players: picking.players.map((p) => ({ ...p, isChooser: p.id === 'bob' })) });
    expect(stepped(picking, next)).toEqual(['The round was skipped.', 'Round 1: Bob is choosing a word.']);
    expect(stepped(view({ phase: 'results' }), view({ phase: 'finished', winners: ['ann', 'bob'] }))).toEqual(['The game is over: Ann and Bob win.']);
    expect(stepped(picking, picking)).toEqual([]);
    expect(stepped(null, view({ phase: 'lobby' }))).toEqual([]);
    expect(roundNumber(view({ phase: 'results', completedRounds: 2 }))).toBe(2);
    expect(roundNumber(view({ phase: 'voting', completedRounds: 2 }))).toBe(3);
  });
});

describe('Dixnt word pop-up', () => {
  it('shows the chosen word large to everyone once, ??? to the imposter, and goes by itself or on a click', async () => {
    vi.useFakeTimers();
    try {
      const { wrapper, socket } = await mountGame(asBob({ phase: 'word', word: null }, { isChooser: false }));
      expect(wrapper.find('.word-popup').exists()).toBe(false);
      socket.handlers.state(asBob({ phase: 'picking' }));
      await flushPromises();
      expect(wrapper.find('.word-popup .word').text()).toBe('Dragon');
      await vi.advanceTimersByTimeAsync(4500);
      expect(wrapper.find('.word-popup').exists()).toBe(false);
      socket.handlers.state(asBob({ phase: 'picking' })); // the same phase again: not shown again
      await flushPromises();
      expect(wrapper.find('.word-popup').exists()).toBe(false);
      socket.handlers.state(asBob({ phase: 'word', word: null }));
      socket.handlers.state(asBob({ phase: 'picking', wordHidden: true, word: null }));
      await flushPromises();
      expect(wrapper.find('.word-popup .word').text()).toBe('???');
      await wrapper.find('.word-popup').trigger('click');
      await flushPromises();
      await vi.advanceTimersByTimeAsync(400);
      expect(wrapper.find('.word-popup').exists()).toBe(false);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show it for a game joined or reloaded mid-phase', async () => {
    const { wrapper } = await mountGame(asBob({ phase: 'picking' }));
    expect(wrapper.find('.word-popup').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('Dixnt player pop-up', () => {
  it('gives the host a Remove button for a person and for a computer player, removing through removePlayer', async () => {
    const { wrapper, socket } = await mountGame(view());
    const chips = () => wrapper.findAll('.score-bar button.chip-button');
    expect(chips().map((c) => c.text())).toEqual([expect.stringContaining('Bob'), expect.stringContaining('Cy'), expect.stringContaining('Di')]);
    await chips()[0].trigger('click');
    expect(wrapper.find('.player-popup').text()).toContain('Remove player');
    expect(wrapper.find('.player-popup').text()).toContain('still choosing a card');
    await chips()[1].trigger('click');
    const remove = wrapper.find('.player-popup').findAll('button').find((b) => b.text() === 'Remove computer player');
    expect(remove).toBeTruthy();
    await remove.trigger('click');
    socket.emit.mockClear();
    await wrapper.find('.player-popup [data-confirm]').trigger('click');
    await flushPromises();
    expect(socket.emit).toHaveBeenCalledWith('removePlayer', { targetId: 'cy' }, expect.any(Function));
    expect(wrapper.find('.player-popup').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the others no Remove button', async () => {
    const { wrapper } = await mountGame(asBob({ hostId: 'ann' }));
    await wrapper.findAll('.score-bar button.chip-button')[0].trigger('click');
    expect(wrapper.find('.player-popup').exists()).toBe(true);
    expect(wrapper.find('.player-popup').text()).not.toContain('Remove');
    wrapper.unmount();
  });
});

describe('Dixnt screen', () => {
  it('has the standard frame, the header Leave and no Leave button in the play area', async () => {
    const { wrapper, socket } = await mountGame(view({ phase: 'word' }));
    expect(wrapper.find('.game-frame').exists()).toBe(true);
    expect(wrapper.findAll('button').filter((b) => /^Leave/.test(b.text()))).toEqual([]);
    expect(leaveOffer().confirmText).toBe('A computer player will take over your seat and your score.');
    socket.handlers.state(view({ phase: 'word', players: [player('ann', 'Ann', { isChooser: true }), player('cy', 'Cy', { bot: true }), player('di', 'Di', { bot: true })] }));
    await flushPromises();
    expect(leaveOffer().confirmText).toBe('Your score will be lost.');
    socket.handlers.state(view({ phase: 'lobby' }));
    await flushPromises();
    expect(leaveOffer().confirmText).toBe('');
    expect(wrapper.find('.game-frame').exists()).toBe(false);
    socket.emit.mockClear();
    await leaveOffer().leave();
    expect(socket.emit).toHaveBeenCalledWith('leave', {}, expect.any(Function));
    wrapper.unmount();
    expect(playBar.leave).toBeNull();
  });

  it('keeps the table, the controls and the hand in place from phase to phase, with no duplicate player bars', async () => {
    const { wrapper, socket } = await mountGame(asBob());
    const zones = () => ['.table-zone', '.controls', '.hand-zone', '.hand .cards'].map((s) => wrapper.find(s).exists());
    expect(zones()).toEqual([true, true, true, true]);
    expect(wrapper.find('ul[aria-label="Players"]').exists()).toBe(false); // the score bar is the one list of players
    expect(wrapper.findAll('.hand .slot')).toHaveLength(6);
    const sizeOf = () => wrapper.find('.hand').attributes('style');
    const before = sizeOf();
    for (const phase of ['voting', 'results']) {
      socket.handlers.state(asBob({ phase, table: [{ playerId: 'ann', cardId: 11 }, { playerId: 'bob', cardId: 12 }], voteTargets: phase === 'voting' ? ['ann'] : [], results: phase === 'results' ? { judging: 'everyone', imposterId: 'ann', groupCorrect: true, votes: {}, tally: { ann: 0, bob: 0, cy: 0, di: 0 }, deltas: {} } : null }));
      await flushPromises();
      expect(zones()).toEqual([true, true, true, true]);
      expect(sizeOf()).toBe(before);
    }
    wrapper.unmount();
  });

  it('puts the vote buttons under the cards and sends the vote', async () => {
    const { wrapper, socket } = await mountGame(asBob({ phase: 'voting', table: [{ playerId: 'ann', cardId: 11 }, { playerId: 'cy', cardId: 12 }, { playerId: 'bob', cardId: 13 }], voteTargets: ['ann', 'cy'] }));
    const buttons = wrapper.findAll('.table figcaption button');
    expect(buttons.map((b) => b.text())).toEqual(['Vote', 'Vote']);
    socket.emit.mockClear();
    await buttons[1].trigger('click');
    expect(socket.emit).toHaveBeenCalledWith('vote', { targetId: 'cy' }, expect.any(Function));
    wrapper.unmount();
  });

  it('shows the chooser a word field in the controls zone, and the next round button at the results', async () => {
    const { wrapper, socket } = await mountGame(view({ phase: 'word' }));
    const form = wrapper.find('.controls form.word');
    expect(form.exists()).toBe(true);
    await form.find('input').setValue('Lantern');
    socket.emit.mockClear();
    await form.trigger('submit');
    expect(socket.emit).toHaveBeenCalledWith('submitWord', { word: 'Lantern' }, expect.any(Function));
    socket.handlers.state(view({ phase: 'results', results: { judging: 'favourite', winnerId: 'bob', votes: {}, tally: {}, deltas: {} }, table: [{ playerId: 'bob', cardId: 3 }] }));
    await flushPromises();
    expect(wrapper.find('.controls').text()).toContain('Next round: Bob chooses the word');
    wrapper.unmount();
  });

  it('fills the Recent moves from the changes it sees, and the Status with the word and the style', async () => {
    const { wrapper, socket } = await mountGame(view({ phase: 'word' }));
    socket.handlers.state(view({ phase: 'picking' }));
    socket.handlers.state(view({ phase: 'picking', players: view().players.map((p) => (p.id === 'bob' ? { ...p, hasPlayed: true } : p)) }));
    await flushPromises();
    const log = wrapper.find('.box.log').text();
    expect(log).toContain('Bob played a card.');
    expect(log.indexOf('Bob played a card.')).toBeLessThan(log.indexOf('Ann chose the word.')); // newest first
    const status = wrapper.find('.box.status').text();
    expect(status).toContain('Round 1 of 4');
    expect(status).toContain('Everyone votes');
    expect(status).toContain('Word: Dragon');
    wrapper.unmount();
  });
});
