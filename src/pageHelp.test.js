import { describe, expect, it } from 'vitest';
import { pageHelp } from './pageHelp.js';

describe('page help', () => {
  it('has something to say on every page of the site', () => {
    for (const name of ['games', 'login', 'profile', 'stats', 'achievements', 'shop']) {
      expect(pageHelp({ name, params: {} })?.markdown.length, name).toBeGreaterThan(40);
    }
  });

  it('has nothing for a page it does not know, such as a game, which shows its own rules', () => {
    expect(pageHelp({ name: 'play', params: { game: 'hearts' } })).toBeNull();
  });

  it('explains the shop tab you are on, and what the gold is for', () => {
    const names = pageHelp({ name: 'shop', params: { tab: 'names' } }).markdown;
    const avatar = pageHelp({ name: 'shop', params: { tab: 'avatar' } }).markdown;
    expect(names).toContain('border and a background around your name');
    expect(avatar).toContain('Hair, clothes, hats');
    expect(avatar).not.toContain('border and a background');
    expect(names).toContain('100 for coming 1st');
    expect(pageHelp({ name: 'shop', params: {} }).markdown).toContain('## Names');
  });

  it('says what achievements pay, from the real amounts', () => {
    expect(pageHelp({ name: 'achievements', params: {} }).markdown).toContain('100 gold times its level number, so 100 for level 1 and 500 for level 5');
  });
});
