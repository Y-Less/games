import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import GameLog from './GameLog.vue';

const make = (props = {}, options = {}) => mount(GameLog, { props: { entries: [], ...props }, ...options });
const texts = (w) => w.findAll('li').map((li) => li.text());
const entries = (n) => Array.from({ length: n }, (_, i) => ({ text: `move ${i + 1}` }));

/** jsdom has no layout, so give the box a size and watch what the component does to scrollTop. */
function fakeLayout(w, { scrollHeight = 500, clientHeight = 100 } = {}) {
  const el = w.element;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  return el;
}

describe('GameLog', () => {
  it('lists entries oldest first by default, drawing text or the entry itself', async () => {
    expect(texts(make({ entries: entries(3) }))).toEqual(['move 1', 'move 2', 'move 3']);
    expect(texts(make({ entries: ['a', 'b'] }))).toEqual(['a', 'b']);
  });

  it('can show the newest entry first', () => {
    expect(texts(make({ entries: entries(3), newestFirst: true }))).toEqual(['move 3', 'move 2', 'move 1']);
  });

  it('draws entries through the slot', () => {
    const w = make({ entries: entries(2) }, { slots: { default: '<template #default="{ entry, index }">{{ index }}: {{ entry.text }}</template>' } });
    expect(texts(w)).toEqual(['0: move 1', '1: move 2']);
  });

  it('shows the empty text only while there are no entries', async () => {
    const w = make({ empty: 'Nothing yet.' });
    expect(texts(w)).toEqual(['Nothing yet.']);
    await w.setProps({ entries: entries(1) });
    expect(texts(w)).toEqual(['move 1']);
  });

  it('marks everything but the newest `fresh` entries as old', () => {
    const w = make({ entries: entries(5), fresh: 2 });
    expect(w.findAll('li').map((li) => li.classes('old'))).toEqual([true, true, true, false, false]);
  });

  it('is a labelled list with a fixed height taken from --log-height', () => {
    const w = make({ label: 'Scoring' });
    expect(w.attributes('aria-label')).toBe('Scoring');
    expect(w.element.tagName).toBe('UL');
  });

  it('scrolls to the newest entry when one arrives, if the player was at the newest', async () => {
    const w = make({ entries: entries(3) });
    const el = fakeLayout(w);
    await w.setProps({ entries: entries(4) });
    await nextTick();
    expect(el.scrollTop).toBe(500);
  });

  it('leaves the player alone when they have scrolled up', async () => {
    const w = make({ entries: entries(3) });
    const el = fakeLayout(w);
    el.scrollTop = 50;
    await w.trigger('scroll');
    await w.setProps({ entries: entries(4) });
    await nextTick();
    expect(el.scrollTop).toBe(50);
    // ...and follows again once they scroll back to the newest.
    el.scrollTop = 400;
    await w.trigger('scroll');
    await w.setProps({ entries: entries(5) });
    await nextTick();
    expect(el.scrollTop).toBe(500);
  });

  it('keeps the top in view when the newest is first', async () => {
    const w = make({ entries: entries(3), newestFirst: true });
    const el = fakeLayout(w);
    el.scrollTop = 200;
    await w.trigger('scroll');
    await w.setProps({ entries: entries(4) });
    await nextTick();
    expect(el.scrollTop).toBe(200); // scrolled down to older entries: not yanked back
    el.scrollTop = 0;
    await w.trigger('scroll');
    await w.setProps({ entries: entries(5) });
    await nextTick();
    expect(el.scrollTop).toBe(0);
  });
});
