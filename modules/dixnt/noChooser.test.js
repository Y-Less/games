// The no-chooser variant: nobody types the word, it is picked at random, and EVERY player puts a card down.  What is
// checked here is what the rules promise about it (see the header of game.js and the "Play styles" of rules.md):
// which play styles it may be paired with, that the word is never asked for, that everybody plays and may be voted
// for, that the judge of the 'chooser' style is never the one kept in the dark, and that a game is still as long as
// it ever was.  How any particular turn is scored is the business of judging.test.js: the scoring is not changed by
// the variant, so it is not pinned twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHOOSER_CORRECT_POINTS, CHOOSER_FOOLED_POINTS, NO_CHOOSER_JUDGING, POINTS_PER_VOTE } from './game.js';
import { makeRoom, seededRng } from './harness.js';

const WORDS = ['lighthouse', 'borrowed light', 'the long way round', 'tin soldier', 'last orders'];

/** A started game with nobody choosing the word. */
const started = (names = ['Ann', 'Bob', 'Cat', 'Dan'], options = {}) =>
  makeRoom(names, { noChooser: true, hints: WORDS, handSize: 4, cardCount: 120, seed: 5, start: true, ...options });

/** Everybody plays their first card, which leaves the turn waiting on the votes. */
function playEveryCard({ game, room, rng }) {
  for (const p of game.cardPlayers(room)) assert.equal(game.playCard(room, p.id, p.hand[0], rng).ok, true, `${p.name} plays`);
}

/** Everybody the style asks for votes for the first card they are offered, which ends the turn. */
function castEveryVote({ game, room }) {
  for (const voter of game.voters(room)) {
    if (room.phase !== 'voting') break; // the last vote the style needs has already closed the turn
    const [target] = game.viewFor(room, voter.id).voteTargets;
    assert.equal(game.vote(room, voter.id, target).ok, true, `${voter.name} votes`);
  }
}

/**
 * Plays the game out: every card, then every vote, then on to the next turn, until it is over.  `onPicking` is
 * called at the top of each turn, with the room, for whatever the test wants to look at while it is under way.
 */
function playOut(made, onPicking = () => {}) {
  const { game, room, rng } = made;
  for (let guard = 0; room.phase !== 'finished' && guard < 500; guard++) {
    if (room.phase === 'picking') {
      onPicking(room);
      playEveryCard(made);
    } else if (room.phase === 'voting') {
      castEveryVote(made);
    } else {
      assert.equal(game.nextTurn(room, 1, rng).ok, true, `the turn moves on from ${room.phase}`);
    }
  }
  assert.equal(room.phase, 'finished', 'the game reaches its end');
}

test('with no chooser the word is picked for the table: there is no word phase to wait through', () => {
  const made = started();
  const { game, room, rng } = made;
  assert.equal(room.phase, 'picking', 'the turn opens on the cards, not on somebody typing');
  assert.ok(WORDS.includes(room.word), `the word is one of the suggestions, was ${room.word}`);
  // And nobody may type one over it, whoever they are.
  assert.equal(game.submitWord(room, room.chooserId, 'mine instead', rng).error, 'notTimeToChooseWord');
  assert.equal(room.word, made.room.word, 'the word stands');
});

test('with no chooser every player puts a card down, and nobody is left out of the table', () => {
  const made = started();
  const { game, room } = made;
  assert.equal(game.cardPlayers(room).length, room.players.length, 'everybody is in the turn');
  for (const p of room.players) assert.equal(game.viewFor(room, p.id).playsCard, true, `${p.name} plays a card`);
  playEveryCard(made);
  assert.equal(room.phase, 'voting', 'the last card opens the voting');
  assert.equal(room.tableOrder.length, room.players.length, 'every card is on the table');
});

