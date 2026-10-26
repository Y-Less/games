import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import Lightbox from './components/Lightbox.vue';
import { DIXNT_KEY } from './useDixnt.js';

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = '';
});

function open(zoom) {
  const store = reactive({ zoom });
  wrapper = mount(Lightbox, { global: { provide: { [DIXNT_KEY]: { store, cardUrl: (id, size) => `/card/${id}/${size}.jpg` } } }, attachTo: document.body });
  return store;
}
const click = (label) => document.querySelector(`[aria-label="${label}"]`)?.click();
const key = (name) => window.dispatchEvent(new KeyboardEvent('keydown', { key: name }));

describe('Dixnt card lightbox', () => {
  it('steps through the row with the buttons and wraps round', async () => {
    const store = open({ cardId: 1, cards: [1, 2, 3], actions: [] });
    expect(document.body.textContent).toContain('1 of 3');
    click('Next card');
    expect(store.zoom.cardId).toBe(2);
    click('Next card');
    click('Next card');
    expect(store.zoom.cardId).toBe(1);
    click('Previous card');
    expect(store.zoom.cardId).toBe(3);
  });

  it('steps with the arrow keys and closes on Escape', () => {
    const store = open({ cardId: 2, cards: [1, 2, 3], actions: [] });
    key('ArrowRight');
    expect(store.zoom.cardId).toBe(3);
    key('ArrowLeft');
    key('ArrowLeft');
    expect(store.zoom.cardId).toBe(1);
    key('Escape');
    expect(store.zoom).toBeNull();
  });

  it('has no step buttons for a single card', () => {
    open({ cardId: 5, actions: [] });
    expect(document.querySelector('[aria-label="Next card"]')).toBeNull();
    key('ArrowRight');
  });

  it('asks actionsFor for the buttons of whichever card is showing', async () => {
    const run = vi.fn();
    const actionsFor = (cardId) => [{ label: `Play ${cardId}`, primary: true, run: () => run(cardId) }];
    const store = open({ cardId: 1, cards: [1, 2], actionsFor });
    expect(document.body.textContent).toContain('Play 1');
    click('Next card');
    await wrapper.vm.$nextTick();
    expect(document.body.textContent).toContain('Play 2');
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Play 2')).click();
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith(2);
    expect(store.zoom).toBeNull();
  });
});
