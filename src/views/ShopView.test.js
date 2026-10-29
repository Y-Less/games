import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { session } from '../session.js';
import ShopView from './ShopView.vue';

const reply = (body, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
const ITEMS = [
  { id: 'ns:plain', type: 'name-style', name: 'Plain', price: 0, owned: true },
  { id: 'ns:gold', type: 'name-style', name: 'Gold', price: 800, owned: false },
  { id: 'ns:ruby', type: 'name-style', name: 'Ruby', price: 600, owned: true },
  { id: 'bg:night', type: 'background', name: 'Night', price: 0, owned: true },
  { id: 'bg:ocean', type: 'background', name: 'Ocean', price: 500, owned: false },
  { id: 'cb:crimson', type: 'card-back', name: 'Crimson', price: 0, owned: true },
  { id: 'av:hair:curly', type: 'avatar', name: 'Hair: Curly', price: 150, owned: false, slot: 'hair', option: 'curly' },
  { id: 'av:hair:short', type: 'avatar', name: 'Hair: Short', price: 0, owned: true, slot: 'hair', option: 'short' },
  { id: 'na:glow', type: 'name-animation', name: 'Glow', price: 500, owned: true },
  { id: 'ba:stars', type: 'background-animation', name: 'Twinkling stars', price: 800, owned: false },
  { id: 'bg-colour', type: 'unlock', name: 'Any background colour', price: 800, owned: false },
];

let wrapper;
let listing;
let calls;
beforeEach(() => {
  calls = [];
  listing = { balance: 700, items: structuredClone(ITEMS) };
  Object.assign(session, {
    user: { id: 1, displayName: 'Ann', background: { type: 'preset', value: 'night' }, cardBack: { type: 'preset', value: 'crimson' }, nameStyle: { style: 'plain' } },
    presets: { night: 'night-img', ocean: 'ocean-img' },
    cardBacks: { crimson: 'red' },
    shop: null,
  });
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    calls.push([options.method ?? 'GET', url, options.body ? JSON.parse(options.body) : undefined]);
    if (url === '/api/shop') return reply(listing);
    if (url === '/api/shop/buy') {
      const item = listing.items.find((i) => i.id === JSON.parse(options.body).item);
      if (listing.balance < item.price) return reply({ error: 'You do not have enough coins for that.' }, 402);
      listing.balance -= item.price;
      item.owned = true;
      return reply({ item, balance: listing.balance });
    }
    if (url === '/api/me' && options.method === 'PATCH') {
      session.user = { ...session.user, ...JSON.parse(options.body) };
      return reply({ user: session.user });
    }
    return reply({ error: 'unexpected' }, 404);
  });
});
afterEach(() => wrapper?.unmount());

