import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import GameModal from './GameModal.vue';

let wrapper;
let opener;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  opener?.remove();
  opener = null;
  document.body.innerHTML = '';
});

const dialog = () => document.body.querySelector('[role="dialog"]');
const backdrop = () => document.body.querySelector('.modal-backdrop');
const press = (key, options = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));

function make(props = {}, slots = {}) {
  wrapper = mount(GameModal, {
    attachTo: document.body,
    props: { open: true, title: 'Scores', ...props },
    slots: { default: '<p class="content">Body</p>', ...slots },
  });
  return wrapper;
}

describe('GameModal', () => {
  it('renders nothing while closed', () => {
    make({ open: false });
    expect(dialog()).toBeNull();
  });

  it('teleports the dialog to the body, outside the mounted component', async () => {
    make();
    await nextTick();
    expect(dialog()).not.toBeNull();
    expect(wrapper.element.querySelector?.('[role="dialog"]') ?? null).toBeNull();
    expect(dialog().parentElement.parentElement).toBe(document.body);
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().getAttribute('aria-label')).toBe('Scores');
    expect(dialog().textContent).toContain('Body');
  });

  it('uses a default label when there is no title', () => {
    make({ title: '' });
    expect(dialog().getAttribute('aria-label')).toBe('Dialog');
  });

  it('opens and closes as the prop changes', async () => {
    make({ open: false });
    await wrapper.setProps({ open: true });
    expect(dialog()).not.toBeNull();
    await wrapper.setProps({ open: false });
    expect(dialog()).toBeNull();
  });

  it('applies the size class', () => {
    make({ size: 'xl' });
    expect(dialog().classList.contains('xl')).toBe(true);
  });

  it('Escape asks to close', async () => {
    make();
    press('Escape');
    expect(wrapper.emitted('update:open')).toEqual([[false]]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('the Close button asks to close', async () => {
    make();
    document.body.querySelector('button[aria-label="Close"]').click();
    expect(wrapper.emitted('update:open')).toEqual([[false]]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('a click on the backdrop closes, a click inside does not', async () => {
    make();
    dialog().querySelector('.content').click();
    dialog().click();
    expect(wrapper.emitted('close')).toBeUndefined();
    backdrop().click();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('ignores Escape, backdrop and shows no Close button when closable is false', async () => {
    make({ closable: false });
    press('Escape');
    backdrop().click();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.emitted('update:open')).toBeUndefined();
    expect(document.body.querySelector('button[aria-label="Close"]')).toBeNull();
  });

  it('stops listening for Escape once closed', async () => {
    make();
    await wrapper.setProps({ open: false });
    press('Escape');
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('stops listening for Escape after unmounting', () => {
    make();
    const local = wrapper;
    wrapper = null;
    local.unmount();
    press('Escape');
    expect(local.emitted('close')).toBeUndefined();
  });

  it('renders the footer slot only when given', () => {
    make();
    expect(document.body.querySelector('.modal-foot')).toBeNull();
    wrapper.unmount();
    make({}, { footer: '<button class="foot">OK</button>' });
    expect(document.body.querySelector('.modal-foot .foot')).not.toBeNull();
  });

  describe('focus', () => {
    it('moves into the dialog on open and back to the opener on close', async () => {
      opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();
      make({ open: false });
      await wrapper.setProps({ open: true });
      await nextTick();
      expect(dialog().contains(document.activeElement)).toBe(true);
      await wrapper.setProps({ open: false });
      expect(document.activeElement).toBe(opener);
    });

    it('focuses the [data-autofocus] element when there is one', async () => {
      make({ open: false }, { default: '<button class="a">A</button><button class="b" data-autofocus>B</button>' });
      await wrapper.setProps({ open: true });
      await nextTick();
      expect(document.activeElement.classList.contains('b')).toBe(true);
    });

    it('focuses the panel itself when nothing is marked', async () => {
      make({ open: false });
      await wrapper.setProps({ open: true });
      await nextTick();
      expect(document.activeElement).toBe(dialog());
    });

    it('Tab from the last control wraps to the first, and Shift+Tab from the first to the last', async () => {
      make({}, { default: '<input class="a" /><button class="b">B</button>' });
      await nextTick();
      const buttons = [...dialog().querySelectorAll('button, input')];
      const first = buttons[0];
      const last = buttons.at(-1);
      expect(first.getAttribute('aria-label') ?? first.className).toBeTruthy();

      last.focus();
      press('Tab');
      expect(document.activeElement).toBe(first);

      first.focus();
      press('Tab', { shiftKey: true });
      expect(document.activeElement).toBe(last);
    });

    it('lets Tab move normally in the middle', async () => {
      make({}, { default: '<button class="a">A</button><button class="b">B</button>' });
      await nextTick();
      const middle = dialog().querySelector('.a');
      middle.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });

    it('skips disabled controls when wrapping', async () => {
      make({ closable: false }, { default: '<button class="a">A</button><button class="b" disabled>B</button>' });
      await nextTick();
      const a = dialog().querySelector('.a');
      a.focus();
      press('Tab');
      expect(document.activeElement).toBe(a);
    });
  });
});
