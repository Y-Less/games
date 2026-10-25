import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayingCard from './PlayingCard.vue';

const make = (props = {}) => mount(PlayingCard, { props });

describe('PlayingCard face', () => {
  it('shows rank and suit symbol at both corners and in the middle', () => {
    const w = make({ card: 'QS' });
    expect(w.classes()).toContain('face');
    expect(w.classes()).not.toContain('card-back');
    expect(w.findAll('.corner b').map((b) => b.text())).toEqual(['Q', 'Q']);
    expect(w.findAll('.corner i').map((i) => i.text())).toEqual(['♠', '♠']);
    expect(w.find('.pip').text()).toBe('♠');
  });

  it('handles the two-digit rank', () => {
    expect(make({ card: '10H' }).find('.corner b').text()).toBe('10');
  });

  it.each([['2H', true], ['AD', true], ['KS', false], ['3C', false]])('%s red = %s', (card, red) => {
    expect(make({ card }).classes('red')).toBe(red);
  });

  it.each([['QS', 'queen of spades'], ['10H', '10 of hearts'], ['AC', 'ace of clubs'], ['JD', 'jack of diamonds'], ['KH', 'king of hearts']])(
    '%s is labelled %s',
    (card, label) => {
      expect(make({ card }).attributes('aria-label')).toBe(label);
    },
  );
});

describe('PlayingCard back', () => {
  it('is a face-down card when there is no card', () => {
    const w = make();
    expect(w.classes()).toContain('card-back');
    expect(w.classes()).not.toContain('face');
    expect(w.classes()).not.toContain('red');
    expect(w.attributes('aria-label')).toBe('face-down card');
    expect(w.find('.corner').exists()).toBe(false);
    expect(w.find('.pip').exists()).toBe(false);
  });
});

describe('PlayingCard sizes and states', () => {
  it('defaults to md and applies sm and lg', () => {
    expect(make({ card: 'AS' }).classes()).toContain('md');
    expect(make({ card: 'AS', size: 'sm' }).classes()).toContain('sm');
    expect(make({ card: 'AS', size: 'lg' }).classes()).toContain('lg');
  });

  it('applies selected and dimmed classes', () => {
    const w = make({ card: 'AS', selected: true, dimmed: true });
    expect(w.classes()).toEqual(expect.arrayContaining(['selected', 'dimmed']));
    const plain = make({ card: 'AS' });
    expect(plain.classes()).not.toContain('selected');
    expect(plain.classes()).not.toContain('dimmed');
  });
});

describe('PlayingCard clicking', () => {
  it('is a plain element and ignores clicks unless clickable', async () => {
    const w = make({ card: 'AS' });
    expect(w.element.tagName).toBe('DIV');
    await w.trigger('click');
    expect(w.emitted('pick')).toBeUndefined();
    expect(w.attributes('aria-pressed')).toBeUndefined();
  });

  it('is a button that emits pick with the card when clickable', async () => {
    const w = make({ card: 'QS', clickable: true });
    expect(w.element.tagName).toBe('BUTTON');
    expect(w.attributes('type')).toBe('button');
    await w.trigger('click');
    expect(w.emitted('pick')).toEqual([['QS']]);
  });

  it('reports selection through aria-pressed', () => {
    expect(make({ card: 'QS', clickable: true, selected: true }).attributes('aria-pressed')).toBe('true');
    expect(make({ card: 'QS', clickable: true }).attributes('aria-pressed')).toBe('false');
  });

  it('does not emit when disabled', async () => {
    const w = make({ card: 'QS', clickable: true, disabled: true });
    expect(w.attributes('disabled')).toBeDefined();
    await w.trigger('click');
    expect(w.emitted('pick')).toBeUndefined();
  });

  it('emits null for a clickable face-down card', async () => {
    const w = make({ clickable: true });
    await w.trigger('click');
    expect(w.emitted('pick')).toEqual([[null]]);
  });
});
