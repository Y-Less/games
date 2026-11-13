// The page that hosts one game module.  Every game on the site is reached through it, and the game's own code never
// sees any of this, so what is protected is what the view's header promises a module: a connected socket for its own
// namespace, the signed-in user, the address's query string and a way to change it without a reload, and its own id
// provided to everything drawn inside (so its words are found).  Around the game: the header gets the game's title and
// Help button and loses them again, a game the site does not have says so instead of connecting, and a player whose
// session has ended is sent to sign in and brought back.
//
// The socket is a stand-in, and one real module's entry point (Hearts) is replaced by a small component that shows what
// it was given, so this is the shell on its own and no game's code runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

const sockets = []; // every socket opened, with the namespace it was opened for
vi.mock('socket.io-client', () => ({
  io: vi.fn((namespace) => {
    const handlers = {};
    const socket = { namespace, connected: false, on: vi.fn((event, handler) => (handlers[event] = handler)), off: vi.fn(), emit: vi.fn(), close: vi.fn(), say: (event, ...args) => handlers[event]?.(...args) };
    sockets.push(socket);
    return socket;
  }),
}));
vi.mock('../../modules/hearts/client/index.js', async () => {
  const { h, inject } = await import('vue');
  const { GAME_ID } = await import('../useGameText.js');
  return {
    __esModule: true, // so that Vue's async loader takes the default export, as it does from the real file
    default: {
      name: 'StandInGame',
      props: { socket: { type: Object, default: null }, user: { type: Object, default: null }, search: { type: String, default: '' }, setSearch: { type: Function, default: null } },
      setup(props) {
        const game = inject(GAME_ID, null);
        return () => h('div', { class: 'stand-in-game' }, `${game} for ${props.user?.displayName} with ${props.search}`);
      },
    },
  };
});

const { session } = await import('../session.js');
const { playBar } = await import('../playBar.js');
const { i18n } = await import('../i18n.js');
const { default: HelpDialog } = await import('../components/HelpDialog.vue');
const { default: PlayView } = await import('./PlayView.vue');

const USER = { id: 1, displayName: 'Ann', avatar: null };
const reply = (text, status = 200) => ({ ok: status === 200, status, text: async () => text });

