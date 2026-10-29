import { describe, expect, it } from 'vitest';
import { AVATAR_SLOTS, DEFAULT_AVATAR } from '../shared/avatar.js';
import { avatarMarkup } from './avatarArt.js';

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