test('with no chooser and everybody voting, anybody may be the imposter and anybody may be voted for', () => {
  // Over many turns the player whose turn it is must come up as the imposter too: nobody sits the bluffing out.
  const seen = new Set();
  for (let seed = 1; seed <= 25; seed++) {
    const made = started(['Ann', 'Bob', 'Cat', 'Dan'], { seed, rounds: 3 });
    const { game, room } = made;
    playOut(made, () => {
      if (room.imposterId === room.chooserId) seen.add('turn-holder');
      // Everybody is on the table, so everybody but yourself is a card you may name.
      for (const p of room.players) {
        assert.deepEqual(
          [...game.viewFor(room, p.id).voteTargets].sort(),
          [],
          'nobody votes while the cards are still going down',
        );
      }
    });
    assert.ok(room.history.length > 0);
  }
  assert.ok(seen.has('turn-holder'), 'the player whose turn it is is kept in the dark like anybody else');
});

test('with no chooser everybody but yourself is a card you may vote for', () => {
  const made = started(['Ann', 'Bob', 'Cat', 'Dan']);
  const { game, room } = made;
  playEveryCard(made);
  for (const p of room.players) {
    assert.deepEqual(
      [...game.viewFor(room, p.id).voteTargets].sort(),
      room.players.filter((q) => q.id !== p.id).map((q) => q.id).sort(),
      `${p.name} may name anybody but themselves`,
    );
  }
});

test('with no chooser the judge of the "chooser" style plays a card but is never the one in the dark', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const made = started(['Ann', 'Bob', 'Cat', 'Dan'], { judging: 'chooser', seed, rounds: 2 });
    const { game, room } = made;
    playOut(made, () => {
      assert.notEqual(room.imposterId, room.chooserId, 'the judge would otherwise be handed the fooled points');
      assert.equal(game.viewFor(room, room.chooserId).playsCard, true, 'the judge plays a card like everybody else');
    });
    assert.equal(room.completedTurns, 8);
  }
});

test('with no chooser the judge still scores as the style says, and their own card is not a target', () => {
  const made = started(['Ann', 'Bob', 'Cat'], { judging: 'chooser' });
  const { game, room } = made;
  playEveryCard(made);
  const judge = room.chooserId;
  const targets = game.viewFor(room, judge).voteTargets;
  assert.equal(targets.includes(judge), false, 'you cannot accuse your own card');
  assert.equal(game.vote(room, judge, room.imposterId).ok, true);
  assert.equal(room.results.deltas[judge], CHOOSER_CORRECT_POINTS, 'spotting them scores the judge');
  assert.equal(room.results.deltas[room.imposterId], 0);
});

test('with no chooser a fooled judge still hands the imposter the big score', () => {
  const made = started(['Ann', 'Bob', 'Cat'], { judging: 'chooser' });
  const { game, room } = made;
  playEveryCard(made);
  const judge = room.chooserId;
  const decoy = game.viewFor(room, judge).voteTargets.find((id) => id !== room.imposterId);
  const imposter = room.imposterId;
  assert.equal(game.vote(room, judge, decoy).ok, true);
  assert.equal(room.results.deltas[imposter], CHOOSER_FOOLED_POINTS);
});

test('with no chooser and everybody voting, the group is still only right by a clear majority', () => {
  const made = started(['Ann', 'Bob', 'Cat', 'Dan', 'Eve']);
  const { game, room } = made;
  playEveryCard(made);
  const imposter = room.imposterId;
  const [a, b, c, d] = room.players.filter((p) => p.id !== imposter).map((p) => p.id);
  // Two name the imposter and two name A, which is a tie, and the rules say a tie is not a catch.  The imposter's
  // own vote goes to C, so it cannot settle it either: they are a voter here like everybody else.
  game.vote(room, a, imposter);
  game.vote(room, b, imposter);
  game.vote(room, c, a);
  game.vote(room, d, a);
  game.vote(room, imposter, c);
  assert.equal(room.phase, 'results');
  assert.deepEqual([room.results.tally[imposter], room.results.tally[a]], [2, 2]);
  assert.equal(room.results.groupCorrect, false, 'a tie counts as wrong');
  assert.equal(room.results.deltas[imposter], 2 * POINTS_PER_VOTE, 'C and D missed them, and each is worth a point');
});

