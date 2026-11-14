// The client half of a drawing: strokes go to the board they are for, and the boards are asked for again whenever
// what is on them may have gone stale.  A drawing is not in the view, so nothing else would ever put it right.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { fakeSocket } from '../shared/renderWalk.js';
import { useStrokeFeed } from './useStrokeFeed.js';

/** A stand-in board that notes what it was asked to do. */
const fakeBoard = () => {
  const calls = [];
  return { calls, apply: (ops) => calls.push(['apply', ops]), reset: (ops) => calls.push(['reset', ops]) };
};

/**
 * Mounts a component that does nothing but keep a feed.
 * @param {object} [options]  `count` boards, and whether the boards are `wanted`
 * @returns {{ wrapper: object, socket: object, sent: string[], boards: object[], turn: import('vue').Ref<number> }}
 */
function feed({ count = 1, wanted = () => true } = {}) {
  const socket = fakeSocket();
  const sent = [];
  const boards = Array.from({ length: count }, fakeBoard);
  const turn = ref(1);
  const Host = defineComponent({
    setup() {
      useStrokeFeed({ socket, send: (event) => sent.push(event), boards: () => boards, turnKey: () => turn.value, wanted });
      return () => h('div');
    },
  });
  return { wrapper: mount(Host), socket, sent, boards, turn };
}

describe('the strokes of a drawing', () => {
  it('asks for the boards on arriving', () => {
    const { sent, wrapper } = feed();
    expect(sent).toEqual(['canvas']);
    wrapper.unmount();
  });

  it('asks again every time the connection comes back, since strokes relayed while it was down never arrived', () => {
    const { sent, socket, wrapper } = feed();
    socket.fire('connect');
    socket.fire('connect');
    expect(sent).toEqual(['canvas', 'canvas', 'canvas']);
    wrapper.unmount();
  });

  it('asks for nothing while there is nothing worth asking for', () => {
    const { sent, socket, wrapper } = feed({ wanted: () => false });
    socket.fire('connect');
    expect(sent).toEqual([]);
    wrapper.unmount();
  });

  it('hands a stroke to the board it names, and to the first when it names none', () => {
    const { boards, socket, wrapper } = feed({ count: 2 });
    socket.fire('draw', { board: 1, ops: ['a'] });
    socket.fire('draw', { ops: ['b'] });
    expect(boards[1].calls).toEqual([['apply', ['a']]]);
    expect(boards[0].calls).toEqual([['apply', ['b']]]);
    wrapper.unmount();
  });

  it('starts a board afresh with the first chunk of it and adds the rest', () => {
    const { boards, socket, wrapper } = feed();
    socket.fire('canvas', { ops: ['a'], first: true });
    socket.fire('canvas', { ops: ['b'], first: false });
    expect(boards[0].calls).toEqual([['reset', ['a']], ['apply', ['b']]]);
    wrapper.unmount();
  });

  it('blanks every board and asks again when the turn moves on', async () => {
    const { boards, sent, turn, wrapper } = feed({ count: 2 });
    turn.value = 2;
    await nextTick();
    expect(boards.map((board) => board.calls)).toEqual([[['reset', []]], [['reset', []]]]);
    expect(sent).toEqual(['canvas', 'canvas']);
    wrapper.unmount();
  });

  it('stops listening when the table goes', () => {
    const { boards, sent, socket, wrapper } = feed();
    wrapper.unmount();
    socket.fire('draw', { ops: ['a'] });
    socket.fire('connect');
    expect(boards[0].calls).toEqual([]);
    expect(sent).toEqual(['canvas']);
  });
});
