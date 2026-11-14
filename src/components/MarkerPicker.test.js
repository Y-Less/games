// The marker-colour picker every lobby with markers shares: a colour somebody else has cannot be picked, the
// viewer's own is shown as chosen, and any colour at all is offered only to a player who has unlocked it.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MarkerPicker from './MarkerPicker.vue';

const COLOURS = ['#ffffff', '#000000', '#808080'];
const players = (mine = '#ffffff') => [
  { id: 1, colour: mine },
  { id: 2, colour: '#000000' },
];
const show = (props = {}) => mount(MarkerPicker, { props: { colours: COLOURS, players: players(), you: 1, ...props } });
const swatches = (wrapper) => wrapper.findAll('button.swatch-pick');

describe('the marker picker', () => {
  it('offers the palette, with the colour somebody else has disabled and the viewer\'s own marked', () => {
    const wrapper = show();
    expect(swatches(wrapper).map((b) => b.element.disabled)).toEqual([false, true, false]);
    expect(swatches(wrapper).map((b) => b.classes('chosen'))).toEqual([true, false, false]);
    expect(swatches(wrapper).map((b) => b.attributes('aria-pressed'))).toEqual(['true', 'false', 'false']);
  });

  it('says which colour was picked', async () => {
    const wrapper = show();
    await swatches(wrapper)[2].trigger('click');
    expect(wrapper.emitted('pick')).toEqual([['#808080']]);
  });

  it('keeps any colour for a player who has unlocked it, and tells the others where to unlock it', async () => {
    const locked = show();
    expect(locked.find('input[type="color"]').exists()).toBe(false);
    expect(locked.text()).toContain('Unlock any colour in the shop');

    const unlocked = show({ canCustom: true, players: players('#123456') });
    const input = unlocked.find('input[type="color"]');
    expect(input.element.value).toBe('#123456');
    expect(unlocked.text()).not.toContain('Unlock any colour in the shop');
    await input.setValue('#abcdef');
    expect(unlocked.emitted('pick')).toEqual([['#abcdef']]);
  });

  it('shows a colour from outside the palette as the viewer\'s own, chosen', () => {
    const wrapper = show({ players: players('#123456') });
    expect(swatches(wrapper).some((b) => b.classes('chosen'))).toBe(false);
    expect(wrapper.find('span.swatch-pick.chosen').attributes('style')).toContain('rgb(18, 52, 86)');
  });

  it('lets somebody who is only watching pick nothing that is taken', () => {
    const wrapper = show({ you: 9 });
    expect(swatches(wrapper).map((b) => b.element.disabled)).toEqual([true, true, false]);
    expect(swatches(wrapper).some((b) => b.classes('chosen'))).toBe(false);
  });
});
