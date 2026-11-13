// Where the tour you are in has got to, as the site's socket last said.  TourBand.test.js sets the store by hand and
// checks what the band draws; this file protects the other half, which nothing else drives: what the store does with
// each thing the server says.  A tour that has finished clears (there is nowhere to go back to), a new word from the
// tour brings back a band you had hidden, and the listener outlives the socket, so signing out and in again still hears.
//
// The words arrive from the server, so they are also fuzzed (seeded): whatever arrives, the store keeps its shape.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickOne, seeded } from '../shared/random.js';
import { startSite, stopSite } from './siteFeed.js';
import { clearTour, tour } from './tourSession.js';

const NOTHING = { code: null, phase: null, game: null, gameCode: null };

/** A site socket that remembers who is listening, as socket.io's would. */
function fake() {
  const attached = [];
  return {
    on: vi.fn((event, handler) => attached.push([event, handler])),
    off: vi.fn(),
    close: vi.fn(),
    /** The server says something: everybody listening for `event` hears it. */
    say: (event, payload) => attached.filter(([e]) => e === event).forEach(([, handler]) => handler(payload)),
  };
}

let socket;
beforeEach(() => {
  stopSite();
  clearTour();
  socket = fake();
  startSite(() => socket);
});
afterEach(() => {
  stopSite();
  clearTour();
});

describe('the tour session', () => {
  it('is in no tour until it has been told about one', () => {
    expect(tour).toEqual({ ...NOTHING, dismissed: false });
  });

  it('keeps the last thing the tour said', () => {
    socket.say('tour', { code: 'boss-aware-you', phase: 'voting' });
    expect(tour).toEqual({ code: 'boss-aware-you', phase: 'voting', game: null, gameCode: null, dismissed: false });
    socket.say('tour', { code: 'boss-aware-you', phase: 'playing', game: 'hearts', gameCode: 'x-y-z' });
    expect(tour).toEqual({ code: 'boss-aware-you', phase: 'playing', game: 'hearts', gameCode: 'x-y-z', dismissed: false });
  });

  it('forgets the game when the tour moves on from it', () => {
    socket.say('tour', { code: 'boss-aware-you', phase: 'playing', game: 'hearts', gameCode: 'x-y-z' });
    socket.say('tour', { code: 'boss-aware-you', phase: 'voting' });
    expect(tour).toMatchObject({ phase: 'voting', game: null, gameCode: null });
  });

  it('clears when the tour has finished, since there is nowhere left to go back to', () => {
    socket.say('tour', { code: 'boss-aware-you', phase: 'playing', game: 'hearts', gameCode: 'x-y-z' });
    socket.say('tour', { code: 'boss-aware-you', phase: 'finished' });
    expect(tour).toEqual({ ...NOTHING, dismissed: false });
  });

  it('clears when it is told you are in no tour at all', () => {
    for (const payload of [null, undefined, {}, { code: null, phase: 'voting' }, { code: '', phase: 'voting' }]) {
      socket.say('tour', { code: 'boss-aware-you', phase: 'voting' });
      socket.say('tour', payload);
      expect(tour, JSON.stringify(payload)).toEqual({ ...NOTHING, dismissed: false });
    }
  });

  it('remembers that you hid the band, until the tour next says something', () => {
    socket.say('tour', { code: 'boss-aware-you', phase: 'voting' });
    clearTour(true);
    expect(tour).toEqual({ ...NOTHING, dismissed: true });
    socket.say('tour', { code: 'boss-aware-you', phase: 'playing', game: 'hearts', gameCode: 'x-y-z' });
    expect(tour.dismissed).toBe(false);
    expect(tour.game).toBe('hearts');
  });

  it('is not marked as hidden when the tour simply ends', () => {
    socket.say('tour', { code: 'boss-aware-you', phase: 'voting' });
    clearTour();
    expect(tour).toEqual({ ...NOTHING, dismissed: false });
  });

  it('still hears the tour after signing out and in again, without subscribing a second time', () => {
    stopSite();
    const second = fake();
    startSite(() => second);
    second.say('tour', { code: 'boss-aware-you', phase: 'voting' });
    expect(tour.code).toBe('boss-aware-you');
  });

  it('keeps its shape whatever the server says (seeded)', () => {
    const SEED = 1729;
    const rng = seeded(SEED);
    const ANY = [null, undefined, '', 'boss-aware-you', 'voting', 'opening', 'playing', 'finished', 'hearts', '<img src=x onerror=alert(1)>', '__proto__', 0, 1, true, false, [], {}, ['x'], { code: 'nested' }];
    for (let step = 0; step < 500; step++) {
      const any = () => pickOne(ANY, rng);
      const payload = rng() < 0.15 ? any() : JSON.parse(JSON.stringify({ code: any(), phase: any(), game: any(), gameCode: any(), dismissed: any(), [pickOne(['extra', 'constructor', 'toString'], rng)]: any() }));
      const where = `seed ${SEED} step ${step}: ${JSON.stringify(payload)}`;
      if (rng() < 0.1) clearTour(true);
      expect(() => socket.say('tour', payload), where).not.toThrow();
      expect(Object.keys(tour).sort(), where).toEqual(['code', 'dismissed', 'gameCode', 'game', 'phase'].sort());
      expect(tour.dismissed, where).toBe(false); // the tour has spoken: only hiding the band sets this
      if (!payload?.code || payload.phase === 'finished') expect(tour, where).toEqual({ ...NOTHING, dismissed: false });
      // In a tour or not: never half of one.
      if (tour.code === null) expect(tour, where).toEqual({ ...NOTHING, dismissed: false });
      else expect(tour.code, where).toEqual(payload.code);
    }
  });
});
