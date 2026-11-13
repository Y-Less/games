// What the site knows about other players' looks.  A table draws a chip for every player and each chip asks for its
// player's profile, so the promises in profiles.js's header are what keep a busy table cheap and correct: everybody who
// asks in the same moment shares one request, a fetched profile is kept for a minute, your own comes from the session
// (so a change you make shows at once), and a server that cannot be reached leaves the names plain rather than broken.
//
// Time is faked throughout, so nothing here waits or depends on how busy the machine is.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { clearProfiles, profileOf } from './profiles.js';
import { session } from './session.js';

const BOB = { displayName: 'Bob', nameStyle: { style: 'ruby' }, avatar: { hat: 'crown' } };
const CAT = { displayName: 'Cat', nameStyle: { style: 'gold' }, avatar: null };
const MINUTE = 60 * 1000;

let known; // id -> profile, as the server has them
let requests; // the ids of each request made, in order
let down; // true while the server cannot be reached

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  clearProfiles();
  session.user = { id: 1, displayName: 'Me', nameStyle: { style: 'gold' } };
  known = { 2: BOB, 3: CAT };
  requests = [];
  down = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const address = new URL(url, 'http://site');
      expect(address.pathname).toBe('/api/players');
      const ids = address.searchParams.get('ids').split(',').map(Number);
      requests.push(ids);
      if (down) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, text: async () => JSON.stringify({ players: Object.fromEntries(ids.filter((id) => known[id]).map((id) => [id, known[id]])) }) };
    }),
  );
});
afterEach(() => {
  clearProfiles();
  session.user = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Lets the pending batch go and its reply arrive. */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(50);
  await flushPromises();
};

describe('profileOf', () => {
  it('has nothing, and asks for nothing, for something that is not an account id', async () => {
    for (const id of [null, undefined, '2', 2.5, NaN, {}, 'Bob']) expect(profileOf(id), String(id)).toBeNull();
    await settle();
    expect(requests).toEqual([]);
  });

  it('reads your own profile from the session, so a change you make shows at once', async () => {
    expect(profileOf(1)).toBe(session.user);
    session.user = { id: 1, displayName: 'Me', nameStyle: { style: 'ruby' } };
    expect(profileOf(1).nameStyle.style).toBe('ruby');
    await settle();
    expect(requests).toEqual([]);
  });

  it('has nothing until the profile has arrived, and the profile once it has', async () => {
    expect(profileOf(2)).toBeNull();
    await settle();
    expect(profileOf(2)).toEqual(BOB);
  });

  it('fetches everybody asked for in the same moment with one request, each of them once', async () => {
    for (const id of [2, 3, 2, 4, 3, 2]) profileOf(id);
    await settle();
    expect(requests).toHaveLength(1);
    expect([...requests[0]].sort()).toEqual([2, 3, 4]);
    expect(profileOf(3)).toEqual(CAT);
  });

  it('redraws whatever is showing a player when their profile arrives', async () => {
    const style = computed(() => profileOf(2)?.nameStyle.style ?? 'plain');
    expect(style.value).toBe('plain');
    await settle();
    expect(style.value).toBe('ruby');
  });

  it('keeps a profile for a minute without asking again, and asks again once it is older than that', async () => {
    profileOf(2);
    await settle();
    await vi.advanceTimersByTimeAsync(MINUTE - 1000);
    profileOf(2);
    await settle();
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    known[2] = { ...BOB, nameStyle: { style: 'emerald' } };
    profileOf(2);
    await settle();
    expect(requests).toHaveLength(2);
    expect(profileOf(2).nameStyle.style).toBe('emerald');
  });

  it('has nothing for a player the server does not know', async () => {
    profileOf(99);
    await settle();
    expect(requests).toEqual([[99]]);
    expect(profileOf(99)).toBeNull();
  });

  it('leaves the name plain, and breaks nothing, when the server cannot be reached', async () => {
    down = true;
    expect(profileOf(2)).toBeNull();
    await settle();
    expect(requests).toEqual([[2]]);
    expect(profileOf(2)).toBeNull();
  });

  it('asks in a later batch for somebody who is asked for after one has gone', async () => {
    profileOf(2);
    await settle();
    profileOf(3);
    await settle();
    expect(requests).toEqual([[2], [3]]);
  });
});

describe('clearProfiles', () => {
  it('forgets what was fetched, so the next page asks afresh', async () => {
    profileOf(2);
    await settle();
    clearProfiles();
    expect(profileOf(2)).toBeNull();
    await settle();
    expect(requests).toEqual([[2], [2]]);
  });

  it('drops a batch that had not gone yet', async () => {
    profileOf(2);
    clearProfiles();
    await settle();
    expect(requests).toEqual([]);
  });
});