let router;
async function make(path = '/shop') {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/shop/:tab?', name: 'shop', component: ShopView }, { path: '/:rest(.*)*', component: { template: '<i />' } }] });
  router.push(path);
  await router.isReady();
  wrapper = mount(ShopView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}
const openTab = async (label) => {
  await wrapper.findAll('.tab').find((t) => t.text() === label).trigger('click');
  await flushPromises();
};
const card = (id) => wrapper.find(`[data-item="${id}"]`);

describe('ShopView', () => {
  it('shows your coins and the name styles first, each with its price or state', async () => {
    await make();
    expect(wrapper.find('.coins').text()).toContain('700');
    expect(wrapper.findAll('.item').map((i) => i.attributes('data-item'))).toEqual(['ns:plain', 'ns:gold', 'ns:ruby']);
    expect(card('ns:plain').text()).toContain('In use');
    expect(card('ns:gold').find('button').text()).toBe('Buy for 800');
    expect(card('ns:ruby').find('button').text()).toBe('Use');
    expect(card('ns:ruby').find('[data-name-style="ruby"]').text()).toBe('Ann'); // previewed in its own style
  });

  it('will not let you buy what you cannot afford, and says how many coins short you are', async () => {
    await make();
    const gold = card('ns:gold').find('button');
    expect(gold.element.disabled).toBe(true);
    expect(gold.attributes('title')).toBe('You need 100 more coins');
  });

  it('buys an item, updates the balance and then offers to use it', async () => {
    await make();
    await openTab('Backgrounds');
    expect(wrapper.findAll('.item').map((i) => i.attributes('data-item'))).toEqual(['bg:night', 'bg:ocean']);
    await card('bg:ocean').find('button').trigger('click');
    await flushPromises();
    expect(calls).toContainEqual(['POST', '/api/shop/buy', { item: 'bg:ocean' }]);
    expect(wrapper.find('.ok').text()).toBe('You bought Ocean.');
    expect(wrapper.find('.coins').text()).toContain('200');
    expect(card('bg:ocean').find('button').text()).toBe('Use');
  });

  it('puts on something you own, straight from the shop', async () => {
    await make();
    await card('ns:ruby').find('button').trigger('click');
    await flushPromises();
    expect(calls).toContainEqual(['PATCH', '/api/me', { nameStyle: { style: 'ruby' } }]);
    expect(card('ns:ruby').text()).toContain('In use');
    expect(card('ns:plain').find('button').text()).toBe('Use');
  });

  it("shows the server's reason when a purchase is refused", async () => {
    await make();
    listing.balance = 10; // spent elsewhere since the page loaded
    session.shop.balance = 900;
    await flushPromises();
    await card('ns:gold').find('button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.bad').text()).toBe('You do not have enough coins for that.');
  });

  it('lists the unlocks, which are bought but used on the Profile page', async () => {
    await make();
    await openTab('Unlocks');
    expect(card('bg-colour').find('button').text()).toBe('Buy for 800');
  });
  it('previews avatar parts on you and puts one on from the shop', async () => {
    await make();
    await openTab('Avatar');
    expect(wrapper.findAll('.item').map((i) => i.attributes('data-item'))).toEqual(['av:hair:curly', 'av:hair:short']);
    expect(card('av:hair:curly').find('svg').exists()).toBe(true);
    expect(card('av:hair:short').text()).toContain('In use');
    await card('av:hair:curly').find('button').trigger('click');
    await flushPromises();
    expect(card('av:hair:curly').find('button').text()).toBe('Use');
    await card('av:hair:curly').find('button').trigger('click');
    await flushPromises();
    expect(calls.at(-1)[2].avatar.hair).toBe('curly');
  });
  it('gives each tab its own address, so Back and Forward move between tabs', async () => {
    await make();
    await openTab('Avatar');
    expect(router.currentRoute.value.path).toBe('/shop/avatar');
    expect(wrapper.find('.tab.on').text()).toBe('Avatar');
    await openTab('Backgrounds');
    expect(router.currentRoute.value.path).toBe('/shop/backgrounds');
    router.back();
    await flushPromises();
    expect(wrapper.find('.tab.on').text()).toBe('Avatar');
    expect(wrapper.findAll('.item').every((i) => i.attributes('data-item').startsWith('av:'))).toBe(true);
    router.forward();
    await flushPromises();
    expect(wrapper.find('.tab.on').text()).toBe('Backgrounds');
  });

  it('opens straight on the tab named in the address', async () => {
    await make('/shop/unlocks');
    expect(wrapper.find('.tab.on').text()).toBe('Unlocks');
    expect(card('bg-colour').exists()).toBe(true);
  });
  it('lists name and background animations together, and puts one on', async () => {
    await make('/shop/animations');
    expect(wrapper.findAll('.item').map((i) => i.attributes('data-item'))).toEqual(['na:glow', 'ba:stars']);
    expect(card('na:glow').find('[data-animation="glow"]').exists()).toBe(true);
    expect(card('ba:stars').find('[data-fx="stars"]').exists()).toBe(true);
    expect(card('ba:stars').find('button').text()).toBe('Buy for 800');
    await card('na:glow').find('button').trigger('click');
    await flushPromises();
    expect(calls.at(-1)).toEqual(['PATCH', '/api/me', { nameStyle: { style: 'plain', animation: 'glow' } }]);
  });
  it('says so when the device is set to reduce motion, and plays the previews on request', async () => {
    globalThis.matchMedia = vi.fn(() => ({ matches: true }));
    try {
      await make('/shop/animations');
      expect(wrapper.find('.motion').exists()).toBe(true);
      expect(card('ba:stars').find('.bg-fx').classes()).not.toContain('play');
      await wrapper.find('.motion button').trigger('click');
      expect(wrapper.find('.motion').exists()).toBe(false);
      expect(card('ba:stars').find('.bg-fx').classes()).toContain('play');
      expect(card('na:glow').find('.styled-name').classes()).toContain('play');
    } finally {
      delete globalThis.matchMedia;
    }
  });

  it('does not nag about motion when the device has no such setting', async () => {
    await make('/shop/animations');
    expect(wrapper.find('.motion').exists()).toBe(false);
  });
});
