// Achievement unlocks as they happen.  AchievementPopups.test.js checks the pop-ups a player sees; this file protects
// the feed underneath them, whose promise is that nobody loses an unlock and nobody is shown one twice: what is pending
// is asked for on every connection and every nudge from the server, an unlock already waiting is not queued again, one
// is only marked as shown once its pop-up has been seen, and a server that is away is simply asked again next time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { feed, fetchPending, shown, startFeed, stopFeed } from './achievementFeed.js';
import { session } from './sessionState.js';
import { siteSocket } from './siteFeed.js';

const reply = (body, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
const unlock = (id, level, extra = {}) => ({ id, level, game: 'Global', name: 'Played cards', text: 'Play 100 cards', coins: 1000, ...extra });

/** A site socket that remembers who is listening, as socket.io's would. */
function fake() {
  let attached = [];
  return {
    on: vi.fn((event, handler) => attached.push([event, handler])),
    off: vi.fn((event, handler) => (attached = attached.filter(([e, h]) => e !== event || h !== handler))),
    close: vi.fn(),
    /** The server says something (or the socket connects): everybody listening for `event` hears it. */
    say: (event) => attached.filter(([e]) => e === event).forEach(([, handler]) => handler()),
  };
}

let pending; // what the server says is waiting
let calls; // [method, url, body] of each request, in order
let respond; // (method, url) => a reply, or undefined to answer as the server does

beforeEach(() => {
  stopFeed();
  pending = [];
  calls = [];
  respond = () => undefined;
  Object.assign(session, { user: { id: 1, displayName: 'Ann' }, shop: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      calls.push([options.method ?? 'GET', url, options.body ? JSON.parse(options.body) : undefined]);
      const special = respond(options.method ?? 'GET', url);
      if (special) return special;
      if (url === '/api/achievements/pending') return reply({ unlocks: pending });
      if (url === '/api/shop') return reply({ balance: 1234, items: [] });
      return reply({ ok: true });
    }),
  );
});
afterEach(() => {
  stopFeed();
  Object.assign(session, { user: null, shop: null });
  vi.unstubAllGlobals();
});

const asked = (url) => calls.filter(([, u]) => u === url);

describe('fetchPending', () => {
  it('queues what the server says is waiting', async () => {
    pending = [unlock('global.cards', 1), unlock('hearts.moon', 2)];
    await fetchPending();
    expect(feed.queue).toEqual(pending);
  });

  it('does not queue an unlock that is waiting already, but does queue another level of the same achievement', async () => {
    pending = [unlock('global.cards', 1)];
    await fetchPending();
    pending = [unlock('global.cards', 1), unlock('global.cards', 2)];
    await fetchPending();
    expect(feed.queue.map(({ id, level }) => [id, level])).toEqual([
      ['global.cards', 1],
      ['global.cards', 2],
    ]);
  });

  it('refreshes the shop when something new has arrived, because the coins have changed', async () => {
    pending = [unlock('global.cards', 1)];
    await fetchPending();
    await flushPromises();
    expect(asked('/api/shop')).toHaveLength(1);
    expect(session.shop.balance).toBe(1234);
  });

  it('leaves the shop alone when nothing is waiting', async () => {
    await fetchPending();
    await flushPromises();
    expect(feed.queue).toEqual([]);
    expect(asked('/api/shop')).toHaveLength(0);
  });

  it('keeps what was waiting, and does not throw, when the server is away or signed you out', async () => {
    pending = [unlock('global.cards', 1)];
    await fetchPending();
    respond = () => reply({ error: 'signIn' }, 401);
    await expect(fetchPending()).resolves.toBeUndefined();
    respond = () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(fetchPending()).resolves.toBeUndefined();
    expect(feed.queue).toHaveLength(1);
  });

  it('does not throw for a reply that is not a list of unlocks', async () => {
    for (const body of [{}, { unlocks: null }, 'not json', null]) {
      respond = (method, url) => (url === '/api/achievements/pending' ? reply(body) : undefined);
      await expect(fetchPending(), JSON.stringify(body)).resolves.toBeUndefined();
    }
    expect(feed.queue).toEqual([]);
  });
});

describe('startFeed and stopFeed', () => {
  it("opens the site's socket and asks what is waiting on every connection and every nudge from the server", async () => {
    const socket = fake();
    startFeed(() => socket);
    expect(siteSocket()).toBe(socket);
    expect(asked('/api/achievements/pending')).toHaveLength(0);
    socket.say('connect');
    await flushPromises();
    expect(asked('/api/achievements/pending')).toHaveLength(1);
    pending = [unlock('global.cards', 1)];
    socket.say('achievements');
    await flushPromises();
    expect(feed.queue).toHaveLength(1);
    socket.say('connect'); // a reconnection asks again, in case a nudge was missed while away
    await flushPromises();
    expect(asked('/api/achievements/pending')).toHaveLength(3);
    expect(feed.queue).toHaveLength(1);
  });

  it('listens once however many times it is started', async () => {
    const socket = fake();
    const connect = vi.fn(() => socket);
    startFeed(connect);
    startFeed(connect);
    expect(connect).toHaveBeenCalledTimes(1);
    socket.say('achievements');
    await flushPromises();
    expect(asked('/api/achievements/pending')).toHaveLength(1);
  });

  it('stops listening, closes the socket, and forgets what was waiting when the player signs out', async () => {
    const socket = fake();
    startFeed(() => socket);
    pending = [unlock('global.cards', 1)];
    socket.say('achievements');
    await flushPromises();
    stopFeed();
    expect(feed.queue).toEqual([]);
    expect(socket.close).toHaveBeenCalled();
    expect(siteSocket()).toBeNull();
    const before = calls.length;
    socket.say('achievements');
    socket.say('connect');
    await flushPromises();
    expect(calls).toHaveLength(before);
  });

  it('listens again, once, after signing back in', async () => {
    startFeed(fake);
    stopFeed();
    const second = fake();
    startFeed(() => second);
    pending = [unlock('global.cards', 1)];
    second.say('achievements');
    await flushPromises();
    expect(asked('/api/achievements/pending')).toHaveLength(1);
    expect(feed.queue).toHaveLength(1);
  });

  it('can be stopped when it was never started', () => {
    expect(() => stopFeed()).not.toThrow();
  });
});

describe('shown', () => {
  it('takes those unlocks off the queue, leaves the rest waiting, and tells the server which were seen', async () => {
    pending = [unlock('global.cards', 1), unlock('global.cards', 2), unlock('hearts.moon', 1)];
    await fetchPending();
    shown([feed.queue[0], feed.queue[2]]);
    expect(feed.queue.map(({ id, level }) => [id, level])).toEqual([['global.cards', 2]]);
    expect(asked('/api/achievements/seen')).toEqual([
      [
        'POST',
        '/api/achievements/seen',
        {
          items: [
            { id: 'global.cards', level: 1 },
            { id: 'hearts.moon', level: 1 },
          ],
        },
      ],
    ]);
  });

  it('still takes them off the queue when the server cannot be told, and does not throw', async () => {
    pending = [unlock('global.cards', 1)];
    await fetchPending();
    respond = (method, url) => (url === '/api/achievements/seen' ? reply({ error: 'serverError' }, 500) : undefined);
    expect(() => shown([...feed.queue])).not.toThrow();
    await flushPromises(); // a rejection nobody caught would fail the run here
    expect(feed.queue).toEqual([]);
  });
});
