import { describe, expect, it, vi } from 'vitest';
import { claimSteve, installSteve, STEVE_BANNER } from './steve.js';

describe('Steve', () => {
  it('prints the banner, which says how to claim the reward', () => {
    const log = vi.fn();
    installSteve({}, log);
    expect(log).toHaveBeenCalledWith(STEVE_BANNER);
    expect(STEVE_BANNER).toContain('88aaaaaaaa88');
    expect(STEVE_BANNER.endsWith('Type `claim_steves_achievement()` to get your reward.')).toBe(true);
  });
  it('defines the function on the window, and it asks the server to unlock the achievement', async () => {
    const target = {};
    installSteve(target, () => {});
    expect(typeof target.claim_steves_achievement).toBe('function');
    const call = vi.fn().mockResolvedValue({ ok: true });
    expect(await claimSteve(call)).toMatch(/is yours/);
    expect(call).toHaveBeenCalledWith('POST', '/api/achievements/steve', {});
  });
  it('tells someone who is not signed in to sign in', async () => {
    expect(await claimSteve(vi.fn().mockRejectedValue(new Error('Please sign in.')))).toMatch(/Sign in first/);
  });
});
