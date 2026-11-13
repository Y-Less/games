// The one shared store of who is signed in, the games, and the preset looks.  It lives in its own file so that
// session.js, shopStore.js, and profileApi.js can all reach it without importing each other; the two things that must
// stay true for that to work are that everybody gets the *same* object, and that it is reactive, so a change made by one
// of them redraws whatever reads it.  The starting values matter too: `ready` is false until the session has loaded (the
// router waits on it), and `shop` is null until the listing has been fetched (nothing is locked before then).
import { describe, expect, it } from 'vitest';
import { isReactive, nextTick, watchEffect } from 'vue';
import { session as fromSession } from './session.js';
import { session } from './sessionState.js';

describe('the session store', () => {
  // First, before any other test has touched the store.
  it('starts with nobody signed in, nothing loaded, and no shop listing', () => {
    expect(session.ready).toBe(false);
    expect(session.user).toBeNull();
    expect(session.games).toEqual([]);
    expect(session.presets).toEqual({});
    expect(session.cardBacks).toEqual({});
    expect(session.shop).toBeNull();
  });

  it('is the same object session.js hands out, so a change made through one is seen through the other', () => {
    expect(fromSession).toBe(session);
  });

  it('is reactive: a change redraws whatever reads it', async () => {
    expect(isReactive(session)).toBe(true);
    const seen = [];
    const stop = watchEffect(() => seen.push(session.user?.displayName ?? null));
    session.user = { id: 1, displayName: 'Ann' };
    await nextTick();
    session.user = null;
    await nextTick();
    stop();
    expect(seen).toEqual([null, 'Ann', null]);
  });
});
