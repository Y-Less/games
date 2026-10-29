// Marker colours: the free palette, custom colours, and the colour a new player starts with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKER_COLOURS, isPresetMarker, markerProblem, normaliseMarker, startingMarker } from './markerColours.js';

test('colours are kept as lower-case #rrggbb, and anything else is refused', () => {
  assert.equal(normaliseMarker('#FF2D95'), '#ff2d95');
  for (const bad of ['ff2d95', '#fff', '#ff2d9', '#ff2d95a', 'red', '', null, undefined, 7, {}, ['#ffffff']]) assert.equal(normaliseMarker(bad), null, String(bad));
  assert.equal(isPresetMarker('#FFFFFF'), true);
  assert.equal(isPresetMarker('#123456'), false);
  assert.equal(new Set(MARKER_COLOURS).size, MARKER_COLOURS.length);
});

test('a new player gets their default if they may use it and it is free, otherwise the first free colour', () => {
  assert.equal(startingMarker(null, []), MARKER_COLOURS[0]);
  assert.equal(startingMarker('#6a00ff', []), '#6a00ff');
  assert.equal(startingMarker('#6A00FF', []), '#6a00ff');
  assert.equal(startingMarker('#6a00ff', ['#6a00ff']), MARKER_COLOURS[0], 'taken: the first free one');
  assert.equal(startingMarker('#6a00ff', [MARKER_COLOURS[0], '#6a00ff']), MARKER_COLOURS[1]);
  assert.equal(startingMarker('#123456', []), MARKER_COLOURS[0], 'a custom colour needs the unlock');
  assert.equal(startingMarker('#123456', [], true), '#123456');
  assert.equal(startingMarker('nonsense', [], true), MARKER_COLOURS[0]);
  assert.equal(startingMarker(null, MARKER_COLOURS), null, 'nothing is free');
});

test('choosing a colour: valid, allowed for this player, and not taken', () => {
  assert.equal(markerProblem('#ff2d95', [], false), null);
  assert.equal(markerProblem('#FF2D95', ['#ff2d95'], false), 'Someone else has that colour.');
  assert.match(markerProblem('#123456', [], false), /unlock/);
  assert.equal(markerProblem('#123456', [], true), null);
  assert.equal(markerProblem('#123456', ['#123456'], true), 'Someone else has that colour.');
  assert.match(markerProblem('blue', [], true), /not a colour/);
});
