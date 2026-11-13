// Regression tests for the Hearts table: bugs that were fixed in this client without a test being written for them at
// the time.  Each test names the commit it pins and says what went wrong, and each asserts what that commit's message
// says is right, so that taking the fix back out fails here rather than in somebody's browser.
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { seeded } from '../../../shared/random.js';
import PlayingCard from '../../../src/components/PlayingCard.vue';
import * as bot from '../bot.js';
import * as game from '../game.js';
import Table from './Table.vue';

/** A real game in a hand with no passing, moved on by the computer players until it is the person's turn to play. */
function myTurn() {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: game.DEFAULT_SEATS } });
  game.fillWithBots(room, 1, room.seats.length);
  room.handNumber = 3; // the fourth hand is a hold hand: no passing
  expect(game.start(room, 1, seeded(3)).ok).toBe(true);
  room.handNumber = 3;
  game.deal(room, seeded(5));
  const rng = seeded(7);
  for (let guard = 0; guard < 200 && bot.pendingAction(room); guard++) bot.runPending(room, rng);
  expect(room.phase).toBe('playing');
  expect(room.turn).toBe(0);
  return room;
}

// 01ded45 "Fix the Hearts browser-test stall and ignore repeat card clicks while one is in flight".  Until the server
// has answered, the card just clicked is still drawn in the hand, and a second click on it (a double click, say) sent
// the play again, which could only come back as "That card is not in your hand."
describe('a card clicked while the last one is still on its way', () => {
  it('is ignored until the server has answered, and then cards can be played again', async () => {
    const state = game.viewFor(myTurn(), 1);
    const card = state.hand.find((c) => !state.legal[c]);
    expect(card, 'a card that may be played').toBeTruthy();

    const answers = [];
    const send = vi.fn(() => new Promise((resolve) => answers.push(resolve)));
    const table = mount(Table, { props: { state, send } });
    const inHand = () => table.findAllComponents(PlayingCard).find((c) => c.props('card') === card && c.props('clickable'));

    await inHand().trigger('click');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('play', { card });

    await inHand().trigger('click');
    await inHand().trigger('click');
    expect(send, 'nothing more is sent while the first is in flight').toHaveBeenCalledTimes(1);

    // The server answers (here with a refusal, so the hand it shows is unchanged), and the table listens again.
    answers[0]({ ok: false, error: 'notYourTurn' });
    await flushPromises();
    await inHand().trigger('click');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
