import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ScoreBoard from './ScoreBoard.vue';

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

const players = [
  { id: 'a', name: 'Ann', score: 30, isMe: true },
  { id: 'b', name: 'Bob', score: 20, note: 'dealer' },
  { id: 'c', name: 'Cat', score: 10, away: true },
];
const round1 = { label: 'Hand 1', deltas: { a: 10, b: 5, c: 0 } };
const round2 = { label: 'Hand 2', deltas: { a: 20, b: 15, c: 10 } };

function make(props = {}, options = {}) {
  wrapper = mount(ScoreBoard, { attachTo: document.body, props: { players, rounds: [], ...props }, ...options });
  return wrapper;
}
const dialog = () => document.body.querySelector('[role="dialog"]');
const chips = () => wrapper.findAll('.chip');
const leaders = () => chips().filter((c) => c.classes('lead')).map((c) => c.find('.name').text());

describe('ScoreBoard bar', () => {
  it('always renders every current score', () => {
    make();
    expect(chips().map((c) => [c.find('.name').text(), c.find('.points').text()])).toEqual([
      ['Ann (you)', '30'],
      ['Bob', '20'],
      ['Cat', '10'],
    ]);
    expect(dialog()).toBeNull();
  });

  it('shows notes and marks away players', () => {
    make();
    expect(chips()[1].find('small').text()).toBe('dealer');
    expect(chips()[2].classes('away')).toBe(true);
    expect(chips()[0].classes('me')).toBe(true);
  });

  it('marks the leader when scores differ', () => {
    make();
    expect(leaders()).toEqual(['Ann (you)']);
  });

  it('marks every tied leader', () => {
    make({ players: [{ id: 'a', name: 'A', score: 5 }, { id: 'b', name: 'B', score: 5 }, { id: 'c', name: 'C', score: 1 }] });
    expect(leaders()).toEqual(['A', 'B']);
  });

  it('marks no leader when everyone is level', () => {
    make({ players: [{ id: 'a', name: 'A', score: 0 }, { id: 'b', name: 'B', score: 0 }] });
    expect(leaders()).toEqual([]);
  });

  it('respects lowIsBetter for the leader', () => {
    make({ lowIsBetter: true });
    expect(leaders()).toEqual(['Cat']);
  });

  it('is sticky unless asked otherwise', async () => {
    make();
    expect(wrapper.find('.score-bar').classes('sticky')).toBe(true);
    await wrapper.setProps({ sticky: false });
    expect(wrapper.find('.score-bar').classes('sticky')).toBe(false);
  });

  it('opens the pop-up from the All rounds button, titled Scores so far', async () => {
    make({ rounds: [round1] });
    await wrapper.find('button.all').trigger('click');
    expect(dialog()).not.toBeNull();
    expect(dialog().getAttribute('aria-label')).toBe('Scores so far');
    expect(dialog().textContent).toContain('Hand 1');
  });
});

