import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import GameFrame from './GameFrame.vue';

const slots = {
  scorebar: '<div id="s">scores</div>',
  main: '<template #main="{ width, height, left, right, gap, mainSpan, columns }"><div id="m">{{ width }}|{{ height }}|{{ left }}|{{ right }}|{{ gap }}|{{ mainSpan }}|{{ columns }}</div></template>',
  others: '<div id="o">bars</div>',
  log: '<div id="l">moves</div>',
  status: '<div id="t">status</div>',
};

describe('GameFrame', () => {
  it('lays out the standard areas and tells the page it fits the window', () => {
    const w = mount(GameFrame, { slots });
    expect(w.attributes('data-fits-window')).toBeDefined();
    for (const id of ['s', 'm', 'o', 'l', 't']) expect(w.find(`#${id}`).exists()).toBe(true);
    expect(w.find('[aria-label="Recent moves"] h3').text()).toBe('Recent moves');
    expect(w.find('[aria-label="Status"] h3').text()).toBe('Status');
    expect(w.find('.box.log #l').exists()).toBe(true);
    expect(w.find('.box.status #t').exists()).toBe(true);
  });

  it('omits the bars row when there is no others slot, and can retitle the boxes', () => {
    const { others, ...rest } = slots;
    const w = mount(GameFrame, { slots: rest, props: { logTitle: 'History', statusTitle: 'Info' } });
    expect(w.find('.others').exists()).toBe(false);
    expect(w.find('[aria-label="History"]').exists()).toBe(true);
    expect(w.find('[aria-label="Info"]').exists()).toBe(true);
  });

  it('is sized from the window alone, as a 12-column grid', () => {
    const w = mount(GameFrame, { slots });
    const style = w.element.style;
    expect(style.height).toMatch(/^\d+px$/);
    expect(style.width).toBe(`${Math.min(1760, window.innerWidth - 32)}px`);
    expect(style.getPropertyValue('--cols')).toBe('12');
    expect(style.getPropertyValue('--gap')).toBe('12px');
  });

  it('gives the main slot the column sizes for the chosen split, which add up to the width', () => {
    const w = mount(GameFrame, { slots, props: { mainSpan: 8, logSpan: 5 } });
    const [width, , left, right, gap, span, columns] = w.find('#m').text().split('|').map(Number);
    expect(span).toBe(8);
    expect(columns).toBe(12);
    expect(left + right + gap).toBe(width);
    expect(left).toBeGreaterThan(right);
    expect(w.element.style.getPropertyValue('--log-span')).toBe('5');
  });
});
