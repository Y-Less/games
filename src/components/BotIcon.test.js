import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import BotIcon from './BotIcon.vue';

describe('BotIcon', () => {
  it('is an image labelled as a computer player', () => {
    const icon = mount(BotIcon).find('.bot-icon');
    expect(icon.attributes('role')).toBe('img');
    expect(icon.attributes('aria-label')).toBe('Computer player');
    expect(icon.attributes('title')).toBe('Computer player');
    expect(icon.text()).toBe('');
  });
  it('takes a custom label and a pixel size', () => {
    const svg = mount(BotIcon, { props: { label: 'Robot', size: 20 } }).find('.bot-icon');
    expect(svg.attributes('aria-label')).toBe('Robot');
    expect(svg.attributes('style')).toContain('width: 20px');
  });
});