describe('ScoreBoard pop-up', () => {
  it('opens by itself when a round is added', async () => {
    make({ rounds: [round1] });
    expect(dialog()).toBeNull();
    await wrapper.setProps({ rounds: [round1, round2] });
    expect(dialog()).not.toBeNull();
    expect(dialog().getAttribute('aria-label')).toBe('Scores after Hand 2');
  });

  it('does not open for history that is present at mount', async () => {
    make({ rounds: [round1, round2] });
    expect(dialog()).toBeNull();
    await wrapper.setProps({ players: players.map((p) => ({ ...p, score: p.score + 1 })) });
    expect(dialog()).toBeNull();
  });

  it('does not open when autoOpen is false', async () => {
    make({ rounds: [round1], autoOpen: false });
    await wrapper.setProps({ rounds: [round1, round2] });
    expect(dialog()).toBeNull();
    await wrapper.setProps({ finished: true });
    expect(dialog()).toBeNull();
  });

  it('does not reopen when the round count falls (a new game)', async () => {
    make({ rounds: [round1, round2] });
    await wrapper.setProps({ rounds: [] });
    expect(dialog()).toBeNull();
    await wrapper.setProps({ rounds: [round1] });
    expect(dialog()).not.toBeNull();
  });

  it('opens at the end with a single winner line', async () => {
    make({ rounds: [round1, round2] });
    await wrapper.setProps({ finished: true });
    expect(dialog().getAttribute('aria-label')).toBe('Final scores');
    expect(dialog().querySelector('.winner').textContent.trim()).toBe('Ann (you) wins!');
    expect(dialog().querySelector('button.primary').textContent).toBe('Close');
  });

  it('names another winner without (you)', async () => {
    make({ players: players.map((p) => ({ ...p, score: -p.score })), rounds: [round1] });
    await wrapper.setProps({ finished: true });
    expect(dialog().querySelector('.winner').textContent.trim()).toBe('Cat wins!');
  });

  it('words a tie', async () => {
    make({ players: [{ id: 'a', name: 'Ann', score: 9 }, { id: 'b', name: 'Bob', score: 9 }, { id: 'c', name: 'Cat', score: 1 }], rounds: [round1] });
    await wrapper.setProps({ finished: true });
    expect(dialog().querySelector('.winner').textContent.trim()).toBe('A tie: Ann and Bob win.');
  });

  it('uses lowIsBetter to pick the winner', async () => {
    make({ lowIsBetter: true, rounds: [round1] });
    await wrapper.setProps({ finished: true });
    expect(dialog().querySelector('.winner').textContent.trim()).toBe('Cat wins!');
  });

  it('has no winner line before the end', async () => {
    make({ rounds: [round1] });
    await wrapper.setProps({ rounds: [round1, round2] });
    expect(dialog().querySelector('.winner')).toBeNull();
    expect(dialog().querySelector('button.primary').textContent).toBe('Continue');
  });

  it('opens at the end if it was already finished and showing history only on request', async () => {
    make({ rounds: [round1], finished: true });
    expect(dialog()).toBeNull();
    await wrapper.find('button.all').trigger('click');
    expect(dialog().getAttribute('aria-label')).toBe('Final scores');
  });

  it('Continue emits continue then closed and closes', async () => {
    make({ rounds: [round1] });
    await wrapper.setProps({ rounds: [round1, round2] });
    dialog().querySelector('button.primary').click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('continue')).toHaveLength(1);
    expect(wrapper.emitted('closed')).toHaveLength(1);
    expect(dialog()).toBeNull();
  });

  it('Escape, Close and clicking outside the round pop-up also say continue, but only the first time', async () => {
    make({ rounds: [round1] });
    await wrapper.setProps({ rounds: [round1, round2] });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('continue')).toHaveLength(1);
    await wrapper.find('button.all').trigger('click');
    document.body.querySelector('button[aria-label="Close"]').click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('continue')).toHaveLength(1);
  });

  it('shows who is still to close it, and ticks the people who have', async () => {
    make({ rounds: [round1], players: players.map((p) => ({ ...p, ready: p.id === 'b' })), waiting: ['Ann', 'Cat'] });
    await wrapper.setProps({ rounds: [round1, round2] });
    expect(dialog().querySelector('.waiting').textContent).toContain('Waiting for Ann, Cat');
    expect(chips().map((c) => c.find('.tick:not(.unready)').exists())).toEqual([false, true, false]);
  });

  it('brings the pop-up back for someone who still has to close it, and drops it when the game moves on', async () => {
    make({ rounds: [round1], awaiting: true });
    expect(dialog()).not.toBeNull();
    expect(dialog().getAttribute('aria-label')).toBe('Scores after Hand 1');
    await wrapper.setProps({ awaiting: false });
    expect(dialog()).toBeNull();
    expect(wrapper.emitted('continue')).toBeUndefined();
  });

  it('does not need the final pop-up to be closed to be ready', async () => {
    make({ rounds: [round1], finished: true, awaiting: true });
    await wrapper.find('button.all').trigger('click');
    document.body.querySelector('button.primary').click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('continue')).toBeUndefined();
  });

  it('emits closed (but not continue) when dismissed with Escape or Close', async () => {
    make({ rounds: [round1] });
    await wrapper.find('button.all').trigger('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('closed')).toHaveLength(1);
    expect(wrapper.emitted('continue')).toBeUndefined();
    expect(dialog()).toBeNull();
  });

  it('Close from the head also emits closed once', async () => {
    make({ rounds: [round1] });
    await wrapper.find('button.all').trigger('click');
    document.body.querySelector('button[aria-label="Close"]').click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('closed')).toHaveLength(1);
  });

  it('forgets the "after round" title once closed', async () => {
    make({ rounds: [round1] });
    await wrapper.setProps({ rounds: [round1, round2] });
    document.body.querySelector('button.primary').click();
    await wrapper.vm.$nextTick();
    await wrapper.find('button.all').trigger('click');
    expect(dialog().getAttribute('aria-label')).toBe('Scores so far');
  });

  it('exposes show and close', async () => {
    make({ rounds: [round1] });
    wrapper.vm.show();
    await wrapper.vm.$nextTick();
    expect(dialog()).not.toBeNull();
    wrapper.vm.close();
    await wrapper.vm.$nextTick();
    expect(dialog()).toBeNull();
    expect(wrapper.emitted('closed')).toHaveLength(1);
  });

  it('renders the round slot above the table and the footer slot in place of Continue', async () => {
    make(
      { rounds: [round1] },
      { slots: { round: '<p class="extra">Details</p>', footer: '<button class="mine">Next hand</button>' } },
    );
    await wrapper.find('button.all').trigger('click');
    const body = dialog();
    const extra = body.querySelector('.extra');
    expect(extra).not.toBeNull();
    expect(extra.compareDocumentPosition(body.querySelector('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.querySelector('.mine')).not.toBeNull();
    expect(body.querySelector('button.primary')).toBeNull();
  });

  it('passes the target and running totals to the table', async () => {
    make({ rounds: [round1], target: 121, running: true });
    await wrapper.find('button.all').trigger('click');
    expect(dialog().querySelector('tfoot th').textContent).toContain('/ 121');
    expect(dialog().querySelector('.run')).not.toBeNull();
  });
});

describe('ScoreBoard without round pop-ups', () => {
  it('stays closed when a round ends, but still opens at the end and from the button', async () => {
    make({ roundPopups: false, rounds: [round1] });
    await wrapper.setProps({ rounds: [round1, round2] });
    expect(dialog()).toBeNull();
    await wrapper.setProps({ finished: true });
    expect(dialog()).not.toBeNull();
    expect(dialog().textContent).toContain('Final scores');
    expect(dialog().textContent).toContain('Hand 2');
  });

  it('does not bring a missed round pop-up back for a person who is awaited', () => {
    make({ roundPopups: false, rounds: [round1], awaiting: true });
    expect(dialog()).toBeNull();
  });
});
