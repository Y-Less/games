import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { DEFAULT_AVATAR } from '../../shared/avatar.js';
import { session } from '../session.js';
import AvatarEditor from './AvatarEditor.vue';

const reply = (body, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
let wrapper;
let calls;
beforeEach(() => {
  calls = [];
  Object.assign(session, {
    user: { id: 1, displayName: 'Ann', avatar: { ...DEFAULT_AVATAR } },
    shop: { balance: 0, items: [{ id: 'av:hair:curly', type: 'avatar', price: 150, owned: false }, { id: 'av:hair:long', type: 'avatar', price: 100, owned: true }] },
  });
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    calls.push([options.method, url, JSON.parse(options.body)]);
    session.user = { ...session.user, ...JSON.parse(options.body) };
    return reply({ user: session.user });
  });
  wrapper = mount(AvatarEditor, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
});
afterEach(() => wrapper.unmount());

const option = (slot, name) => wrapper.find(`[data-slot="${slot}"] [aria-label="${name}"]`);

describe('AvatarEditor', () => {
  it('shows every slot, with the current choice pressed and the unbought options disabled', () => {
    expect(wrapper.findAll('.slot').length).toBeGreaterThanOrEqual(8);
    expect(option('hair', 'Hair: Short').attributes('aria-pressed')).toBe('true');
    expect(option('hair', 'Hair: Curly').element.disabled).toBe(true);
    expect(option('hair', 'Hair: Long').element.disabled).toBe(false);
  });

  it('only offers to save once something has changed, and saves the whole avatar', async () => {
    const save = () => wrapper.find('button.primary');
    expect(save().element.disabled).toBe(true);
    await option('hair', 'Hair: Long').trigger('click');
    expect(save().element.disabled).toBe(false);
    await save().trigger('click');
    await flushPromises();
    expect(calls).toEqual([['PATCH', '/api/me', { avatar: { ...DEFAULT_AVATAR, hair: 'long' } }]]);
    expect(wrapper.find('.ok').text()).toBe('Avatar saved.');
    expect(save().element.disabled).toBe(true);
  });

  it('undoes unsaved changes', async () => {
    await option('hair', 'Hair: Long').trigger('click');
    await wrapper.findAll('button').find((b) => b.text() === 'Undo').trigger('click');
    expect(option('hair', 'Hair: Short').attributes('aria-pressed')).toBe('true');
  });
});
