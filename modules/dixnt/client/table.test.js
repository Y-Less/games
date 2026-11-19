// The Dixnt table on the standard layout: the layout sums, the Status words, the move log, and the whole screen mounted
// with a fake socket (header Leave, the three zones, the bars, no Leave button in the play area).
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Dixnt from './Dixnt.vue';
import { ASPECT, CAPTION, barSpan, fitCards, handCard } from './layout.js';
import { newEntries, turnNumber } from './moveLog.js';
import { statusFor, styleName } from './status.js';
import { leaveOffer, playBar } from '../../../src/playBar.js';
import { messageText } from '../../../src/messageText.js';

// status.js and moveLog.js write messages, not sentences; these put one into English, as the components do.
const words = (value) => messageText(value, 'dixnt');
// A Status line is a message, or { text: message, tone }.
const lineWords = (line) => words(line?.tone ? line.text : line);

// ---- a state shaped like the server's view ----
const player = (id, name, extra = {}) => ({ id, slot: `s-${id}`, name, score: 0, turns: 0, online: true, bot: false, ai: null, isChooser: false, plays: true, hasPlayed: false, hasVoted: false, placement: null, winner: false, ...extra });
/** The usual table of four: Ann (who chooses the word, and so plays no card), Bob, and two computer players. */
const table = () => [player('ann', 'Ann', { isChooser: true, plays: false }), player('bob', 'Bob'), player('cy', 'Cy', { bot: true }), player('di', 'Di', { bot: true })];
/** The same table once the game is over, won by the players named (who share first place; the rest share second). */
const wonBy = (...ids) => table().map((p) => ({ ...p, winner: ids.includes(p.id), placement: ids.includes(p.id) ? 1 : 2 }));
/** A view for the viewer named by `me.id` (Ann unless it says otherwise); the rest of `me` is their own place. */
function view(extra = {}, { id: you = 'ann', ...me } = {}) {
  const players = extra.players ?? table();
  return {
    code: 'a-b-c',
    you,
    phase: 'picking',
    turn: 1,
    rounds: 1,
    completedTurns: 0,
    totalTurns: 4,
    completedRounds: 0,
    handSize: 6,
    chooserId: 'ann',
    hostId: 'ann',
    minPlayers: 3,
    maxPlayers: 12,
    pointsPerVote: 1,
    pointsChooserCorrect: 1,
    pointsFooledChooser: 5,
    pointsFavourite: 2,
    judging: 'everyone',
    noChooser: false,
    categories: [],
    availableCards: 400,
    drawCount: 30,
    discardCount: 2,
    word: 'Dragon',
    wordHidden: false,
    isChooser: true,
    playsCard: Boolean(players.find((p) => p.id === you)?.plays), // the server works it out the same way round
    hand: [1, 2, 3, 4, 5, 6],
    myPick: null,
    myVote: null,
    isImposter: false,
    ...me,
    players,
    scoreboard: { players: players.map((p) => ({ id: p.id, slot: p.slot, name: p.name, score: p.score, isMe: p.id === you, bot: p.bot, away: false })), rounds: [], lowIsBetter: false },
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

describe('the start screen', () => {
  it('offers the shared create-or-join form, with the invite code from the address', async () => {
    const socket = fakeSocket();
    const wrapper = mount(Dixnt, { props: { socket, user: { id: 1, displayName: 'Ann' }, search: '?boss-aware-you', setSearch: vi.fn() }, attachTo: document.body });
    socket.handlers.state(null);
    await flushPromises();
    expect(wrapper.find('input[aria-label="Invite code"]').element.value).toBe('boss-aware-you');
    socket.emit.mockClear();
    await wrapper.findAll('button').find((b) => b.text().includes('Start a new game')).trigger('click');
    expect(socket.emit).toHaveBeenCalledWith('create', {}, expect.any(Function));
    socket.emit.mockClear();
    await wrapper.findAll('button').find((b) => b.text() === 'Join').trigger('click');
    expect(socket.emit).toHaveBeenCalledWith('join', { code: 'boss-aware-you' }, expect.any(Function));
    wrapper.unmount();
  });
});

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
    expect(words(statusFor(view({ phase: 'word' })).headline)).toMatch(/choose a word/);
    expect(statusFor(view({ phase: 'word' })).mine).toBe(true);
    const other = statusFor(asBob({ phase: 'word', players: view().players.map((p) => p) }));
    expect(words(other.headline)).toBe('Ann is choosing a word…');
    expect(other.mine).toBe(false);
  });

  it('covers picking: play, played and the imposter', () => {
    expect(words(statusFor(asBob()).headline)).toMatch(/play the card that fits/i);
    expect(words(statusFor(asBob({ wordHidden: true, word: null })).headline)).toMatch(/did not see the word/);
    const played = statusFor(asBob({}, { myPick: 3 }));
    expect(words(played.headline)).toBe('Card played.');
    expect(played.lines.map(lineWords).join(' ')).toMatch(/swap it/);
  });

  it('covers voting by style and the results', () => {
    expect(words(statusFor(asBob({ phase: 'voting' })).headline)).toMatch(/vote for the player/);
    expect(words(statusFor(asBob({ phase: 'voting' }, { myVote: 'cy' })).headline)).toMatch(/vote is in/);
    expect(words(statusFor(view({ phase: 'voting', judging: 'favourite' }, { myVote: null })).headline)).toMatch(/pick the card you like best/);
    expect(words(statusFor(asBob({ phase: 'voting', judging: 'chooser' })).headline)).toBe('Ann will decide who was in the dark.');
    const results = { judging: 'everyone', imposterId: 'cy', groupCorrect: true, votes: { bob: 'cy' }, tally: { cy: 1, ann: 0, bob: 0, di: 0 }, deltas: {} };
    const done = statusFor(view({ phase: 'results', results }));
    expect(words(done.headline)).toBe('Cy was the imposter!');
    expect(done.lines.map(lineWords).join(' ')).toMatch(/Votes for Cy: Bob/);
  });

  // With no chooser everybody plays a card, so the player whose turn it is is told to play like anybody else rather
  // than told to sit and wait, and nobody is waited on for a word.
  it('tells everybody to play a card when nobody chooses the word', () => {
    const all = table().map((p) => ({ ...p, isChooser: false, plays: true }));
    const turn = (extra = {}, me = {}) => view({ noChooser: true, chooserId: null, players: all, ...extra }, { isChooser: false, ...me });
    expect(words(statusFor(turn()).headline)).toMatch(/play the card that fits/i);
    expect(words(statusFor(turn({}, { id: 'bob' })).headline)).toMatch(/play the card that fits/i);
    // And the one kept in the dark still is, whoever's turn it is.
    expect(words(statusFor(turn({ wordHidden: true, word: null })).headline)).toMatch(/did not see the word/);
    // Once a card is down, the wait names everybody still to play — the player whose turn it is among them, where
    // with a chooser they would have been left out of the list altogether.
    const waiting = statusFor(turn({ players: all.map((p) => (p.id === 'bob' ? { ...p, hasPlayed: true } : p)) }, { id: 'bob', myPick: 3 }));
    expect(waiting.lines.map(lineWords).join(' ')).toContain('Waiting for Ann, Cy and Di');
  });

  it('names the winner at the end, with the way on for the host and for the others', () => {
    const over = (isHost) => statusFor(view({ phase: 'finished', players: wonBy('bob'), completedTurns: 4 }), { isHost });
    expect(words(over(true).headline)).toBe('Bob wins!');
    expect(over(true).lines.map(lineWords).join(' ')).toMatch(/Back to the lobby/);
    expect(over(false).lines.map(lineWords).join(' ')).toMatch(/Waiting for the host/);
    expect(words(styleName('favourite'))).toBe('Favourite card');
  });
});

