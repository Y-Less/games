// Fitting a game to the window.  The promises are the ones in useFrameFit.js's header: a game taller than the room
// below the title is scaled down so the page need not scroll, never up, and never so far that it cannot be read; the
// height it measured only grows within a window size, so the scale settles instead of bouncing as panels come and go;
// a screen that lays itself out to fit the window is left alone; and all of it is undone when the page goes away.
//
// jsdom lays nothing out and has no ResizeObserver, so the test supplies both: the game's natural height, the window's
// height, and the moment the browser would report a change of size.  A zoomed element measures smaller, as in a browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useFrameFit } from './useFrameFit.js';

let observers; // every ResizeObserver made, with what it is watching
let wrapper;
let size; // { game: the game's natural height, top: where the frame starts down the page }

beforeEach(() => {
  observers = [];
  size = { game: 400, top: 0 };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback) {
        this.callback = callback;
        this.watching = new Set();
        this.disconnected = false;
        observers.push(this);
      }
      observe(el) {
        this.watching.add(el);
      }
      unobserve(el) {
        this.watching.delete(el);
      }
      disconnect() {
        this.watching.clear();
        this.disconnected = true;
      }
    },
  );
  vi.stubGlobal('innerHeight', 1000);
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

/** The zoom the frame is drawn at (1 when it has never been scaled). */
const zoomOf = (frame) => Number.parseFloat(frame.style.zoom) || 1;

/**
 * Mounts a frame holding a game, laid out as a browser would lay it out.
 * @param {{ fitsWindow?: boolean, empty?: boolean }} [options]  a game that fits itself to the window; a frame whose game has not appeared yet
 * @returns {Promise<HTMLElement>} the frame element
 */
async function frameWith({ fitsWindow = false, empty = false } = {}) {
  wrapper = mount(
    defineComponent({
      setup() {
        const { frame } = useFrameFit();
        return () => h('div', { ref: frame, class: 'frame' }, empty ? [] : [h('div', { class: 'game', 'data-fits-window': fitsWindow ? '' : undefined })]);
      },
    }),
    { attachTo: document.body },
  );
  const frame = wrapper.element;
  Object.defineProperty(frame, 'offsetParent', { get: () => document.body }); // it is on the page, and shown
  frame.getBoundingClientRect = () => ({ top: size.top, height: size.game * zoomOf(frame) });
  layOut(frame);
  await nextTick();
  return frame;
}
/** Gives the frame's game (if it has one yet) its measured height: the natural height, times the zoom it is drawn at. */
function layOut(frame) {
  if (frame.firstElementChild) frame.firstElementChild.getBoundingClientRect = () => ({ top: size.top, height: size.game * zoomOf(frame) });
}
/** The browser reports that the game changed size. */
const resized = () => observers.forEach((observer) => observer.watching.size && observer.callback());

