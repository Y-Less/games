import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { session } from '../session.js';
import GamesView from './GamesView.vue';

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] });

const game = (id, category, min, max, extra = {}) => ({ id, name: id.toUpperCase(), description: `About ${id}`, category, minPlayers: min, maxPlayers: max, ...extra });

const make = () => mount(GamesView, { global: { plugins: [router] } });

beforeEach(() => {
  session.user = { displayName: 'Ann' };
  session.games = [];
});

describe('GamesView', () => {
  it('greets the user by display name', () => {
    expect(make().find('h1').text()).toBe('Welcome, Ann');
  });

  it('says so when no games are installed', () => {
    const w = make();
    expect(w.text()).toContain('No games are installed yet.');
    expect(w.findAll('h2')).toHaveLength(0);
  });

  it('groups games by category in first-seen order with friendly labels', () => {
    session.games = [game('hearts', 'cards', 4, 4), game('dixnt', 'party', 3, 8), game('cribbage', 'cards', 2, 4), game('wordy', 'word', 1, 2), game('odd', 'other', 1, 1)];
    const w = make();
    expect(w.findAll('h2').map((h) => h.text())).toEqual(['Card games', 'Party games', 'Word games', 'More games']);
    const cards = w.findAll('.grid')[0];
    expect(cards.findAll('h3').map((h) => h.text())).toEqual(['HEARTS', 'CRIBBAGE']);
    expect(w.findAll('.grid')[1].findAll('h3').map((h) => h.text())).toEqual(['DIXNT']);
    expect(w.text()).not.toContain('No games are installed');
  });

  it('uses the raw key for an unknown category', () => {
    session.games = [game('x', 'puzzle', 2, 2)];
    expect(make().find('h2').text()).toBe('puzzle');
  });

  it('describes the player count as a range or a single number', () => {
    session.games = [game('a', 'cards', 3, 8), game('b', 'cards', 4, 4)];
    const meta = make().findAll('.meta').map((m) => m.text());
    expect(meta).toEqual(['3–8 players', '4 players']);
  });

  it('links each game to its play page and shows the description', () => {
    session.games = [game('nomination-whist', 'cards', 3, 7)];
    const link = make().find('a.game');
    expect(link.attributes('href')).toBe('/play/nomination-whist');
    expect(link.text()).toContain('About nomination-whist');
  });
});
