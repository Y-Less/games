// The drawing board taking a pen: what a pointer does on it becomes instructions for the server, in the board's own
// coordinates, and only when this viewer is the one drawing.  (jsdom has no canvas; src/testSetup.js gives it enough of
// one for the drawing code to run against a buffer of pixels.)
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Board from './Board.vue';
import { WHITE } from './draw.js';

/** Waits for the animation frame on which the board sends what has been drawn. */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 40));

/**
 * Puts a pointer on the board.  The event is made by hand because a test runner cannot set clientX on one it builds,
 * and the board reads where the pointer is from exactly that.
 * @param {object} wrapper  the mounted board
 * @param {string} type  'pointerdown', 'pointermove' or 'pointerup'
 * @param {number} x  @param {number} y  where it is, in the page's pixels
 * @returns {Promise<void>}
 */
function point(wrapper, type, x, y) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
  Object.assign(event, { pointerId: 1, pointerType: 'mouse' });
  wrapper.element.dispatchEvent(event);
  return nextTick();
}

/**
 * Mounts a board that this viewer may draw on, with the given tool.  jsdom lays nothing out, so the canvas is told how
 * big it is on the screen: half the board's own width, which is what makes the instructions below twice what was
 * pointed at.
 */
function board(tool = { kind: 'pen', colour: 13, width: 8 }, active = true) {
  const wrapper = mount(Board, { props: { active, tool, width: 800, height: 450 } });
  wrapper.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 450, right: 800, bottom: 450, x: 0, y: 0 });
  return wrapper;
}
/** Every instruction the board has sent, flattened out of its `ops` events. */
const sent = (wrapper) => (wrapper.emitted('ops') ?? []).flatMap(([ops]) => ops);

describe('drawing with a pen', () => {
  it('leaves a dot where the pen goes down, so a tap makes a mark', async () => {
    const wrapper = board();
    await point(wrapper, 'pointerdown', 10, 20);
    await nextFrame();
    expect(sent(wrapper)).toEqual([{ t: 'line', x: 20, y: 40, x2: 20, y2: 40, c: 13, w: 8 }]);
  });

  it('draws from where the pen was to where it is now', async () => {
    const wrapper = board();
    await point(wrapper, 'pointerdown', 10, 10);
    await point(wrapper, 'pointermove', 15, 10);
    await point(wrapper, 'pointermove', 20, 12);
    await nextFrame();
    const ops = sent(wrapper);
    expect(ops).toHaveLength(3);
    expect(ops[1]).toMatchObject({ t: 'line', x: 20, y: 20, x2: 30, y2: 20 });
    expect(ops[2]).toMatchObject({ t: 'line', x: 30, y: 20, x2: 40, y2: 24 });
  });

  it('stops when the pen is lifted', async () => {
    const wrapper = board();
    await point(wrapper, 'pointerdown', 10, 10);
    await point(wrapper, 'pointerup', 10, 10);
    await point(wrapper, 'pointermove', 40, 40);
    await nextFrame();
    expect(sent(wrapper)).toHaveLength(1, 'only the dot from putting the pen down');
  });

  it('sends what was drawn in one frame as one batch', async () => {
    const wrapper = board();
    await point(wrapper, 'pointerdown', 10, 10);
    for (let n = 1; n < 6; n++) await point(wrapper, 'pointermove', 10 + n * 3, 10);
    await nextFrame();
    expect(wrapper.emitted('ops')).toHaveLength(1);
    expect(sent(wrapper)).toHaveLength(6);
  });
});

describe('the other tools', () => {
  it('the rubber paints white', async () => {
    const wrapper = board({ kind: 'rubber', colour: 5, width: 16 });
    await point(wrapper, 'pointerdown', 10, 10);
    await nextFrame();
    expect(sent(wrapper)[0]).toMatchObject({ t: 'line', c: WHITE, w: 16 });
  });

  it('the paint bucket fills where it is clicked, and draws no line', async () => {
    const wrapper = board({ kind: 'fill', colour: 5, width: 8 });
    await point(wrapper, 'pointerdown', 10, 20);
    await point(wrapper, 'pointermove', 40, 40);
    await nextFrame();
    expect(sent(wrapper)).toEqual([{ t: 'fill', x: 20, y: 40, c: 5 }]);
  });
});

describe('when it is not your turn to draw', () => {
  it('sends nothing at all', async () => {
    const wrapper = board({ kind: 'pen', colour: 13, width: 8 }, false);
    await point(wrapper, 'pointerdown', 10, 10);
    await point(wrapper, 'pointermove', 40, 40);
    await nextFrame();
    expect(wrapper.emitted('ops')).toBeUndefined();
  });
});

describe('instructions from the server', () => {
  it('are drawn without complaint, and a whole board replaces what was there', () => {
    const wrapper = board();
    const ops = [
      { t: 'line', x: 10, y: 10, x2: 100, y2: 100, c: 2, w: 8 },
      { t: 'fill', x: 5, y: 5, c: 4 },
    ];
    expect(() => wrapper.vm.apply(ops)).not.toThrow();
    expect(() => wrapper.vm.reset(ops)).not.toThrow();
    expect(() => wrapper.vm.reset([])).not.toThrow();
    expect(() => wrapper.vm.apply([])).not.toThrow();
  });
});
