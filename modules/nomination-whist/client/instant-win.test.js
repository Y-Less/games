// The instant win on a 7, as the client shows it: the lobby option, the final pop-up and the scoreboard.
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import * as game from '../game.js';
import Final from './Final.vue';
import Lobby from './Lobby.vue';
import RoundResult from './RoundResult.vue';
import Table from './Table.vue';

const makeSend = () => vi.fn(() => Promise.resolve({ ok: true }));
const checkbox = (w, text) => w.findAll('label.check').find((l) => l.text().includes(text)).find('input');

/** A started 3-seat game (the viewer, user 1, is seat 0) that ended in round 1 with seat `winner` taking all 7 tricks after nominating 7. */
function instantView({ winner = 0, you = 1 } = {}) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  game.setSettings(room, 1, { seats: 3 });
  game.addHuman(room, 2, 'Bob');
  game.fillWithBots(room, 1);
  expect(game.start(room, 1, () => 0.3).ok).toBe(true);
  const bids = [1, 2, 0];
  const taken = [0, 0, 0];
  bids[winner] = 7;
  taken[winner] = 7;
  const points = bids.map((bid, seat) => game.scoreRound(bid, taken[seat], room.settings));
  room.history.push({ round: 1, cards: 7, trump: 'H', dealer: room.dealer, bids, taken, points, instantWin: winner });
  room.scores = points;
  room.instantWin = winner;
  room.winners = [winner];
  room.phase = 'finished';
  return game.viewFor(room, you);
}

describe('the instant win lobby option', () => {
  const lobby = (state, send = makeSend()) => mount(Lobby, { props: { state, send } });
  const lobbyState = (viewer = 1, settings = {}) => {
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings });
    game.addHuman(room, 2, 'Bob');
    return game.viewFor(room, viewer);
  };

  it('is shown on by default and the host can switch it off and on', async () => {
    const send = makeSend();
    const w = lobby(lobbyState(), send);
    expect(w.text()).toContain('Instant win on a 7');
    const box = checkbox(w, 'Instant win on a 7');
    expect(box.element.checked).toBe(true);
    await box.setValue(false);
    expect(send).toHaveBeenLastCalledWith('settings', { instantWin: false });
    await box.setValue(true);
    expect(send).toHaveBeenLastCalledWith('settings', { instantWin: true });
  });

  it('shows the option off when the host has turned it off', () => {
    expect(checkbox(lobby(lobbyState(1, { instantWin: false })), 'Instant win').element.checked).toBe(false);
  });

  it('treats a saved game without the setting as on', () => {
    const state = lobbyState();
    delete state.settings.instantWin;
    expect(checkbox(lobby(state), 'Instant win').element.checked).toBe(true);
  });

  it('is disabled for a guest', () => {
    expect(checkbox(lobby(lobbyState(2)), 'Instant win').attributes('disabled')).toBeDefined();
  });
});

describe('after an instant win', () => {
  it('the final panel names the instant winner, explains it and ranks the others by their totals', () => {
    const w = mount(Final, { props: { state: instantView({ winner: 2 }), send: makeSend() } });
    expect(w.find('h2').text()).toContain('wins instantly');
    expect(w.text()).toContain('nominated 7 and won all 7 tricks');
    const rows = w.findAll('ol.standings li');
    expect(rows).toHaveLength(3);
    expect(rows[0].classes()).toContain('win');
    expect(rows[0].find('.place').text()).toBe('1');
    expect(rows.map((r) => r.find('.place').text())).toEqual(['1', '2', '2']);
  });

  it('tells the winner it is a win for them', () => {
    const w = mount(Final, { props: { state: instantView({ winner: 0 }), send: makeSend() } });
    expect(w.text()).toContain('that is a win for you');
    expect(w.find('h2').text()).toContain('Ann');
  });

  it('an ordinary finish is unchanged', () => {
    const state = instantView({ winner: 0 });
    state.instantWin = null;
    const w = mount(Final, { props: { state, send: makeSend() } });
    expect(w.find('h2').text()).toContain('Ann wins!');
    expect(w.text()).not.toContain('instantly');
  });

  it('the round table marks the instant win', () => {
    const state = instantView({ winner: 1 });
    const w = mount(RoundResult, { props: { round: state.rounds[0], seats: state.seats, you: 0 } });
    expect(w.text()).toContain('instant win!');
  });

  it('the scoreboard pop-up says who won instantly and still lists every round', async () => {
    window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const state = instantView({ winner: 1 });
    const w = mount(Table, { props: { state, send: makeSend() }, attachTo: document.body });
    expect(w.text()).toContain('instant win'); // the chip beside the name
    await w.findAll('button').find((b) => b.text() === 'All rounds').trigger('click');
    const popup = document.body.querySelector('.instant-note');
    expect(popup.textContent).toContain('Bob wins the game instantly');
    expect(popup.textContent).toContain('Round 1: 7 cards, hearts');
    expect(document.body.textContent).toContain('Scores so far');
    expect(document.body.textContent).toContain('exactly right');
    w.unmount();
  });
});
