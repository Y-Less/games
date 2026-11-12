// The Draw! table as a player sees it: the shape of each word over the board it belongs to, in both the drawer's view
// and the guesser's, and a score bar that does not stop the game between turns.  The views are made by the real rules,
// so a change to what the server sends shows up here rather than in a hand-written state that quietly goes stale.
import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Root from './index.js';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { fakeSocket } from '../../../shared/renderWalk.js';
import { seeded } from '../../../shared/random.js';
import * as game from '../game.js';

/**
 * A room of four with both drawers at work, and the two of them named.
 * @returns {{ room: object, drawers: Array<number|string> }}
 */
function roomDrawing() {
  const rng = seeded(11);
  const room = game.createRoom({ code: 'draw-test-game', hostId: 1, hostName: 'Ann', chooseMs: 5000, betweenMs: 4000, now: 0 });
  for (const [id, name] of [[2, 'Bob'], [3, 'Cat'], [4, 'Dan']]) game.addHuman(room, id, name);
  game.start(room, 1, rng, 0);
  for (const drawer of game.drawersOf(room)) game.chooseWord(room, drawer, 0, 1000);
  return { room, drawers: game.drawersOf(room) };
}

/** Mounts the game on a stand-in socket and sends it one view. */
async function show(view) {
  const socket = fakeSocket();
  const wrapper = mount(Root, { props: { socket, user: { id: 1, displayName: 'Ann' }, search: '', setSearch: () => {} } });
  socket.fire('connect');
  socket.fire('state', view);
  await flushPromises();
  return { wrapper, socket };
}

/** What a word is turned into over its board: one blank per letter, and the spaces and hyphens as they are. */
const blanks = (word) => [...word].map((ch) => (/[A-Za-z]/.test(ch) ? '_' : ch)).join('');
/** The blanks drawn over each board ("___" for a three-letter word), or false for a board that carries none. */
const shapes = (wrapper) => wrapper.findAll('figure.board').map((board) => board.find('.shape').exists() && board.find('.shape').text());

describe('the shape of the words over the boards', () => {
  it('shows a guesser how long both words are, without a letter of either', async () => {
    const { room, drawers } = roomDrawing();
    const guesser = room.players.find((p) => !drawers.includes(p.id));
    const view = game.viewFor(room, guesser.id, { now: 1000 });
    const { wrapper } = await show(view);
    const words = drawers.map((id) => room.words[id]);
    expect(shapes(wrapper)).toEqual(words.map(blanks));
    for (const word of words) expect(wrapper.find('.boards').text()).not.toContain(word);
    wrapper.unmount();
  });

  it('shows a drawer their own word in full and the shape of the one they are racing', async () => {
    const { room, drawers } = roomDrawing();
    const view = game.viewFor(room, drawers[0], { now: 1000 });
    const { wrapper } = await show(view);
    // The drawer's own board comes first, with the word on it, and the other board carries the blanks.
    expect(wrapper.findAll('figure.board')[0].text()).toContain(room.words[drawers[0]]);
    expect(shapes(wrapper)).toEqual([false, blanks(room.words[drawers[1]])]);
    wrapper.unmount();
  });
});

describe('the scores', () => {
  it('never opens the scores between turns: this game is over too quickly to close a pop-up', async () => {
    const { room, drawers } = roomDrawing();
    const guesser = room.players.find((p) => !drawers.includes(p.id));
    const { wrapper } = await show(game.viewFor(room, guesser.id, { now: 1000 }));
    expect(wrapper.findComponent(ScoreBoard).props('roundPopups')).toBe(false);
    expect(document.body.querySelector('.modal')).toBeNull();
    wrapper.unmount();
  });
});
