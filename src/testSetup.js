// vitest's set-up for every client test: the components are mounted with the site's languages installed (so `t` works
// as it does in the app) and, for a test under modules/<id>/client/, with that game's id provided, as the play view
// provides it, so the game's own locale file is found.  Registered in vite.config.js (test.setupFiles).
import { config } from '@vue/test-utils';
import { beforeEach, expect } from 'vitest';
import { i18n } from './i18n.js';
import { GAME_ID } from './useGameText.js';

config.global.plugins = [...(config.global.plugins ?? []), i18n];

// jsdom has no canvas, and asking it for one logs "Not implemented", which the render-everything tests count as a
// failure.  This much of a 2D context is enough for a game that draws (Scribblers) to run against a buffer of pixels
// in a test: nothing is shown, but every line of the drawing code is exercised.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    const canvas = this;
    return {
      canvas,
      fillStyle: '#ffffff',
      fillRect() {},
      clearRect() {},
      putImageData() {},
      getImageData: (x, y, width, height) => ({ data: new Uint8ClampedArray(Math.max(1, width) * Math.max(1, height) * 4), width: Math.max(1, width), height: Math.max(1, height) }),
    };
  };
}

beforeEach(() => {
  const file = (expect.getState().testPath ?? '').replace(/\\/g, '/');
  const game = file.match(/modules\/([^/]+)\/client\//)?.[1] ?? null;
  config.global.provide = { ...(config.global.provide ?? {}), [GAME_ID]: game };
});
