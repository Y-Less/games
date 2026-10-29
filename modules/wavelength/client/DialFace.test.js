// The Wavelength dial component: what it draws for each situation, and how it turns.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Dial from './Dial.vue';

const bands = [{ within: 2.5, points: 4 }, { within: 7.5, points: 3 }, { within: 12.5, points: 2 }];
const make = (props = {}) => mount(Dial, { props: { left: 'Cold', right: 'Hot', bands, ...props } });
/** jsdom has no layout: give the dial face the size of its view box so that pointer positions mean something. */
const sized = (wrapper) => {
  wrapper.find('svg.face').element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 220, height: 122 });
  return wrapper;
};
const press = async (wrapper, type, x, y) => {
  wrapper.find('svg.face').element.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
  await nextTick();
};

describe('Wavelength dial drawing', () => {
  it('shows the two ends, and no target while it is hidden', () => {
    const w = make();
    expect(w.findAll('.end').map((e) => e.text())).toEqual(['Cold', 'Hot']);
    expect(w.findAll('.wedge')).toHaveLength(0);
    expect(w.findAll('.band-label')).toHaveLength(0);
    expect(w.find('svg').attributes('aria-label')).toBe('A dial from Cold to Hot');
  });

  it('draws the three bands, widest first, with their points written on them', () => {
    const w = make({ target: 50 });
    expect(w.findAll('.wedge').map((e) => e.classes().find((c) => /^w\d$/.test(c)))).toEqual(['w2', 'w3', 'w4']);
    expect(w.findAll('.band-label').map((e) => e.text()).sort()).toEqual(['2', '3', '4']);
  });

  it('keeps the bands on the dial for a target near an end', () => {
    const w = make({ target: 3 });
    for (const d of w.findAll('.wedge').map((e) => e.attributes('d'))) expect(d).not.toMatch(/NaN|undefined/);
  });

  it('draws one marker per guess, named for its player, and a needle for the selected position', () => {
    const w = make({ target: 40, guesses: [{ id: 1, position: 10, colour: '#ff0000', name: 'Ann' }, { id: 2, position: 90, colour: '#00ff00', name: 'Bob' }], selected: 55, colour: '#123456' });
    const pins = w.findAll('.pin');
    expect(pins).toHaveLength(2);
    expect(pins.map((p) => p.find('title').text())).toEqual(['Ann', 'Bob']);
    expect(pins[0].find('circle').attributes('fill')).toBe('#ff0000');
    expect(w.find('.needle').exists()).toBe(true);
    expect(w.find('.needle line').attributes('stroke')).toBe('#123456');
    expect(make({ selected: null }).find('.needle').exists()).toBe(false);
  });

  it('is exactly as wide as it is told, and as tall as its shape needs', () => {
    const w = make({ width: 330 });
    expect(w.find('svg').attributes('width')).toBe('330');
    expect(w.find('svg').attributes('height')).toBe(String(Math.round((330 * 122) / 220)));
    expect(w.element.style.width).toBe('330px');
  });
});

describe('Wavelength dial turning', () => {
  it('ignores the pointer unless it is interactive', async () => {
    const w = sized(make({ interactive: false }));
    await press(w, 'pointerdown', 110, 12);
    expect(w.emitted('pick')).toBeUndefined();
  });

  it('turns to the place that was pressed, and follows a drag until the pointer is let go', async () => {
    const w = sized(make({ interactive: true }));
    await press(w, 'pointerdown', 110, 12); // straight above the hub: the middle
    expect(w.emitted('pick').at(-1)).toEqual([50]);
    await press(w, 'pointermove', 10, 112); // far left, level with the hub: the left end
    expect(w.emitted('pick').at(-1)).toEqual([0]);
    await press(w, 'pointermove', 210, 112);
    expect(w.emitted('pick').at(-1)).toEqual([100]);
    await press(w, 'pointerup', 210, 112);
    const count = w.emitted('pick').length;
    await press(w, 'pointermove', 110, 12);
    expect(w.emitted('pick')).toHaveLength(count); // not pressed any more: moving does nothing
  });

  it('does not turn on a move that began elsewhere', async () => {
    const w = sized(make({ interactive: true }));
    await press(w, 'pointermove', 110, 12);
    expect(w.emitted('pick')).toBeUndefined();
  });

  it('snaps to the nearer end when the pointer is below the hub', async () => {
    const w = sized(make({ interactive: true }));
    await press(w, 'pointerdown', 20, 120);
    expect(w.emitted('pick').at(-1)).toEqual([0]);
    await press(w, 'pointerdown', 200, 120);
    expect(w.emitted('pick').at(-1)).toEqual([100]);
  });
});

describe('Wavelength dial slider', () => {
  it('is a labelled slider that turns the dial from the keyboard', async () => {
    const w = make({ interactive: true, selected: 20 });
    const slider = w.find('input[type="range"]');
    expect(slider.element.value).toBe('20');
    expect(slider.attributes('aria-label')).toBe('Turn the dial from Cold to Hot');
    expect(slider.attributes('disabled')).toBeUndefined();
    await slider.setValue('72.5');
    expect(w.emitted('pick').at(-1)).toEqual([72.5]);
  });

  it('starts in the middle, and keeps its room (hidden and disabled) when the dial is not being turned', () => {
    expect(make({ interactive: true }).find('input').element.value).toBe('50');
    const idle = make({ interactive: false });
    expect(idle.find('input').classes()).toContain('idle');
    expect(idle.find('input').attributes('disabled')).toBeDefined();
  });

  it('can leave the slider out altogether (the pop-up)', () => {
    expect(make({ interactive: false, reserveSlider: false }).find('input').exists()).toBe(false);
    expect(make({ interactive: true, reserveSlider: false }).find('input').exists()).toBe(true);
  });
});
