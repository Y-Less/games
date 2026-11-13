// The Help pop-up in the site's header (a page's help, or a game's rules).  What is protected is what its own header
// promises: it shows the rendered help it is given, says it is loading until there is some, is announced as a dialog
// with a name, and closes three ways (the Close button, Escape, and a click outside it) and no others.  It listens on
// the window for Escape, so it must also stop listening when it goes, or a closed dialog would go on closing things.
//
// The `html` it shows is deliberately trusted (markdown.js has already made it safe, and markdown.test.js checks that),
// so escaping is not this component's job and is not tested here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { i18n } from '../i18n.js';
import HelpDialog from './HelpDialog.vue';

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});
const open = (props = {}) => (wrapper = mount(HelpDialog, { props, attachTo: document.body }));
const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key }));
const closes = () => wrapper.emitted('close')?.length ?? 0;

describe('HelpDialog', () => {
  it('shows the help it is given, as the markup it already is', () => {
    open({ html: '<h2>Rules</h2><p>Play <strong>nicely</strong>.</p>' });
    expect(wrapper.find('.help h2').text()).toBe('Rules');
    expect(wrapper.find('.help strong').text()).toBe('nicely');
  });

  it('says it is loading until the help has arrived, then shows it', async () => {
    open();
    expect(wrapper.find('.help').text()).toBe(i18n.global.t('common.loading'));
    await wrapper.setProps({ html: '<p>Here it is.</p>' });
    expect(wrapper.find('.help').text()).toBe('Here it is.');
  });

  it('is a dialog called "Help" unless it is given another name', () => {
    open({ html: '' });
    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.attributes('aria-label')).toBe(i18n.global.t('common.help'));
    expect(dialog.attributes('aria-label')).toBe('Help');
    wrapper.unmount();
    open({ html: '', title: 'How to play Hearts' });
    expect(wrapper.find('[role="dialog"]').attributes('aria-label')).toBe('How to play Hearts');
  });

  it('keeps a title as text, whatever is in it', () => {
    const title = '"><img src=x onerror=alert(1)>';
    open({ html: '<p>Help</p>', title });
    expect(wrapper.find('[role="dialog"]').attributes('aria-label')).toBe(title);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('closes with its Close button', async () => {
    open({ html: '<p>Help</p>' });
    const button = wrapper.find('button');
    expect(button.text()).toBe(i18n.global.t('common.close'));
    await button.trigger('click');
    expect(closes()).toBe(1);
  });

  it('closes with Escape, and with no other key', () => {
    open({ html: '<p>Help</p>' });
    for (const key of ['Enter', ' ', 'Tab', 'a', 'ArrowDown']) press(key);
    expect(closes()).toBe(0);
    press('Escape');
    expect(closes()).toBe(1);
  });

  it('closes with a click outside it, but not with a click inside', async () => {
    open({ html: '<p>Help</p>' });
    await wrapper.find('.help p').trigger('click');
    await wrapper.find('[role="dialog"]').trigger('click');
    expect(closes()).toBe(0);
    await wrapper.find('.backdrop').trigger('click');
    expect(closes()).toBe(1);
  });

  it('stops listening for Escape once it has gone, and leaves another open dialog listening', () => {
    const onClose = vi.fn();
    const onOtherClose = vi.fn();
    const gone = mount(HelpDialog, { props: { html: '<p>One</p>', onClose } });
    const other = mount(HelpDialog, { props: { html: '<p>Two</p>', onClose: onOtherClose } });
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOtherClose).toHaveBeenCalledTimes(1);
    gone.unmount();
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOtherClose).toHaveBeenCalledTimes(2);
    other.unmount();
    press('Escape');
    expect(onOtherClose).toHaveBeenCalledTimes(2);
  });

  it('leaves no listener behind on the window', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    open({ html: '<p>Help</p>' });
    const listeners = added.mock.calls.filter(([event]) => event === 'keydown');
    expect(listeners.length).toBeGreaterThan(0);
    wrapper.unmount();
    wrapper = null;
    for (const [event, handler] of listeners) expect(removed).toHaveBeenCalledWith(event, handler);
    added.mockRestore();
    removed.mockRestore();
  });
});
