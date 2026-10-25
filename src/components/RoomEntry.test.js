import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import RoomEntry from './RoomEntry.vue';

const make = (props = {}) => mount(RoomEntry, { props, attachTo: document.body }); // a click only submits an attached form
afterEach(() => {
  document.body.innerHTML = '';
});
const joinButton = (w) => w.find('form button');

describe('RoomEntry', () => {
  it('emits create from the main button, labelled with the noun', async () => {
    const w = make({ noun: 'table' });
    const create = w.find('button.primary');
    expect(create.text()).toBe('Start a new table');
    await create.trigger('click');
    expect(w.emitted('create')).toHaveLength(1);
  });

  it('defaults the noun and honours createLabel and intro', () => {
    expect(make().find('button.primary').text()).toBe('Start a new game');
    const w = make({ createLabel: 'Go!', intro: 'Welcome' });
    expect(w.find('button.primary').text()).toBe('Go!');
    expect(w.find('.intro').text()).toBe('Welcome');
  });

  it('disables Join for anything that is not a code', async () => {
    const w = make();
    expect(joinButton(w).attributes('disabled')).toBeDefined();
    await w.find('input').setValue('boss-aware');
    expect(joinButton(w).attributes('disabled')).toBeDefined();
    await w.find('input').setValue('boss-aware-you');
    expect(joinButton(w).attributes('disabled')).toBeUndefined();
  });

  it.each([
    ['boss-aware-you', 'boss-aware-you'],
    ['  Boss Aware You  ', 'boss-aware-you'],
    ['BOSS-AWARE-YOU', 'boss-aware-you'],
    ['https://example.com/play/dixnt?boss-aware-you', 'boss-aware-you'],
    ['http://localhost:5173/play/hearts?code=Boss-Aware-You', 'boss-aware-you'],
    ['?boss-aware-you', 'boss-aware-you'],
  ])('normalises %j when joining', async (typed, expected) => {
    const w = make();
    await w.find('input').setValue(typed);
    await joinButton(w).trigger('click');
    expect(w.emitted('join')).toEqual([[expected]]);
  });

  it('joins on Enter in the box', async () => {
    const w = make();
    await w.find('input').setValue('Boss Aware You');
    await w.find('form').trigger('submit');
    expect(w.emitted('join')).toEqual([['boss-aware-you']]);
  });

  it('does not join on Enter when the text is not a code', async () => {
    const w = make();
    await w.find('input').setValue('hello');
    await w.find('form').trigger('submit');
    expect(w.emitted('join')).toBeUndefined();
  });

  it('prefills from initialCode', () => {
    const w = make({ initialCode: 'boss-aware-you' });
    expect(w.find('input').element.value).toBe('boss-aware-you');
    expect(joinButton(w).attributes('disabled')).toBeUndefined();
  });

  it('disables Create and Join while busy', async () => {
    const w = make({ busy: true, initialCode: 'boss-aware-you' });
    expect(w.find('button.primary').attributes('disabled')).toBeDefined();
    expect(joinButton(w).attributes('disabled')).toBeDefined();
  });

  it('shows an error as an alert only when there is one', () => {
    expect(make().find('[role="alert"]').exists()).toBe(false);
    expect(make({ error: 'No such game.' }).find('[role="alert"]').text()).toBe('No such game.');
  });
});