test('the favourite style and no chooser refuse each other, whichever is asked for first', () => {
  const { game, room } = makeRoom(['Ann', 'Bob', 'Cat'], { judging: 'favourite' });
  assert.equal(game.setSettings(room, 1, { noChooser: true }).error, 'noChooserNeedsVotes');
  assert.equal(room.noChooser, false, 'and the room is left as it was');
  assert.equal(game.setSettings(room, 1, { judging: 'everyone', noChooser: true }).ok, true, 'both at once is how to change style');
  assert.equal(game.setSettings(room, 1, { judging: 'favourite' }).error, 'noChooserNeedsVotes');
  assert.equal(room.judging, 'everyone', 'and that is left alone too');
  for (const judging of NO_CHOOSER_JUDGING) assert.equal(game.setSettings(room, 1, { judging }).ok, true, `${judging} is allowed without a chooser`);
});

test('a game with no chooser is as long as any other: players x rounds turns, everybody taking one', () => {
  const made = started(['Ann', 'Bob', 'Cat', 'Dan'], { rounds: 3 });
  const { room } = made;
  const expected = room.players.length * 3;
  playOut(made);
  assert.equal(room.completedTurns, expected, `${expected} turns were played`);
  for (const p of room.players) assert.equal(p.turns, 3, `${p.name}'s turn came round three times`);
});

test('with no chooser nobody is marked out as one, and the scoreboard says so too', () => {
  const made = started();
  const { game, room } = made;
  const view = game.viewFor(room, room.chooserId);
  assert.equal(view.chooserId, null, 'there is no chooser to name');
  assert.equal(view.isChooser, false);
  assert.equal(view.players.some((p) => p.isChooser), false);
  assert.equal(view.noChooser, true);
  playEveryCard(made);
  castEveryVote(made);
  const [row] = room.history;
  assert.equal(Object.values(row.notes).some((note) => note?.key === 'notes.chooser'), false, 'and no row calls anybody the chooser');
});

test('with no chooser and a judge, the judge is named and their row says how they did', () => {
  const made = started(['Ann', 'Bob', 'Cat'], { judging: 'chooser' });
  const { game, room } = made;
  const judge = room.chooserId;
  assert.equal(game.viewFor(room, judge).chooserId, judge, 'the one who decides is still named to the table');
  playEveryCard(made);
  game.vote(room, judge, room.imposterId);
  const judgeSlot = game.playerOf(room, judge).slot;
  assert.equal(room.history[0].notes[judgeSlot].key, 'notes.judgeSpotted');
});

test('the word with no chooser comes from the suggestions without repeating, and there is always one', () => {
  const made = started(['Ann', 'Bob', 'Cat'], { rounds: 2 });
  const words = [];
  playOut(made, (room) => words.push(room.word));
  assert.equal(words.length, 6);
  assert.equal(new Set(words.slice(0, WORDS.length)).size, WORDS.length, 'the whole list is used before any word comes round again');
});

test('with no suggestions at all a turn still gets a word, so the game can never stall', () => {
  const { game, room } = makeRoom(['Ann', 'Bob', 'Cat'], { noChooser: true, hints: [], handSize: 3, cardCount: 60, rng: seededRng(3), start: true });
  assert.equal(room.phase, 'picking');
  assert.equal(typeof room.word, 'string');
  assert.ok(room.word.length > 0);
  assert.equal(game.viewFor(room, room.imposterId).word, null, 'and the one in the dark is still not told it');
});

test('a saved game that asks for both the favourite style and no chooser loads as a game with a chooser', () => {
  const { game, room } = makeRoom(['Ann', 'Bob', 'Cat'], { judging: 'favourite' });
  room.noChooser = true; // as a save written by hand, or by a version that let the pair through, would have it
  game.migrate(room);
  assert.equal(room.judging, 'favourite', 'the style the host picked is kept');
  assert.equal(room.noChooser, false, 'and the variant that cannot go with it is dropped');
});

test('playing again keeps the variant, so a table does not have to set it up twice', () => {
  const made = started(['Ann', 'Bob', 'Cat'], { rounds: 1 });
  const { game, room } = made;
  playOut(made);
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.noChooser, true);
});