describe('Dixnt move log', () => {
  const stepped = (before, after) => newEntries(before, after).map(words);
  it('notes each round, the word, every card played and every vote, and the result', () => {
    const word = view({ phase: 'word' });
    expect(stepped(null, word)).toEqual(['Turn 1: Ann is choosing a word.']);
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

  // With no chooser a turn opens straight on the cards, so the line that announces it hangs on the turn's number
  // rather than on a word phase there no longer is.
  it('opens a turn nobody chose the word for, which no word phase announces any more', () => {
    const all = table().map((p) => ({ ...p, isChooser: false, plays: true }));
    const open = (extra = {}) => view({ noChooser: true, chooserId: null, phase: 'picking', players: all, ...extra });
    expect(stepped(null, open())).toEqual(['Turn 1: a word was picked for the table.']);
    expect(stepped(view({ phase: 'results' }), open({ turn: 2, completedTurns: 1 }))).toEqual(['Turn 2: a word was picked for the table.']);
    expect(stepped(open(), open())).toEqual([], 'and not again while the same turn is played');
    // A turn abandoned here steps from cards to cards, which the turn's number is what tells apart.
    expect(stepped(open(), open({ turn: 2 }))).toEqual(['The turn was skipped.', 'Turn 1: a word was picked for the table.']);
  });

  it('notes a skipped round and the end of the game, and nothing for the lobby or a repeated state', () => {
    const picking = view({ phase: 'picking' });
    // A skipped turn leaves the cards behind and opens a new turn, which the server counts: `turn` goes up.
    const next = view({ phase: 'word', turn: 2, chooserId: 'bob', players: picking.players.map((p) => ({ ...p, isChooser: p.id === 'bob' })) });
    expect(stepped(picking, next)).toEqual(['The turn was skipped.', 'Turn 1: Bob is choosing a word.']);
    expect(stepped(view({ phase: 'results' }), view({ phase: 'finished', players: wonBy('ann', 'bob') }))).toEqual(['The game is over: Ann and Bob win.']);
    expect(stepped(picking, picking)).toEqual([]);
    expect(stepped(null, view({ phase: 'lobby' }))).toEqual([]);
    expect(turnNumber(view({ phase: 'results', completedTurns: 2 }))).toBe(2);
    expect(turnNumber(view({ phase: 'voting', completedTurns: 2 }))).toBe(3);
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
  it('gives the host a Remove button for a person and for a computer player, each through its own event', async () => {
    const { wrapper, socket } = await mountGame(view());
    const chips = () => wrapper.findAll('.score-bar button.chip-button');
    expect(chips().map((c) => c.text())).toEqual([expect.stringContaining('Ann'), expect.stringContaining('Bob'), expect.stringContaining('Cy'), expect.stringContaining('Di')]);
    await chips()[0].trigger('click'); // the host's own summary: facts, but nobody removes themselves
    expect(wrapper.find('.player-popup').text()).toContain('Turns as chooser');
    expect(wrapper.find('.player-popup').text()).not.toContain('Remove');
    await chips()[1].trigger('click');
    expect(wrapper.find('.player-popup').text()).toContain('Remove player');
    expect(wrapper.find('.player-popup').text()).toContain('still choosing a card');
    await chips()[2].trigger('click');
    const remove = wrapper.find('.player-popup').findAll('button').find((b) => b.text() === 'Remove computer player');
    expect(remove).toBeTruthy();
    await remove.trigger('click');
    socket.emit.mockClear();
    await wrapper.find('.player-popup [data-confirm]').trigger('click');
    await flushPromises();
    expect(socket.emit).toHaveBeenCalledWith('removeBot', { slot: 's-cy' }, expect.any(Function));
    expect(wrapper.find('.player-popup').exists()).toBe(false);

    // A person is removed with 'kick' rather than 'removeBot', but named the same way: by their slot.
    await chips()[1].trigger('click');
    await wrapper.find('.player-popup').findAll('button').find((b) => b.text() === 'Remove player').trigger('click');
    socket.emit.mockClear();
    await wrapper.find('.player-popup [data-confirm]').trigger('click');
    await flushPromises();
    expect(socket.emit).toHaveBeenCalledWith('kick', { slot: 's-bob' }, expect.any(Function));
    wrapper.unmount();
  });

  it('shows the others no Remove button', async () => {
    const { wrapper } = await mountGame(asBob({ hostId: 'ann' }));
    await wrapper.findAll('.score-bar button.chip-button')[0].trigger('click'); // the host
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

  it('shows the chooser a word field in the controls zone, and the next turn button at the results', async () => {
    const { wrapper, socket } = await mountGame(view({ phase: 'word' }));
    const form = wrapper.find('.controls form.word');
    expect(form.exists()).toBe(true);
    await form.find('input').setValue('Lantern');
    socket.emit.mockClear();
    await form.trigger('submit');
    expect(socket.emit).toHaveBeenCalledWith('submitWord', { word: 'Lantern' }, expect.any(Function));
    socket.handlers.state(view({ phase: 'results', results: { judging: 'favourite', winnerId: 'bob', votes: {}, tally: {}, deltas: {} }, table: [{ playerId: 'bob', cardId: 3 }] }));
    await flushPromises();
    expect(wrapper.find('.controls').text()).toContain('Next turn: Bob chooses the word');
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
    expect(status).toContain('Turn 1 of 4');
    expect(status).toContain('Round 1 of 1'); // the turn and the round it belongs to, as Scribblers shows them
    expect(status).toContain('Everyone votes');
    expect(status).toContain('Word: Dragon');
    wrapper.unmount();
  });
});

describe('Dixnt pop-ups', () => {
  const popups = () => document.body.querySelectorAll('.your-turn');
  const show = async (state) => {
    document.body.innerHTML = '';
    const game = await mountGame(state);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return game;
  };

  it('never tells anybody it is their turn: not the chooser, not the players who all go at once', async () => {
    for (const state of [
      view({ phase: 'word' }), // the chooser, with the whole table waiting on them
      asBob({ phase: 'picking' }, { myPick: null }),
      asBob({ phase: 'voting', judging: 'everyone' }, { myVote: null }),
      view({ phase: 'voting', judging: 'favourite' }, { isChooser: true, myVote: null }),
      view({ phase: 'voting', judging: 'chooser' }, { isChooser: true, myVote: null }),
    ]) {
      const game = await show(state);
      expect(popups()).toHaveLength(0);
      game.wrapper.unmount();
    }
  });

  it('tells the player who was kept in the dark what the word was, once the voting opens', async () => {
    document.body.innerHTML = '';
    const { wrapper, socket } = await mountGame(asBob({ phase: 'picking', wordHidden: true, word: null }, { myPick: 3 }));
    expect(popups()).toHaveLength(0);
    socket.handlers.state(asBob({ phase: 'voting', word: 'Dragon' }, { myPick: 3 }));
    await flushPromises();
    expect(popups()).toHaveLength(1);
    expect(popups()[0].textContent).toContain('The word is Dragon');
    // The next round is a clean slate: nothing left over to announce.
    socket.handlers.state(asBob({ phase: 'word', word: null }));
    await flushPromises();
    expect(popups()).toHaveLength(0);
    wrapper.unmount();
  });

  it('says nothing to the players who knew the word all along', async () => {
    document.body.innerHTML = '';
    const { wrapper, socket } = await mountGame(asBob({ phase: 'picking' }, { myPick: 3 }));
    socket.handlers.state(asBob({ phase: 'voting' }, { myPick: 3 }));
    await flushPromises();
    expect(popups()).toHaveLength(0);
    wrapper.unmount();
  });
});

describe('Dixnt scores', () => {
  const results = (roundOver) => ({ judging: 'favourite', winnerId: 'bob', votes: {}, tally: {}, deltas: {}, roundOver });
  const scored = (roundOver, extra = {}) =>
    view({
      phase: 'results',
      results: results(roundOver),
      table: [{ playerId: 'bob', cardId: 3 }],
      scoreboard: { ...view().scoreboard, rounds: [{ label: { key: 'turn.label', params: { n: 1 } }, deltas: {}, notes: {} }] },
      ...extra,
    });
  const modal = () => document.body.querySelector('.modal');

  it('leaves the scores alone at the end of a turn that is not the end of a round', async () => {
    document.body.innerHTML = '';
    const { wrapper, socket } = await mountGame(view({ phase: 'voting' }));
    socket.handlers.state(scored(false));
    await flushPromises();
    expect(modal()).toBeNull();
    wrapper.unmount();
  });

  it('opens them once everybody has had a turn', async () => {
    document.body.innerHTML = '';
    const { wrapper, socket } = await mountGame(view({ phase: 'voting' }));
    socket.handlers.state(scored(true));
    await flushPromises();
    expect(modal()).not.toBeNull();
    expect(modal().textContent).toContain('Scores after Turn 1');
    wrapper.unmount();
  });

  it('opens them at the end of the game, where there are no results to go by', async () => {
    document.body.innerHTML = '';
    const { wrapper, socket } = await mountGame(view({ phase: 'voting' }));
    socket.handlers.state(scored(false)); // the last turn did not close a round, so nothing opened
    await flushPromises();
    expect(modal()).toBeNull();
    socket.handlers.state(view({ phase: 'finished', results: null, players: wonBy('bob') }, { isChooser: false, hand: [], myPick: null, myVote: null, isImposter: false }));
    await flushPromises();
    expect(modal()).not.toBeNull();
    expect(modal().textContent).toContain('Final scores');
    wrapper.unmount();
  });
});

describe('Dixnt hand', () => {
  it('takes a card you have played out of your hand, and gives it back when you swap it', async () => {
    const { wrapper, socket } = await mountGame(asBob({ phase: 'picking' }, { myPick: null }));
    expect(wrapper.findAll('.hand .slot')).toHaveLength(6);
    socket.handlers.state(asBob({ phase: 'picking' }, { myPick: 3 }));
    await flushPromises();
    expect(wrapper.findAll('.hand .slot')).toHaveLength(5);
    socket.handlers.state(asBob({ phase: 'picking' }, { myPick: 5 }));
    await flushPromises();
    const left = wrapper.findAll('.hand .slot').map((slot) => slot.attributes('aria-label'));
    expect(left).toEqual(['Card 1', 'Card 2', 'Card 3', 'Card 4', 'Card 6']);
    wrapper.unmount();
  });
});
