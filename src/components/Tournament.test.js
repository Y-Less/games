// The three screens a tournament has, and the bar above the games it opens.  They are the site's rather than any
// game's — a tournament holds more people than the game it is a tournament of has seats for, and nothing is played
// in the room it is run from — so what is asserted here is what the *player* is shown and what the host's buttons
// ask for, not how any game draws a lobby.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import TournamentBar from './TournamentBar.vue';
import TournamentBoard from './TournamentBoard.vue';
import TournamentLobby from './TournamentLobby.vue';
import TournamentSetup from './TournamentSetup.vue';

/** A tournament block as the server sends one, with whatever this test is about changed. */
const block = (extra = {}) => ({
  on: true,
  humans: 2,
  bots: 2,
  size: 4,
  phase: 'lobby',
  parent: 'boss-aware-you',
  here: null,
  round: 1,
  rounds: 3,
  entrants: [
    { id: 1, name: 'Ann', slot: 's0', isHost: true, isMe: true },
    { id: 2, name: 'Bo', slot: 's1', isHost: false, isMe: false },
  ],
  standings: [],
  tables: [],
  last: [],
  yourTable: null,
  tablesInAll: 1,
  limits: { min: 3, max: 7, maxEntrants: 16 },
  ...extra,
});

describe('the offer of a tournament', () => {
  it('lets the host switch it on, and says what it would mean', () => {
    const w = mount(TournamentSetup, { props: { tournament: block({ on: false }), isHost: true } });
    expect(w.text()).toContain('every combination has played once');
    w.find('input[type="checkbox"]').setValue(true);
    expect(w.emitted('change')).toEqual([[{ on: true }]]);
  });

  it('shows everybody else what the host could do, without letting them do it', () => {
    const w = mount(TournamentSetup, { props: { tournament: block({ on: false }), isHost: false } });
    expect(w.find('input[type="checkbox"]').attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('Only the host');
  });
});

describe('a tournament lobby', () => {
  it('names everybody who has come, and how many games the evening would be', () => {
    const w = mount(TournamentLobby, { props: { tournament: block(), code: 'boss-aware-you', isHost: true } });
    expect(w.text()).toContain('Ann');
    expect(w.text()).toContain('Bo');
    // Two people in pairs is one game; the line says so before anybody starts it.
    expect(w.text()).toContain('1 game in all');
  });

  it('changes the table a game is played at, one number at a time', () => {
    const w = mount(TournamentLobby, { props: { tournament: block(), code: 'boss-aware-you', isHost: true } });
    const buttons = w.findAll('button');
    buttons.find((b) => b.attributes('aria-label') === 'More people').trigger('click');
    buttons.find((b) => b.attributes('aria-label') === 'Fewer computer players').trigger('click');
    expect(w.emitted('change')).toEqual([[{ humans: 3 }], [{ bots: 1 }]]);
  });

  it('will not take the table outside what the game itself allows', () => {
    // The game is for three to seven, and two people are already at the table: at most five computer players, and at
    // least one, or the game could not be dealt.
    const w = mount(TournamentLobby, { props: { tournament: block({ bots: 5 }), code: 'boss-aware-you', isHost: true } });
    const button = (label) => w.findAll('button').find((b) => b.attributes('aria-label') === label);
    expect(button('More computer players').attributes('disabled')).toBeDefined();
    const fewest = mount(TournamentLobby, { props: { tournament: block({ bots: 1 }), code: 'boss-aware-you', isHost: true } });
    expect(fewest.findAll('button').find((b) => b.attributes('aria-label') === 'Fewer computer players').attributes('disabled')).toBeDefined();
  });

  it('waits for a second person before it can be started', () => {
    const alone = block({ entrants: [{ id: 1, name: 'Ann', slot: 's0', isHost: true, isMe: true }] });
    const w = mount(TournamentLobby, { props: { tournament: alone, code: 'boss-aware-you', isHost: true } });
    const start = w.findAll('button').find((b) => b.text() === 'Start the tournament');
    expect(start.attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('at least 2 people');
  });

  it('gives the host the way back out of it', () => {
    const w = mount(TournamentLobby, { props: { tournament: block(), code: 'boss-aware-you', isHost: true } });
    w.find('input[type="checkbox"]').setValue(false);
    expect(w.emitted('change')).toEqual([[{ on: false }]]);
  });
});

describe('a tournament being played', () => {
  const running = (extra = {}) =>
    block({
      phase: 'tournament',
      tables: [
        { code: 'a-b-c', done: false, yours: true, players: [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bo' }] },
        { code: 'd-e-f', done: true, yours: false, players: [{ id: 3, name: 'Cal' }, { id: 4, name: 'Di' }] },
      ],
      yourTable: 'a-b-c',
      standings: [{ id: 1, name: 'Ann', played: 1, wins: 1, places: 1, score: 0, place: 1 }],
      ...extra,
    });

  it('offers the way into your own game, and says who else is playing what', () => {
    const w = mount(TournamentBoard, { props: { tournament: running() } });
    expect(w.text()).toContain('Round 1 of 3');
    expect(w.text()).toContain('Cal — Di');
    w.findAll('button').find((b) => b.text() === 'Go to your game').trigger('click');
    expect(w.emitted('go')).toEqual([['a-b-c']]);
  });

  it('says so when the numbers leave you sitting a round out', () => {
    const w = mount(TournamentBoard, { props: { tournament: running({ yourTable: null, tables: [{ code: 'd-e-f', done: false, yours: false, players: [{ id: 3, name: 'Cal' }, { id: 4, name: 'Di' }] }] }) } });
    expect(w.text()).toContain('sitting this round out');
  });

  it('waits, rather than offering anything, once your own game is done', () => {
    const w = mount(TournamentBoard, { props: { tournament: running({ yourTable: null, tables: [{ code: 'a-b-c', done: true, yours: true, players: [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bo' }] }] }) } });
    expect(w.text()).toContain('Waiting for the other games');
    expect(w.findAll('button').length).toBe(0);
  });

  it('shows the final standings when every combination has played', () => {
    const w = mount(TournamentBoard, { props: { tournament: running({ phase: 'finished', tables: [], last: [{ code: 'a-b-c', done: true, yours: true, players: [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bo' }] }] }) } });
    expect(w.text()).toContain('That is the tournament');
    expect(w.text()).toContain('The last round');
    expect(w.find('.standings').text()).toContain('Ann');
  });

  it('says plainly when a game nobody finished was given up on', () => {
    const w = mount(TournamentBoard, { props: { tournament: running({ tables: [{ code: 'd-e-f', done: true, failed: 'gone', yours: false, players: [{ id: 3, name: 'Cal' }, { id: 4, name: 'Di' }] }] }) } });
    expect(w.text()).toContain('Nobody finished it');
  });
});

describe('the bar above a tournament game', () => {
  it('offers the way back to the tournament while the game is being played', () => {
    const w = mount(TournamentBar, { props: { tournament: block({ phase: 'tournament', here: 'a-b-c', yourTable: 'a-b-c' }) } });
    expect(w.text()).toContain('Round 1 of 3');
    w.find('button').trigger('click');
    expect(w.emitted('go')).toEqual([['boss-aware-you']]);
  });

  it('offers the next game instead, once the tournament has moved on without you', () => {
    // Nobody is ever moved: somebody reading the end of the game they just played is offered the next one, and takes
    // it when they are ready.
    const w = mount(TournamentBar, { props: { tournament: block({ phase: 'tournament', here: 'a-b-c', round: 2, yourTable: 'g-h-i' }) } });
    expect(w.find('button').text()).toBe('Your next game is ready');
    w.find('button').trigger('click');
    expect(w.emitted('go')).toEqual([['g-h-i']]);
  });

  it('offers nothing when the tournament itself has been forgotten', () => {
    const w = mount(TournamentBar, { props: { tournament: { on: true, parent: 'boss-aware-you', lost: true, here: 'a-b-c' } } });
    expect(w.findAll('button').length).toBe(0);
    expect(w.text()).toContain('Tournament');
  });
});
