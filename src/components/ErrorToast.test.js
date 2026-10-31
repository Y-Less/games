import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ErrorToast from './ErrorToast.vue';

describe('ErrorToast', () => {
  it('shows the text as an alert', () => {
    const w = mount(ErrorToast, { props: { text: 'Not your turn' } });
    expect(w.find('p.notice').attributes('role')).toBe('alert');
    expect(w.text()).toBe('Not your turn');
  });
});
