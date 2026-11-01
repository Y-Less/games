// vitest's set-up for every client test: the components are mounted with the site's languages installed (so `t` works
// as it does in the app) and, for a test under modules/<id>/client/, with that game's id provided, as the play view
// provides it, so the game's own locale file is found. Registered in vite.config.js (test.setupFiles).
import { config } from '@vue/test-utils';
import { beforeEach, expect } from 'vitest';
import { i18n } from './i18n.js';
import { GAME_ID } from './useGameText.js';

config.global.plugins = [...(config.global.plugins ?? []), i18n];

beforeEach(() => {
  const file = (expect.getState().testPath ?? '').replace(/\\/g, '/');
  const game = file.match(/modules\/([^/]+)\/client\//)?.[1] ?? null;
  config.global.provide = { ...(config.global.provide ?? {}), [GAME_ID]: game };
});
