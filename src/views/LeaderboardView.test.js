// The leaderboard page: one folding table per game, sorted where the page says rather than where the server does.
// The rows below are the shape server/stats.js standings sends: the top of each order together (which is why there
// are more of them here than any one table shows), each carrying its position in all three.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterLinkStub, flushPromises, mount } from '@vue/test-utils';
import { session } from '../session.js';
import LeaderboardView from './LeaderboardView.vue';

function reply(body, status = 200) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

// Seven players whose best scores, wins and games played put them in three different orders, so that sorting a table
// of three changes who is in it and not only the order they stand in.
const BOARD_URL = '/api/leaderboard';
const PLAYERS = [
  { userId: 1, name: 'Ann', played: 5, wins: 4, bestScore: 90, rank: { bestScore: 1, wins: 4, played: 4 } },
  { userId: 2, name: 'Bob', played: 6, wins: 3, bestScore: 80, rank: { bestScore: 2, wins: 5, played: 3 } },
  { userId: 3, name: 'Cat', played: 9, wins: 2, bestScore: 70, rank: { bestScore: 3, wins: 6, played: 2 } },
  { userId: 4, name: 'Dan', played: 4, wins: 9, bestScore: 10, rank: { bestScore: 4, wins: 1, played: 5 } },
  { userId: 5, name: 'Eve', played: 3, wins: 8, bestScore: 9, rank: { bestScore: 5, wins: 2, played: 6 } },
  { userId: 6, name: 'Fay', played: 20, wins: 7, bestScore: 8, rank: { bestScore: 6, wins: 3, played: 1 } },
  { userId: 7, name: 'Gus', played: 1, wins: 0, bestScore: null, rank: { bestScore: 7, wins: 7, played: 7 } },
];
const BOARD = { top: 3, games: [{ game: 'hearts', name: 'Hearts', players: PLAYERS }, { game: 'dixnt', name: 'Dixnt', players: PLAYERS.slice(0, 2) }] };

let fetchMock;
let wrapper;

// The page's own request, and the one StyledName makes in the background for everybody's name style.
const serve = (board = BOARD) => fetchMock.mockImplementation(async (url) => reply(url === BOARD_URL ? board : { players: {} }));
/** How many times the page has asked for the standings (the name-style request is not one of them). */
const boardRequests = () => fetchMock.mock.calls.filter(([url]) => url === BOARD_URL).length;

async function make() {
  wrapper = mount(LeaderboardView, { global: { stubs: { RouterLink: RouterLinkStub } } });
  await flushPromises();
  return wrapper;
}

/** The first game's panel. */
const panel = () => wrapper.findAll('.collapsible')[0];
/** The names in the first game's table, top to bottom. */
const names = () => panel().findAll('tbody tr').map((row) => row.findAll('td')[1].text());
/** The positions down the left of the first game's table. */
const places = () => panel().findAll('tbody tr').map((row) => row.findAll('td')[0].text());
/** Presses the heading that sorts by `column` in the first game's table. */
const sortBy = (column) => panel().findAll('thead th button')[['played', 'wins', 'bestScore'].indexOf(column)].trigger('click');

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  session.user = { id: 7, displayName: 'Gus' };
  serve();
});
afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
});

describe('LeaderboardView', () => {
  it('shows a loading message before the API answers', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    wrapper = mount(LeaderboardView, { global: { stubs: { RouterLink: RouterLinkStub } } });
    expect(wrapper.text()).toContain('Loading');
  });

  it('says so when the API refuses', async () => {
    fetchMock.mockImplementation(async () => reply({ error: 'notFound' }, 404));
    await make();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });

  it('says so when nobody has finished a game yet', async () => {
    serve({ top: 10, games: [] });
    await make();
    expect(wrapper.text()).toContain('Nobody has finished a game yet');
    expect(wrapper.findAll('.collapsible')).toHaveLength(0);
  });

  it('opens with a folded-up panel per game, named after it, and asks the server once', async () => {
    await make();
    expect(boardRequests()).toBe(1);
    expect(wrapper.findAll('.collapsible')).toHaveLength(2);
    expect(wrapper.findAll('.collapsible h2').map((h) => h.text())).toEqual(['Hearts', 'Dixnt']);
    expect(wrapper.findAll('.collapsible h2 button').map((b) => b.attributes('aria-expanded'))).toEqual(['false', 'false']);
    expect(panel().find('header').text()).toContain('Ann leads'); // the top of the order it opens in, shut or open
  });

  it('starts sorted by best score, showing that order’s top three', async () => {
    await make();
    expect(names()).toEqual(['Ann', 'Bob', 'Cat', 'Gus']);
    expect(places()).toEqual(['1', '2', '3', '7']);
    expect(panel().findAll('thead th').map((h) => h.attributes('aria-sort'))).toEqual([undefined, undefined, 'none', 'none', 'descending']);
  });

  it('sorting by another column brings in the players that order favours, and drops the ones it does not', async () => {
    await make();
    await sortBy('wins');
    expect(names()).toEqual(['Dan', 'Eve', 'Fay', 'Gus']);
    expect(places()).toEqual(['1', '2', '3', '7']);
    await sortBy('played');
    expect(names()).toEqual(['Fay', 'Cat', 'Bob', 'Gus']);
    expect(places()).toEqual(['1', '2', '3', '7']);
    expect(panel().findAll('thead th').map((h) => h.attributes('aria-sort'))).toEqual([undefined, undefined, 'descending', 'none', 'none']);
    expect(boardRequests()).toBe(1); // all of that from the rows already here
  });

  it('sorts one game without touching another', async () => {
    await make();
    await sortBy('wins');
    expect(names()).toEqual(['Dan', 'Eve', 'Fay', 'Gus']);
    expect(wrapper.findAll('.collapsible')[1].findAll('tbody tr').map((row) => row.findAll('td')[1].text())).toEqual(['Ann', 'Bob']);
  });

  it('keeps you in the table however far down you are, and does not list you twice when you are up there', async () => {
    await make();
    expect(names().at(-1)).toBe('Gus');
    expect(panel().findAll('tbody tr').at(-1).classes()).toContain('me');

    wrapper.unmount();
    session.user = { id: 1, displayName: 'Ann' };
    await make();
    expect(names()).toEqual(['Ann', 'Bob', 'Cat']); // she is in the top three already
    await sortBy('wins');
    expect(names()).toEqual(['Dan', 'Eve', 'Fay', 'Ann']); // and not by that measure
    expect(places().at(-1)).toBe('4');
  });

  it('shows each row’s figures, with a dash where a game has no score', async () => {
    await make();
    const gus = panel().findAll('tbody tr').at(-1).findAll('td');
    expect(gus.map((cell) => cell.text())).toEqual(['7', 'Gus', '1', '0', '—']);
    const ann = panel().findAll('tbody tr')[0].findAll('td');
    expect(ann.map((cell) => cell.text())).toEqual(['1', 'Ann', '5', '4', '90']);
  });

  it('every name leads to that player’s statistics', async () => {
    await make();
    expect(panel().findAllComponents(RouterLinkStub).map((link) => link.props('to'))).toEqual([
      { name: 'stats', params: { who: '1' } },
      { name: 'stats', params: { who: '2' } },
      { name: 'stats', params: { who: '3' } },
      { name: 'stats', params: { who: '7' } },
    ]);
  });
});
