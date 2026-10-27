// The Jokers option as the client shows it: the lobby setting, the cards in the hand and the log of what happened.
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import * as game from '../game.js';
import { movesBetween } from './log.js';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

const send = () => vi.fn(() => Promise.resolve({ ok: true }));
const checkbox = (w, text) => w.findAll('label.check').find((l) => l.text().includes(text)).find('input');

describe('the Jokers lobby option', () => {
  const lobbyState = (viewer = 1, settings = {}) => {
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings });
    game.addHuman(room, 2, 'Bob');
    return game.viewFor(room, viewer);
  };

  it('is off by default; the host can switch it on and off', async () => {
    const s = send();
    const w = mount(Lobby, { props: { state: lobbyState(), send: s } });
    const box = checkbox(w, 'Jokers');
    expect(box.element.checked).toBe(false);
    expect(w.text()).toContain('the other Joker is played in the same trick');
    await box.setValue(true);
    expect(s).toHaveBeenLastCalledWith('settings', { jokers: true });
    await box.setValue(false);
    expect(s).toHaveBeenLastCalledWith('settings', { jokers: false });
  });

  it('shows the host\'s choice to everybody, and only the host can change it', () => {
    const guest = mount(Lobby, { props: { state: lobbyState(2, { jokers: true }), send: send() } });
    const box = checkbox(guest, 'Jokers');
    expect(box.element.checked).toBe(true);
    expect(box.element.disabled).toBe(true);
  });
});

describe('Jokers on the table', () => {
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  it('are drawn in the hand as Jokers', () => {
    let s = 5;
    const rng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 3, jokers: true } });
    game.fillWithBots(room, 1);
    game.start(room, 1, rng);
    room.hands[0] = ['JK1', 'JK2', ...room.hands[0].slice(0, room.hands[0].length - 2)];
    const w = mount(Table, { props: { state: game.viewFor(room, 1), send: send() }, attachTo: document.body });
    const jokers = w.findAll('.hand .playing-card.joker');
    expect(jokers).toHaveLength(2);
    expect(jokers.map((j) => j.attributes('aria-label')).sort()).toEqual(['black joker', 'red joker']);
    w.unmount();
  });
});

describe('the log of a trick with Jokers', () => {
  const seats = [0, 1, 2].map((i) => ({ name: `P${i}`, bid: 1 }));
  const base = { code: 'x', phase: 'playing', round: { number: 1, cards: 3, trump: 'H' }, seats };
  const trickWith = (cards, winner) => ({ ...base, trick: cards.map((card, i) => ({ seat: i, card })), trickWinner: winner });
  const before = (cards) => trickWith(cards.slice(0, 2), null);

  it('says that two Jokers cancel out', () => {
    const lines = movesBetween(before(['5H', 'JK1']), trickWith(['5H', 'JK1', 'JK2'], 0)).map((m) => m.text);
    expect(lines).toContain('P2 played a Joker.');
    expect(lines).toContain('Both Jokers were played, so they cancel out.');
    expect(lines).toContain('P0 won the trick.');
  });

  it('says that the second Joker beats a Joker that led', () => {
    const lines = movesBetween(before(['JK1', '5H']), trickWith(['JK1', '5H', 'JK2'], 2)).map((m) => m.text);
    expect(lines).toContain('The second Joker beats the Joker that led.');
    expect(lines).toContain('P2 won the trick.');
  });

  it('has nothing to say about Jokers when there is just one', () => {
    const lines = movesBetween(before(['5H', 'JK1']), trickWith(['5H', 'JK1', '2H'], 1)).map((m) => m.text);
    expect(lines.some((l) => /cancel|second Joker/.test(l))).toBe(false);
  });
});
