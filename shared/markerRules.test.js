// The marker colour of each player in a room: what somebody joining is given, and what a player may change theirs to
// in the lobby.  Asserted against what shared/markerRules.js promises, for every game that uses it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MARKER_COLOURS } from './markerColours.js';
import { chooseMarker, markerFor } from './markerRules.js';

const [FIRST, SECOND, THIRD] = MARKER_COLOURS;
const CUSTOM = '#123456';
const person = (id, colour) => ({ kind: 'human', id, name: `p${id}`, colour });
const lobby = (...players) => ({ phase: 'lobby', players });

test('a computer player is given the first palette colour nobody has', () => {
  assert.equal(markerFor(lobby(), { kind: 'bot' }), FIRST);
  assert.equal(markerFor(lobby(person(1, FIRST), person(2, THIRD)), { kind: 'bot' }), SECOND);
  assert.equal(markerFor(lobby(person(1, FIRST)), { kind: 'bot' }, { colour: CUSTOM }), SECOND, 'it has no preference to honour');
});

test('a person is given the colour they prefer when it is free, and the first free one otherwise', () => {
  assert.equal(markerFor(lobby(person(1, FIRST)), { kind: 'human' }, { colour: THIRD }), THIRD);
  assert.equal(markerFor(lobby(person(1, FIRST)), { kind: 'human' }, { colour: CUSTOM }), CUSTOM, 'the server has already checked they may use it');
  assert.equal(markerFor(lobby(person(1, THIRD)), { kind: 'human' }, { colour: THIRD }), FIRST, 'somebody already has it');
  assert.equal(markerFor(lobby(person(1, FIRST)), { kind: 'human' }), SECOND, 'no preference at all');
  assert.equal(markerFor(lobby(person(1, FIRST)), { kind: 'human' }, { colour: 'red' }), SECOND, 'a preference that is not a colour');
});

test('a player changes their colour in the lobby, to one that is allowed and that nobody else has', () => {
  const room = lobby(person(1, FIRST), person(2, SECOND));
  assert.deepEqual(chooseMarker(room, 1, THIRD), { ok: true });
  assert.equal(room.players[0].colour, THIRD);
  assert.deepEqual(chooseMarker(room, 1, THIRD), { ok: true }, 'choosing the colour they already have is not a clash with themselves');

  assert.deepEqual(chooseMarker(room, 1, SECOND), { ok: false, error: 'colourTaken' });
  assert.deepEqual(chooseMarker(room, 1, 'red'), { ok: false, error: 'notAColour' });
  assert.deepEqual(chooseMarker(room, 1, CUSTOM), { ok: false, error: 'colourIsUnlock' });
  assert.equal(room.players[0].colour, THIRD, 'a refusal changes nothing');
});

test('a colour outside the palette is for a player who has unlocked it, and is kept in lower case', () => {
  const room = lobby(person(1, FIRST), person(2, SECOND));
  assert.deepEqual(chooseMarker(room, 1, '#ABCDEF', true), { ok: true });
  assert.equal(room.players[0].colour, '#abcdef');
  assert.deepEqual(chooseMarker(room, 2, '#abcdef', true), { ok: false, error: 'colourTaken' }, 'unlocked or not, it is still one each');
});

test('only somebody in the room chooses, and only before the game starts', () => {
  const room = lobby(person(1, FIRST));
  assert.deepEqual(chooseMarker(room, 9, SECOND), { ok: false, error: 'notInGame' });
  room.phase = 'guessing';
  assert.deepEqual(chooseMarker(room, 1, SECOND), { ok: false, error: 'coloursBeforeStart' });
  assert.equal(room.players[0].colour, FIRST);
});
