import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { session } from '../session.js';
import AchievementsView from './AchievementsView.vue';

function reply(body, status = 200) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** An achievement as the server describes it (see shared/achievements.js describe()). */
function made(id, name, levels, value, text = (n) => `Do it ${n} times`, { stat = null, label = null } = {}) {
  const level = levels.filter((n) => value >= n).length;
  const next = levels[level];
  return {
    id,
    key: id.split('.')[1],
    name,
    stat,
    label,
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
  { id: 'global', name: 'Global', achievements: [made('global.cards', 'Played cards', [100, 500, 1000, 5000, 10000], 600, (n) => `Play ${n.toLocaleString('en-GB')} cards`, { label: 'Cards played in every game' })] },
  {
    id: 'hearts',
    name: 'Hearts',
    achievements: [
      made('hearts.perfect', 'Perfect game', [1], 1, () => 'Finish a game with no points'),
      made('hearts.moon', 'Shot the moon', [1, 5], 0),
      made('hearts.jack', 'Jack of Diamonds', [10, 50], 12, undefined, { stat: 'jacks', label: 'Jacks of Diamonds taken' }),
      made('hearts.won', 'Won the game', [1, 5, 10], 3, undefined, { stat: 'wins', label: 'Number of games won' }),
      made('hearts.secret', 'Hidden away', [1], 0, () => 'Do something rare'),
    ],
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
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'The achievements are being rebuilt.' }, 503)));
    wrapper = mount(AchievementsView);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('The achievements are being rebuilt.');
  });

  it('lists the global achievements and then each game in its own section', async () => {
    await make();
    expect(wrapper.text()).toContain('Achievements for Ann');
    expect(wrapper.findAll('[data-section]').map((s) => s.attributes('data-section'))).toEqual(['global', 'hearts']);
    // The site's own section is headed in the site's words; a game's by its name, which a language may translate.
    expect(wrapper.find('[data-section="global"] h2').text()).toBe('Game Hub');
    expect(wrapper.find('[data-section="hearts"] h2').text()).toBe('Hearts');
    expect(wrapper.findAll('[data-section="hearts"] [data-achievement]')).toHaveLength(5);
  });

  it('shows the level reached and the progress towards the next one', async () => {
    await make();
    const cards = box('global.cards');
    expect(cards.text()).toContain('Level 2');
    expect(cards.text()).toContain('Cards played in every game');
    expect(cards.text()).toContain('600 / 1,000');
    // The level it is working towards and that level's number are drawn once each, not repeated in the line below the pips.
    expect(cards.find('.goal').text()).toBe('Cards played in every game');
    expect(cards.text()).not.toContain('Level 3');
    expect(cards.text()).not.toContain('Play 1,000 cards');
    expect(cards.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('60');
    expect(cards.find('.bar i').attributes('style')).toContain('width: 60%');
    expect(cards.findAll('.pips li.on')).toHaveLength(2);
    expect(cards.findAll('.pips li')).toHaveLength(5);
  });

  it('marks a finished achievement complete, and shows an unstarted one at zero', async () => {
    await make();
    const perfect = box('hearts.perfect');
    expect(perfect.classes()).toContain('complete');
    expect(perfect.text()).toContain('Unlocked');
    expect(perfect.text()).toContain('Finish a game with no points');
    expect(perfect.text()).not.toContain('Level');
    expect(perfect.find('.pips').exists()).toBe(false);
    expect(perfect.find('[role="progressbar"]').exists()).toBe(false);
    expect(perfect.find('.count').exists()).toBe(false);
    const moon = box('hearts.moon');
  });

  it('shows an achievement with levels, and how far along you are, before the first level is earned', async () => {
    await make();
    const moon = box('hearts.moon');
    expect(moon.classes()).toContain('locked'); // nothing earned, so it is drawn dimmed
    expect(moon.find('h3').text()).toBe('Shot the moon'); // but it is no secret
    expect(moon.text()).toContain('Locked');
    expect(moon.text()).toContain('Do it 1 times'); // what the first level asks for
    expect(moon.find('[role="progressbar"]').exists()).toBe(true);
    expect(moon.find('.pips').exists()).toBe(true);
    expect(box('global.cards').find('h3').text()).toBe('Played cards');
  });

  it('keeps a one-off unlock secret as ??? until it is earned, and only that kind', async () => {
    await make();
    const secret = box('hearts.secret');
    expect(secret.classes()).toContain('locked');
    expect(secret.find('h3').text()).toBe('???');
    expect(secret.text()).toContain('Locked');
    expect(secret.text()).not.toContain('Hidden away');
    expect(secret.text()).not.toContain('Do something rare');
    expect(secret.find('[role="progressbar"]').exists()).toBe(false);
    expect(secret.find('.pips').exists()).toBe(false);
  });

  it('says what the number counts, from the stat it reads where there is one', async () => {
    await make();
    // A game's own stat is labelled in its module.json, and the server sends that label along.
    expect(box('hearts.jack').find('.goal').text()).toBe('Jacks of Diamonds taken');
    // The stats every game has are labelled by the site, in the site's language.
    expect(box('hearts.won').find('.goal').text()).toBe('Number of games won');
    // A definition that names nothing still says something: what the level it is working towards asks for.
    expect(box('hearts.moon').find('.goal').text()).toBe('Do it 1 times');
  });

  it('counts the levels unlocked in each section', async () => {
    await make();
    expect(wrapper.find('[data-section="global"] .tally').text()).toBe('2 of 5 levels');
    expect(wrapper.find('[data-section="hearts"] .tally').text()).toBe('3 of 9 levels');
  });
});