describe('useFrameFit', () => {
  it('leaves a game that fits in the window at its natural size', async () => {
    size.game = 400;
    const frame = await frameWith();
    resized();
    expect(zoomOf(frame)).toBe(1);
  });

  it('never scales a small game up to fill a big window', async () => {
    size.game = 100;
    vi.stubGlobal('innerHeight', 4000);
    const frame = await frameWith();
    resized();
    expect(zoomOf(frame)).toBe(1);
  });

  it('scales a game that is too tall down until it fits the room below the title, and no further than it needs', async () => {
    size.game = 1250;
    size.top = 100; // the site's header is above the frame
    const frame = await frameWith();
    resized();
    const zoom = zoomOf(frame);
    const room = 1000 - 100;
    expect(zoom).toBeLessThan(1);
    expect(size.game * zoom).toBeLessThanOrEqual(room);
    expect(size.game * zoom).toBeGreaterThan(room * 0.95);
  });

  it('tells the game its zoom, for the sticky bars that have to undo it', async () => {
    size.game = 1250;
    const frame = await frameWith();
    resized();
    expect(zoomOf(frame)).toBeLessThan(1);
    expect(Number.parseFloat(frame.style.getPropertyValue('--fit-zoom'))).toBe(zoomOf(frame));
  });

  it('never shrinks a game so far that it cannot be read, however tall it is', async () => {
    size.game = 10000;
    const tall = await frameWith();
    resized();
    const floor = zoomOf(tall);
    expect(floor).toBeGreaterThan(0.1); // fitting it would take a tenth of its size
    expect(floor).toBeLessThan(1);
    wrapper.unmount();
    size.game = 100000;
    const taller = await frameWith();
    resized();
    expect(zoomOf(taller)).toBe(floor);
  });

  it('settles: a panel going away does not make the game grow back, and its coming back changes nothing', async () => {
    size.game = 1250;
    const frame = await frameWith();
    resized();
    const settled = zoomOf(frame);
    size.game = 900; // a panel closed
    resized();
    expect(zoomOf(frame)).toBe(settled);
    size.game = 1250; // and opened again
    resized();
    expect(zoomOf(frame)).toBe(settled);
  });

  it('shrinks further when the game grows taller than it has been', async () => {
    size.game = 1250;
    const frame = await frameWith();
    resized();
    const before = zoomOf(frame);
    size.game = 1500;
    resized();
    expect(zoomOf(frame)).toBeLessThan(before);
    expect(size.game * zoomOf(frame)).toBeLessThanOrEqual(1000);
  });

  it('measures afresh when the window changes size', async () => {
    size.game = 1250;
    const frame = await frameWith();
    resized();
    expect(zoomOf(frame)).toBeLessThan(1);
    vi.stubGlobal('innerHeight', 2000);
    window.dispatchEvent(new Event('resize'));
    expect(zoomOf(frame)).toBe(1);
  });

  it('forgets the tallest the game has been when the window changes size', async () => {
    size.game = 1250;
    const frame = await frameWith();
    resized();
    size.game = 900; // a panel closed: within this window size the game stays as small as it was
    resized();
    expect(zoomOf(frame)).toBeLessThan(1);
    window.dispatchEvent(new Event('resize')); // a new window size: the game as it is now fits
    expect(zoomOf(frame)).toBe(1);
  });

  it('never scales a screen that lays itself out to fit the window', async () => {
    size.game = 5000;
    const frame = await frameWith({ fitsWindow: true });
    resized();
    expect(zoomOf(frame)).toBe(1);
  });

  it('puts the zoom back to 1 when the game changes to a screen that fits the window', async () => {
    size.game = 1250;
    const frame = await frameWith();
    resized();
    expect(zoomOf(frame)).toBeLessThan(1);
    frame.firstElementChild.setAttribute('data-fits-window', '');
    resized();
    expect(zoomOf(frame)).toBe(1);
    expect(Number.parseFloat(frame.style.getPropertyValue('--fit-zoom'))).toBe(1);
  });

  it("waits for the game's first element to appear, and measures it when it does", async () => {
    size.game = 1250;
    const frame = await frameWith({ empty: true });
    expect(observers.some((observer) => observer.watching.size)).toBe(false);
    const game = document.createElement('div');
    frame.append(game);
    layOut(frame);
    await vi.waitFor(() => expect(observers.some((observer) => observer.watching.has(game))).toBe(true), { timeout: 20000 }); // a condition, not a delay
    resized();
    expect(zoomOf(frame)).toBeLessThan(1);
  });

  it('undoes all of it when the page goes away', async () => {
    size.game = 400;
    const frame = await frameWith();
    resized();
    const removed = vi.spyOn(window, 'removeEventListener');
    wrapper.unmount();
    wrapper = null;
    expect(observers.every((observer) => observer.disconnected)).toBe(true);
    expect(removed.mock.calls.some(([event]) => event === 'resize')).toBe(true);
    size.game = 5000;
    window.dispatchEvent(new Event('resize'));
    expect(zoomOf(frame)).toBe(1); // nobody is listening any more
    removed.mockRestore();
  });
});
