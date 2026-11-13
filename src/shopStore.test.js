// The shop as the client knows it: the listing, your coins, what you own, and buying.  ShopView.test.js goes through
// these by clicking; this file holds the store's own promises, which other parts of the site lean on without a shop
// page in sight (the profile's locks, the coin balance after an achievement): nothing is locked before the listing has
// arrived, a failed refresh leaves the balance and locks as they were, and a refused purchase says why.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from './sessionState.js';
import { buy, owns, refreshShop } from './shopStore.js';

const reply = (body, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
const LISTING = {
  balance: 700,
  items: [
    { id: 'ns:plain', type: 'name-style', name: 'Plain', price: 0, owned: true },
    { id: 'ns:gold', type: 'name-style', name: 'Gold', price: 800, owned: false },
  ],
};

let calls; // [method, url, body] of each request, in order
let listing; // what the server's shop says now
let respond; // (method, url, body) => a reply, or undefined to answer as the shop does

beforeEach(() => {
  calls = [];
  listing = structuredClone(LISTING);
  respond = () => undefined;
  Object.assign(session, { user: { id: 1, displayName: 'Ann' }, shop: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const call = [options.method ?? 'GET', url, options.body ? JSON.parse(options.body) : undefined];
      calls.push(call);
      return respond(...call) ?? (url === '/api/shop' ? reply(listing) : reply({ ok: true }));
    }),
  );
});
afterEach(() => {
  Object.assign(session, { user: null, shop: null });
  vi.unstubAllGlobals();
});

describe('refreshShop', () => {
  it('fetches the listing and your balance into the session', async () => {
    await refreshShop();
    expect(calls).toEqual([['GET', '/api/shop', undefined]]);
    expect(session.shop).toEqual(LISTING);
  });

  it('asks for nothing when nobody is signed in', async () => {
    session.user = null;
    await refreshShop();
    expect(calls).toEqual([]);
    expect(session.shop).toBeNull();
  });

  it('leaves the balance and the locks as they were when the server refuses or cannot be reached', async () => {
    await refreshShop();
    respond = () => reply({ error: 'serverError' }, 500);
    await expect(refreshShop()).resolves.toBeUndefined();
    expect(session.shop).toEqual(LISTING);
    respond = () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(refreshShop()).resolves.toBeUndefined();
    expect(session.shop).toEqual(LISTING);
  });

  it('shows what changed when it is called again', async () => {
    await refreshShop();
    listing.balance = 20;
    listing.items[1].owned = true;
    await refreshShop();
    expect(session.shop.balance).toBe(20);
    expect(owns('ns:gold')).toBe(true);
  });
});

describe('owns', () => {
  it('locks nothing before the listing has arrived', () => {
    expect(owns('ns:gold')).toBe(true);
    expect(owns('anything')).toBe(true);
  });

  it('follows the listing once it has: what you own you may use, and what you do not, you may not', async () => {
    await refreshShop();
    expect(owns('ns:plain')).toBe(true);
    expect(owns('ns:gold')).toBe(false);
  });

  it('lets you use anything that is not known to be for sale', async () => {
    await refreshShop();
    expect(owns('not-in-the-shop')).toBe(true);
    expect(owns(undefined)).toBe(true);
  });
});

describe('buy', () => {
  it('asks the server for the item, then fetches the listing again, so the coins and the lock are up to date', async () => {
    respond = (method, url, body) => {
      if (url !== '/api/shop/buy') return undefined;
      const item = listing.items.find((i) => i.id === body.item);
      listing.balance -= item.price;
      item.owned = true;
      return reply({ item, balance: listing.balance });
    };
    listing.balance = 1000;
    await refreshShop();
    expect(owns('ns:gold')).toBe(false);
    await buy('ns:gold');
    expect(calls.slice(1)).toEqual([
      ['POST', '/api/shop/buy', { item: 'ns:gold' }],
      ['GET', '/api/shop', undefined],
    ]);
    expect(session.shop.balance).toBe(200);
    expect(owns('ns:gold')).toBe(true);
  });

  it("throws the server's reason when the purchase is refused, and you still do not own it", async () => {
    await refreshShop();
    respond = (method, url) => (url === '/api/shop/buy' ? reply({ error: 'You do not have enough Gilders for that.' }, 402) : undefined);
    await expect(buy('ns:gold')).rejects.toThrow('You do not have enough Gilders for that.');
    expect(owns('ns:gold')).toBe(false);
    expect(session.shop.balance).toBe(700);
  });
});
