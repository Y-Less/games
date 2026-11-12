// The one site socket the whole page shares: who it attaches, when, and what survives signing out and back in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onSite, siteSocket, startSite, stopSite } from './siteFeed.js';

/** A socket that records what was attached to it, as socket.io's would be. */
function fake() {
  const attached = [];
  return {
    attached,
    on: vi.fn((event, handler) => attached.push([event, handler])),
    off: vi.fn((event, handler) => {
      const at = attached.findIndex(([e, h]) => e === event && h === handler);
      if (at !== -1) attached.splice(at, 1);
    }),
    close: vi.fn(),
    /** The handlers waiting for an event, in the order they were added. */
    for: (event) => attached.filter(([e]) => e === event).map(([, handler]) => handler),
  };
}

// The listeners deliberately outlive the socket, so each test takes its own away again or the next one inherits them.
let cleanup = [];
/** Subscribes, and remembers how to unsubscribe when the test is over.  @returns {() => void} the unsubscribe */
const listen = (event, handler) => {
  const off = onSite(event, handler);
  cleanup.push(off);
  return off;
};

describe('the site feed', () => {
  beforeEach(() => stopSite());
  afterEach(() => {
    cleanup.forEach((off) => off());
    cleanup = [];
    stopSite();
  });

  it('opens one socket however many times it is asked, and closes it on the way out', () => {
    const socket = fake();
    const connect = vi.fn(() => socket);
    expect(startSite(connect)).toBe(socket);
    expect(startSite(connect)).toBe(socket);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(siteSocket()).toBe(socket);
    stopSite();
    expect(socket.close).toHaveBeenCalled();
    expect(siteSocket()).toBe(null);
  });

  it('attaches somebody who subscribed before it opened, and somebody who subscribes after', () => {
    const early = vi.fn();
    const late = vi.fn();
    listen('tour', early);
    const socket = fake();
    startSite(() => socket);
    expect(socket.for('tour')).toEqual([early]);
    listen('tour', late);
    expect(socket.for('tour')).toEqual([early, late]);
  });

  it('stops listening when told to, and leaves everybody else attached', () => {
    const stays = vi.fn();
    const goes = vi.fn();
    listen('tour', stays);
    const off = listen('tour', goes);
    const socket = fake();
    startSite(() => socket);
    off();
    expect(socket.for('tour')).toEqual([stays]);
    off(); // saying it twice is not an error
    expect(socket.for('tour')).toEqual([stays]);
  });

  it('brings its listeners back when the socket opens again, so nobody has to subscribe twice', () => {
    const handler = vi.fn();
    listen('tour', handler);
    startSite(fake);
    stopSite();
    const second = fake();
    startSite(() => second);
    expect(second.for('tour')).toEqual([handler]); // signing in again finds the same listener waiting
  });

  it('can unsubscribe while no socket is open', () => {
    const off = listen('tour', vi.fn());
    expect(() => off()).not.toThrow();
  });
});
