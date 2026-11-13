// Regression tests for Scribblers: bugs that were fixed in this module without a test being written for them at the
// time.  Each test names the commit it pins and says what went wrong, and each asserts what that commit's message
// says is right, so that taking the fix back out fails here rather than at a table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOM_WORDS } from '../../shared/words.js';
import * as game from './game.js';

// ccf6a9a "Credit scribble.rs in the help, and tidy what the review turned up".  The saved words a new room is given
// were cut from the wrong end, so once more had been saved than a room takes, a newly added word was never offered.
test('when more words have been saved than a room takes, it is the newest that the room keeps', () => {
  // The socket layer keeps the saved words oldest first and hands them over whole (see server.js `rememberWord`).
  const saved = Array.from({ length: CUSTOM_WORDS * 10 }, (_, i) => `word number ${i}`);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', added: saved, now: 0 });
  assert.ok(room.added.length < saved.length, 'more were saved than the room takes, or this test shows nothing');
  assert.ok(room.added.includes(saved.at(-1)), 'the word saved last is one of them');
  assert.deepEqual(room.added, saved.slice(-room.added.length), 'and so is every one before it, back as far as the room has space for');
});
