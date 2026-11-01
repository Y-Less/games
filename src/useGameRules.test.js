import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameRules } from './useGameRules.js';

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const reply = (text, status = 200) => ({ ok: status === 200, status, text: async () => text });

describe('useGameRules', () => {
  it('opens the pop-up and loads the rules once, as rendered HTML', async () => {
    fetchMock.mockResolvedValue(reply('# Rules\n\nPlay nicely.'));
    const { rules, showRules, openRules } = useGameRules(() => 'hearts');
    expect(rules.value).toBeNull();
    await openRules();
    expect(showRules.value).toBe(true);
    expect(rules.value).toContain('Play nicely.');
    await openRules();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/games/hearts/rules?lang=en');
  });

  it('says so when the game has no written rules', async () => {
    fetchMock.mockResolvedValue(reply(JSON.stringify({ error: 'No rules for that game.' }), 404));
    const { rules, openRules } = useGameRules(() => 'blank');
    await openRules();
    expect(rules.value).toBe('<p>This game has no written rules yet.</p>');
  });
});