let wrapper;
let router;
beforeEach(() => {
  sockets.length = 0;
  window.history.replaceState(null, '', '/play/hearts');
  Object.assign(session, { user: USER, games: [{ id: 'hearts', name: 'Hearts', description: 'A trick-taking game.' }], shop: null });
  vi.stubGlobal('fetch', vi.fn(async () => reply('# Rules\n\nAvoid the hearts.')));
  // jsdom has no ResizeObserver, which the view's fit-to-window needs to exist (useFrameFit.test.js is where it is tested).
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  Object.assign(session, { user: null, games: [], shop: null });
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

/**
 * Opens the play page for a game.
 * @param {string} [game]  the module id from the route
 * @returns {Promise<import('@vue/test-utils').VueWrapper>}
 */
async function open(game = 'hearts') {
  const nothing = { render: () => null };
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/play/:game', name: 'play', component: nothing },
      { path: '/login', name: 'login', component: nothing },
      { path: '/:rest(.*)*', component: nothing },
    ],
  });
  router.push(`/play/${game}${window.location.search}`);
  await router.isReady();
  wrapper = mount(PlayView, { props: { game }, global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}
/** The stand-in game, once the page has loaded it. */
const game = async () => {
  await vi.waitFor(() => expect(wrapper.find('.stand-in-game').exists()).toBe(true), { timeout: 20000 }); // a condition, not a delay: it returns as soon as it holds
  return wrapper.findComponent({ name: 'StandInGame' });
};

describe('PlayView', () => {
  it("opens a socket on the game's own namespace, and says it is connecting until it is", async () => {
    await open();
    expect(sockets.map((socket) => socket.namespace)).toEqual(['/hearts']);
    expect(wrapper.text()).toContain(i18n.global.t('play.connecting'));
    sockets[0].say('connect');
    await flushPromises();
    expect(wrapper.text()).not.toContain(i18n.global.t('play.connecting'));
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('shows the game once it is connected', async () => {
    await open();
    await game();
    sockets[0].say('connect');
    await flushPromises();
    expect(wrapper.find('.field-frame').isVisible()).toBe(true);
    expect(wrapper.find('.stand-in-game').isVisible()).toBe(true);
  });

  it('gives the game its socket, the signed-in user, the query string, and its own id', async () => {
    window.history.replaceState(null, '', '/play/hearts?boss-aware-you');
    await open();
    const drawn = await game();
    expect(drawn.props('socket')).toBe(sockets[0]);
    expect(drawn.props('user')).toEqual(USER);
    expect(drawn.props('search')).toBe('?boss-aware-you');
    expect(drawn.text()).toBe('hearts for Ann with ?boss-aware-you'); // the id was provided, not passed
  });

  it('lets the game change the query string without reloading: a room code in, with or without its "?", and out again', async () => {
    await open();
    const { setSearch } = (await game()).props();
    setSearch('boss-aware-you');
    expect(window.location.pathname + window.location.search).toBe('/play/hearts?boss-aware-you');
    setSearch('?x-y-z');
    expect(window.location.pathname + window.location.search).toBe('/play/hearts?x-y-z');
    setSearch('');
    expect(window.location.pathname + window.location.search).toBe('/play/hearts');
  });

  it("puts the game's title and Help in the site header, and takes them away when the page goes", async () => {
    await open();
    expect(playBar.game.name).toBe('Hearts');
    expect(typeof playBar.game.openRules).toBe('function');
    wrapper.unmount();
    wrapper = null;
    expect(playBar.game).toBeNull();
  });

  it("opens the game's rules from the header's Help button, and closes them again", async () => {
    await open();
    expect(wrapper.findComponent(HelpDialog).exists()).toBe(false);
    await playBar.game.openRules();
    await flushPromises();
    expect(fetch.mock.calls[0][0]).toContain('/api/games/hearts/rules');
    const help = wrapper.findComponent(HelpDialog);
    expect(help.find('h1, h2, h3, h4').text()).toBe('Rules'); // rendered, not shown as "# Rules" (which level is markdown.js's business)
    expect(help.text()).toContain('Avoid the hearts.');
    help.vm.$emit('close');
    await flushPromises();
    expect(wrapper.findComponent(HelpDialog).exists()).toBe(false);
  });

  it('says a game the site does not have is not available, and connects to nothing', async () => {
    await open('no-such-game');
    expect(wrapper.find('[role="alert"]').text()).toBe(i18n.global.t('play.unavailable'));
    expect(sockets).toEqual([]);
    expect(playBar.game).toBeNull();
    expect(wrapper.find('.field-frame').exists()).toBe(false);
  });

  it('says the same of a module that exists but is not in the list of games the server gave', async () => {
    session.games = [];
    await open('hearts');
    expect(wrapper.find('[role="alert"]').text()).toBe(i18n.global.t('play.unavailable'));
    expect(sockets).toEqual([]);
  });

  it('sends a player whose session has ended to sign in, and remembers where to bring them back to', async () => {
    window.history.replaceState(null, '', '/play/hearts?boss-aware-you');
    await open();
    sockets[0].say('connect_error', new Error('Please sign in.'));
    await flushPromises();
    expect(session.user).toBeNull();
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.next).toBe('/play/hearts?boss-aware-you');
  });

  it('says it cannot reach the game for any other failure, and says nothing once it is through', async () => {
    await open();
    sockets[0].say('connect_error', new Error('xhr poll error'));
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe(i18n.global.t('play.unreachable'));
    expect(session.user).toEqual(USER);
    expect(router.currentRoute.value.name).toBe('play');
    sockets[0].say('connect');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('closes the socket when the page goes', async () => {
    await open();
    wrapper.unmount();
    wrapper = null;
    expect(sockets[0].close).toHaveBeenCalled();
  });
});
