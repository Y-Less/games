import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { REFUND_MINIMUM_WORDS } from '../../shared/refunds.js';
import { session } from '../session.js';
import RefundView from './RefundView.vue';

const reply = (body, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
/** A piece of writing of exactly `n` words. */
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const LONG_ENOUGH = words(REFUND_MINIMUM_WORDS);

let wrapper;
let listing;
let calls;
let refundReply;
beforeEach(() => {
  calls = [];
  refundReply = () => reply({ id: 7, words: REFUND_MINIMUM_WORDS });
  listing = { balance: 0, items: [{ id: 'refunds', type: 'unlock', name: 'Refunds', price: 1000, owned: true }] };
  Object.assign(session, { user: { id: 1, displayName: 'Ann' }, shop: null });
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    calls.push([options.method ?? 'GET', url, options.body ? JSON.parse(options.body) : undefined]);
    if (url === '/api/shop') return reply(listing);
    if (url === '/api/refunds') return refundReply();
    return reply({ error: 'unexpected' }, 404);
  });
});
afterEach(() => wrapper?.unmount());

async function make() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/refund', component: RefundView }, { path: '/:rest(.*)*', component: { template: '<i />' } }] });
  router.push('/refund');
  await router.isReady();
  wrapper = mount(RefundView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}
const write = async (text) => {
  await wrapper.find('textarea').setValue(text);
  await flushPromises();
};
const sendButton = () => wrapper.find('button[type="submit"]');
// jsdom does not submit a form when its button is clicked, so the form is submitted the way the browser would.
const send = async () => {
  await wrapper.find('form').trigger('submit');
  await flushPromises();
};

describe('RefundView', () => {
  it('asks for the writing in the words customer support chose', async () => {
    await make();
    const intro = wrapper.find('.intro').text();
    expect(intro).toContain(`In no fewer than ${REFUND_MINIMUM_WORDS} words please describe which item you wish to refund and why.`);
    expect(intro).toContain('submitted to our customer support agents for review');
    expect(intro).toContain('within 20 working months');
  });

  it('counts the words as they are written and will not submit until there are enough', async () => {
    await make();
    expect(sendButton().element.disabled).toBe(true);
    expect(wrapper.find('.count').text()).toBe(`0 of ${REFUND_MINIMUM_WORDS} words`);

    await write(words(REFUND_MINIMUM_WORDS - 1));
    expect(wrapper.find('.count').text()).toBe(`${REFUND_MINIMUM_WORDS - 1} of ${REFUND_MINIMUM_WORDS} words`);
    expect(sendButton().element.disabled).toBe(true);

    await write(LONG_ENOUGH);
    expect(wrapper.find('.count').text()).toBe(`${REFUND_MINIMUM_WORDS} words: long enough.`);
    expect(sendButton().element.disabled).toBe(false);
  });

  it('sends the writing and thanks you, offering another go', async () => {
    await make();
    await write(LONG_ENOUGH);
    await send();
    expect(calls).toContainEqual(['POST', '/api/refunds', { text: LONG_ENOUGH }]);
    expect(wrapper.find('.done').text()).toContain('with our customer support agents');
    expect(wrapper.find('textarea').exists()).toBe(false);

    await wrapper.find('.done button').trigger('click');
    expect(wrapper.find('textarea').element.value).toBe(''); // a fresh sheet, not the one just sent
  });

  it('shows what the server said when it refuses, and keeps what was written', async () => {
    await make();
    refundReply = () => reply({ error: 'refundTooShort', params: { min: 120, n: 4 } }, 400); // whatever the server says, not what this page worked out
    await write(LONG_ENOUGH);
    await send();
    expect(wrapper.find('.bad').text()).toBe('A refund request must be no fewer than 120 words. That one is 4.');
    expect(wrapper.find('textarea').element.value).toBe(LONG_ENOUGH);
  });

  it('turns away anybody who has not bought Refunds', async () => {
    listing.items[0].owned = false;
    await make();
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.text()).toContain('Refunds are not among the things you have bought.');
  });

  it('decides nothing until the shop listing has arrived', async () => {
    let settle;
    globalThis.fetch = vi.fn(() => new Promise((resolve) => {
      settle = () => resolve(reply(listing));
    }));
    await make();
    expect(wrapper.text()).toContain('Loading');
    expect(wrapper.find('textarea').exists()).toBe(false);
    settle();
    await flushPromises();
    expect(wrapper.find('textarea').exists()).toBe(true);
  });
});
