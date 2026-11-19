// What viewFor sends along whole seeded games: the same views every time for a seed, a fixed set of parts, and —
// the one that matters in this game — never a card face its reader is not entitled to.
//
// Zurubang's secrecy is the other way round from every other card game on the site: the backs are public and the
// faces are private.  So the check below is not "does the view mention a card", which it must, but "does it name a
// card whose face this reader may not know": their own hand, their own side of the battlefield, and whatever has
// been turned over are allowed, and a stack, the graveyard and the other player's hand are not.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { assertNoLeaks } from '../../shared/leaks.js';
import { seeded } from '../../shared/random.js';
import { recordedViews } from './views.js';

/** A card id as it appears anywhere in a serialised view. */
const CARD = /\b(?:white|green|red|black|blue)-\d{2}\b/g;

/**
 * Adds to `seen` every card this room has turned face up in front of both players.  A card that has fought is public
 * from then on — the move log names it for the rest of the game, which is the point of a game about memory — so the
 * set has to be carried forward across duels rather than rebuilt from the duel on the table.
 *
 * @param {Set<string>} seen  changed in place
 * @param {object} room  the room as it stood
 * @returns {Set<string>} the same set
 */
function addSeen(seen, room) {
  for (const id of room.duel?.revealed ?? []) seen.add(id);
  for (const fight of room.duel?.fights ?? []) {
    for (const id of fight.cards) if (id) seen.add(id);
    for (const id of fight.drawn) if (id) seen.add(id);
    // A talent that drags a card into a fight names it, and that card fights there and then.
    for (const note of fight.notes) for (const value of Object.values(note.params ?? {})) if (value?.key?.startsWith('cards.')) seen.add(value.key.slice('cards.'.length));
  }
  return seen;
}

/**
 * Every card whose face this reader is entitled to know: what they are holding, what they have put down, and
 * everything that has been turned over in front of them.
 *
 * @param {object} room  @param {number} seat  the reader's seat, or -1 for a stranger  @param {Set<string>} seen
 * @returns {Set<string>}
 */
function allowedFor(room, seat, seen) {
  const allowed = new Set(seen);
  if (seat !== -1) {
    for (const id of room.hands[seat]) allowed.add(id);
    for (const id of room.duel?.placed?.[seat] ?? []) if (id) allowed.add(id);
  }
  return allowed;
}

for (const seed of [81, 82, 83]) {
  test(`the views of a game from seed ${seed} are the same every time, and name no card their reader may not know`, () => {
    const first = recordedViews(seed);
    assert.equal(first.finished, true, 'the recorded game has to reach an end for the later views to exist at all');
    assert.deepEqual(recordedViews(seed).views, first.views, 'a seed replays the same game and the same views');
    assert.ok(first.views.length > 60, `only ${first.views.length} views, which is too short a game to mean much`);

    // Three views were taken from each room, in order, so the two can be walked together while the cards that have
    // been turned over pile up.
    const seen = new Set();
    first.rooms.forEach((room, step) => {
      addSeen(seen, room);
      for (const text of first.views.slice(step * 3, step * 3 + 3)) {
        const view = JSON.parse(text);
        assertNoLeaks(view, { allowed: allowedFor(room, view.you, seen), pattern: CARD, who: view.you === -1 ? 'a stranger' : `seat ${view.you}` });
      }
    });
  });
}

test('a stranger is sent no hand at all, and the player is sent theirs', () => {
  const { views } = recordedViews(81);
  let dealt = 0;
  for (const text of views) {
    const view = JSON.parse(text);
    if (view.you === -1) {
      assert.deepEqual(view.hand, [], 'a stranger is sent no cards');
      assert.deepEqual(view.theirHand, [], 'and nobody else\'s either');
    } else if (view.phase === 'turn') {
      assert.equal(view.hand.length, 5);
      assert.equal(view.theirHand.length, 5);
      dealt += 1;
    }
  }
  assert.ok(dealt > 5, 'the recording never reached a turn with a hand in it');
});

test('the other player\'s hand is backs and nothing else, all the way through', () => {
  const { views } = recordedViews(82);
  for (const text of views) {
    const view = JSON.parse(text);
    for (const card of view.theirHand) {
      assert.equal(Object.keys(card).join(','), 'back', 'a card seen from behind carries its back and nothing more');
      assert.ok(['white', 'green', 'red', 'black', 'blue'].includes(card.back));
    }
  }
});

test('the stacks and the graveyard are counted, never listed', () => {
  const { views } = recordedViews(83);
  for (const text of views) {
    const view = JSON.parse(text);
    assert.equal(view.stacks.every((count) => Number.isInteger(count)), true);
    assert.equal(typeof view.graveyard, 'number');
  }
});

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: {}, now: 1 });
  const parts = ['code', 'phase', 'target', 'you', 'isHost', 'seatCount', 'playing', 'limits', 'seats', 'turn', 'marker', 'hand', 'theirHand', 'placer', 'duel', 'duelNo', 'stacks', 'graveyard', 'log', 'winner', 'scoreboard'];
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), parts);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3));
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), parts);
});
