import { describe, expect, it } from 'vitest';
import { AVATAR_SLOTS, DEFAULT_AVATAR } from '../shared/avatar.js';
import { avatarMarkup, robotMarkup } from './avatarArt.js';

describe('avatarMarkup', () => {
  it('draws the default avatar for nothing at all, and for rubbish', () => {
    expect(avatarMarkup(null).replace(/avatar-gradient-d+/g, 'g')).toBe(avatarMarkup(DEFAULT_AVATAR).replace(/avatar-gradient-d+/g, 'g'));
    expect(avatarMarkup({ hair: '<script>', eyes: 7 })).not.toContain('<script>');
  });

  it('can draw every option of every slot, and each one changes the picture', () => {
    const base = avatarMarkup(DEFAULT_AVATAR).replace(/avatar-gradient-\d+/g, 'g');
    for (const { slot, options } of AVATAR_SLOTS) {
      for (const option of options.slice(1)) {
        const drawn = avatarMarkup({ ...DEFAULT_AVATAR, [slot]: option.id }).replace(/avatar-gradient-\d+/g, 'g');
        expect(drawn, `${slot}:${option.id}`).not.toBe(base);
      }
    }
  });

  it('gives each gradient backdrop its own id, so two avatars on a page cannot share one', () => {
    const a = avatarMarkup({ backdrop: 'sunset' });
    const b = avatarMarkup({ backdrop: 'sunset' });
    expect(a.match(/id="(avatar-gradient-\d+)"/)[1]).not.toBe(b.match(/id="(avatar-gradient-\d+)"/)[1]);
  });
});

describe('robotMarkup', () => {
  const plain = () => robotMarkup().replace(/robot-(steel|sky)-\d+/g, 'g');

  it('draws the same robot every time, with nothing but our own shapes', () => {
    expect(plain()).toBe(plain());
    expect(robotMarkup()).not.toContain('<script');
  });

  it('gives every robot its own gradient ids, so two on a page cannot share them', () => {
    expect(robotMarkup().match(/id="(robot-steel-\d+)"/)[1]).not.toBe(robotMarkup().match(/id="(robot-steel-\d+)"/)[1]);
  });
});
