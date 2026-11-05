// The panel that folds: shut to begin with, opened and shut again by its heading, and saying which it is.
//
// Whether the body is showing is read from the inline style v-show sets and from aria-expanded, rather than from
// test-utils' isVisible(), which does not answer the same way for the same DOM once a re-render has been through it.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CollapsiblePanel from './CollapsiblePanel.vue';

const make = (props = {}) =>
  mount(CollapsiblePanel, {
    props: { title: 'Hearts', ...props },
    slots: { default: '<p class="body-text">Played 12</p>', summary: '<span class="tally">3 of 9</span>' },
  });

/** Whether the panel is showing its body, as the page would draw it. */
const open = (w) => ({
  body: w.find('.body').element.style.display !== 'none',
  said: w.find('button').attributes('aria-expanded'),
  shut: w.classes().includes('shut'),
});

describe('CollapsiblePanel', () => {
  it('starts shut, with its heading and summary still shown', () => {
    const w = make();
    expect(w.find('h2').text()).toBe('Hearts');
    expect(w.find('.tally').exists()).toBe(true);
    expect(open(w)).toEqual({ body: false, said: 'false', shut: true });
  });

  it('opens on the heading and shuts again', async () => {
    const w = make();
    await w.find('button').trigger('click');
    expect(open(w)).toEqual({ body: true, said: 'true', shut: false });
    await w.find('button').trigger('click');
    expect(open(w)).toEqual({ body: false, said: 'false', shut: true });
  });

  it('can be asked to start open', () => {
    expect(open(make({ open: true }))).toEqual({ body: true, said: 'true', shut: false });
  });

  it('keeps the body in the page while it is shut, so nothing has to be built again', () => {
    expect(make().find('.body-text').text()).toBe('Played 12');
  });

  it('names the body it controls, and keeps the arrow out of the heading', () => {
    const w = make();
    const body = w.find('button').attributes('aria-controls');
    expect(body).toBeTruthy();
    expect(w.find('.body').attributes('id')).toBe(body);
    // The arrow is drawn in CSS, so a game's name is all the heading says.
    expect(w.find('h2').text()).toBe('Hearts');
  });

  it('is a panel, so it looks like every other one on the page', () => {
    expect(make().classes()).toEqual(expect.arrayContaining(['panel', 'stack', 'collapsible']));
  });
});
