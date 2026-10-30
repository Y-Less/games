import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { session } from '../session.js';
import StatsView from './StatsView.vue';

function reply(body, status = 200) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

const summary = { played: 12, wins: 5, losses: 6, draws: 1, winRate: 0.4166 };
const perGame = [
  {
    game: 'hearts', name: 'Hearts', played: 8, wins: 3, losses: 5, draws: 0, winRate: 0.375, totalScore: 120, bestScore: 4,
    extras: [{ key: 'moons', label: 'Times shot the moon', value: 2 }],
  },
  { game: 'dixnt', name: 'Dixnt', played: 4, wins: 2, losses: 1, draws: 1, winRate: 0.5, totalScore: null, bestScore: null, extras: [] },
];
const recent = [
  { finishedAt: Date.UTC(2026, 2, 15, 12, 0), name: 'Hearts', outcome: 'win', players: 4, score: 12 },
  { finishedAt: Date.UTC(2026, 2, 14, 12, 0), name: 'Dixnt', outcome: 'draw', players: 5, score: null },
  { finishedAt: Date.UTC(2026, 2, 13, 12, 0), name: 'Hearts', outcome: 'loss', players: 4, score: 30 },
];
const boards = {
  hearts: [{ userId: 1, name: 'Ann', wins: 3, played: 8 }, { userId: 2, name: 'Bob', wins: 2, played: 6 }],
  dixnt: [],
};

let fetchMock;
let wrapper;

function serve(stats = { summary, perGame, recent }) {
  fetchMock.mockImplementation(async (url) => {
    if (url === '/api/stats/me') return reply(stats);
    const game = /leaderboard\/(.+)$/.exec(url)?.[1];
    return reply({ leaderboard: boards[game] ?? [] });
  });
}

async function make() {
  wrapper = mount(StatsView);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  session.user = { id: 1, displayName: 'Ann' };
});
afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
});

describe('StatsView', () => {
  it('shows a loading message before the API answers', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    wrapper = mount(StatsView);
    expect(wrapper.text()).toContain('Loading');
    expect(wrapper.find('h1').text()).toBe('Statistics for Ann');
  });

  it('renders the total tiles with a rounded win rate', async () => {
    serve();
    const w = await make();
    const tiles = w.findAll('.tile').map((t) => [t.find('span').text(), t.find('strong').text()]);
    expect(tiles).toEqual([['Games played', '12'], ['Wins', '5'], ['Losses', '6'], ['Draws', '1'], ['Win rate', '42%']]);
  });

  it('hides the Draws tile when there are none', async () => {
    serve({ summary: { ...summary, draws: 0 }, perGame, recent });
    const w = await make();
    expect(w.findAll('.tile').map((t) => t.find('span').text())).not.toContain('Draws');
  });

  it('renders per-game tables with extras, hiding unavailable scores', async () => {
    serve();
    const w = await make();
    const panels = w.findAll('.panel.stack').filter((p) => p.find('h2').exists() && p.find('h2').text() !== 'Recent games');
    expect(panels.map((p) => p.find('h2').text())).toEqual(['Hearts', 'Dixnt']);
    const rows = (p) => p.findAll('tr').map((r) => [r.find('th').text(), r.find('td').text()]);
    expect(rows(panels[0])).toEqual([
      ['Played', '8'], ['Won / lost', '3 / 5'], ['Win rate', '38%'], ['Total score', '120'], ['Best score', '4'], ['Times shot the moon', '2'],
    ]);
    expect(rows(panels[1])).toEqual([['Played', '4'], ['Won / lost / drawn', '2 / 1 / 1'], ['Win rate', '50%']]);
  });

  it('leaves out the statistics a game keeps behind the scenes', async () => {
    serve({ summary, perGame: [{ ...perGame[0], extras: [{ key: 'moons', label: 'Times shot the moon', value: 2 }, { key: 'secret', label: 'Secret', value: 9, hidden: true }] }], recent: [] });
    const w = await make();
    expect(w.text()).toContain('Times shot the moon');
    expect(w.text()).not.toContain('Secret');
  });

  it('shows total score of zero (not null)', async () => {
    serve({ summary, perGame: [{ ...perGame[0], totalScore: 0, bestScore: 0, extras: [] }], recent: [] });
    const w = await make();
    expect(w.text()).toContain('Total score');
    expect(w.text()).toContain('Best score');
  });

  it('requests each game leaderboard and highlights me', async () => {
    serve();
    const w = await make();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/stats/me', '/api/stats/leaderboard/hearts', '/api/stats/leaderboard/dixnt']);
    const rows = w.findAll('ol.board li');
    expect(rows.map((r) => r.text())).toEqual(['Ann 3 won from 8', 'Bob 2 won from 6']);
    expect(rows.map((r) => r.classes('me'))).toEqual([true, false]);
    expect(w.findAll('h3').map((h) => h.text())).toEqual(['Most wins']);
  });

  it('lists recent games with outcome labels and scores', async () => {
    serve();
    const w = await make();
    const panel = w.findAll('.panel.stack').find((p) => p.find('h2').text() === 'Recent games');
    const rows = panel.findAll('tr').map((r) => r.findAll('td').map((c) => c.text()));
    expect(rows[0][0]).toContain('15 Mar 2026');
    expect(rows.map((r) => r.slice(1))).toEqual([
      ['Hearts', 'Won', '4 players, 12 points'],
      ['Dixnt', 'Drew', '5 players'],
      ['Hearts', 'Lost', '4 players, 30 points'],
    ]);
    expect(panel.findAll('tr').map((r) => r.findAll('td')[2].classes())).toEqual([['win'], ['draw'], ['loss']]);
  });

  it('shows the empty state when no games are finished', async () => {
    serve({ summary: { played: 0, wins: 0, losses: 0, draws: 0, winRate: 0 }, perGame: [], recent: [] });
    const w = await make();
    expect(w.text()).toContain("You haven't finished a game yet.");
    expect(w.text()).toContain('0%');
    expect(w.text()).not.toContain('Recent games');
  });

  it('shows the error state and no tiles when the API fails', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'The statistics are unavailable.' }, 500));
    const w = await make();
    expect(w.find('[role="alert"]').text()).toBe('The statistics are unavailable.');
    expect(w.find('.tile').exists()).toBe(false);
    expect(w.text()).not.toContain('Loading');
  });

  it('shows a generic error for a non-JSON failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => '<html>Bad gateway</html>' });
    const w = await make();
    expect(w.find('[role="alert"]').text()).toBe('Something went wrong (502).');
  });
});
