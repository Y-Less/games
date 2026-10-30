import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { session } from '../session.js';
import AchievementsView from './AchievementsView.vue';

function reply(body, status = 200) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** An achievement as the server describes it (see shared/achievements.js describe()). */
function made(id, name, levels, value, text = (n) => `Do it ${n} times`) {
  const level = levels.filter((n) => value >= n).length;
  const next = levels[level];
  return {
    id,
    key: id.split('.')[1],
    name,
    value,
    level,
    maxLevel: levels.length,
    levels: levels.map((n, i) => ({ n, text: text(n), done: i < level })),
    current: level ? { n: levels[level - 1], text: text(levels[level - 1]) } : null,
    next: next === undefined ? null : { n: next, text: text(next) },
    progress: next === undefined ? 1 : Math.min(1, value / next),
  };
}

const sections = [
  { id: 'global', name: 'Global', achievements: [made('global.cards', 'Played cards', [100, 500, 1000, 5000, 10000], 600, (n) => `Play ${n.toLocaleString('en-GB')} cards`)] },
  {
    id: 'hearts',
    name: 'Hearts',
    achievements: [made('hearts.perfect', 'Perfect game', [1], 1, () => 'Finish a game with no points'), made('hearts.moon', 'Shot the moon', [1, 5], 0)],
  },
];

let wrapper;
beforeEach(() => {
  session.user = { id: 1, displayName: 'Ann' };
});
afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
});

async function make() {
  vi.stubGlobal('fetch', vi.fn(async () => reply({ sections })));
  wrapper = mount(AchievementsView);
  await flushPromises();
  return wrapper;
}
const box = (id) => wrapper.find(`[data-achievement="${id}"]`);

describe('AchievementsView', () => {
  it('says it is loading, then shows an error if the server refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    wrapper = mount(AchievementsView);
    expect(wrapper.text()).toContain('Loading');
    wrapper.unmount();
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'Please sign in.' }, 401)));
    wrapper = mount(AchievementsView);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('Please sign in.');
  });

  it('lists the global achievements and then each game in its own section', async () => {
    await make();
    expect(wrapper.text()).toContain('Achievements for Ann');
    expect(wrapper.findAll('[data-section]').map((s) => s.attributes('data-section'))).toEqual(['global', 'hearts']);
    expect(wrapper.find('[data-section="hearts"] h2').text()).toBe('Hearts');
    expect(wrapper.findAll('[data-section="hearts"] [data-achievement]')).toHaveLength(2);
  });

  it('shows the level reached and the progress towards the next one', async () => {
    await make();
    const cards = box('global.cards');
    expect(cards.text()).toContain('Level 2');
    expect(cards.text()).toContain('Level 3: Play 1,000 cards');
    expect(cards.text()).toContain('600 / 1,000');
    expect(cards.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('60');
    expect(cards.find('.bar i').attributes('style')).toContain('width: 60%');
    expect(cards.findAll('.pips li.on')).toHaveLength(2);
    expect(cards.findAll('.pips li')).toHaveLength(5);
  });

  it('marks a finished achievement complete, and shows an unstarted one at zero', async () => {
    await make();
    const perfect = box('hearts.perfect');
    expect(perfect.classes()).toContain('complete');
    expect(perfect.text()).toContain('Complete');
    expect(perfect.text()).toContain('Finish a game with no points');
    expect(perfect.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('100');
    const moon = box('hearts.moon');
    expect(moon.text()).toContain('Not started');
    expect(moon.text()).toContain('Level 1: Do it 1 times');
    expect(moon.text()).toContain('0 / 1');
    expect(moon.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('0');
  });

  it('counts the levels unlocked in each section', async () => {
    await make();
    expect(wrapper.find('[data-section="global"] .tally').text()).toBe('2 of 5 levels');
    expect(wrapper.find('[data-section="hearts"] .tally').text()).toBe('1 of 3 levels');
  });
});
