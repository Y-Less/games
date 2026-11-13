// The strip that says where your tour has got to while you are somewhere else on the site.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { session } from '../session.js';
import { clearTour, tour } from '../tourSession.js';
import TourBand from './TourBand.vue';

const nothing = { template: '<i />' };

/** Mounts the band as if you were on `path`. */
async function band(path = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: nothing }] });
  router.push(path);
  await router.isReady();
  return mount(TourBand, { global: { plugins: [router] } }); // the site's languages are installed for every test (src/testSetup.js)
}

describe('the tour band', () => {
  beforeEach(() => {
    clearTour();
    session.games = [{ id: 'hearts', name: 'Hearts' }];
  });
  afterEach(() => clearTour());

  it('says nothing when you are not in a tour', async () => {
    expect((await band()).find('.tour-band').exists()).toBe(false);
  });

  it('offers the vote when the tour is voting, and points at the tour', async () => {
    Object.assign(tour, { code: 'boss-aware-you', phase: 'voting' });
    const w = await band('/');
    expect(w.text()).toContain('voting on what to play next');
    expect(w.find('a').attributes('href')).toBe('/play/tour?boss-aware-you');
  });

  it('offers the game by name while one is being played, and the tour as a quieter second way', async () => {
    Object.assign(tour, { code: 'boss-aware-you', phase: 'playing', game: 'hearts', gameCode: 'x-y-z' });
    const w = await band('/');
    expect(w.text()).toContain('playing Hearts');
    const links = w.findAll('a').map((a) => a.attributes('href'));
    expect(links).toEqual(['/play/hearts?x-y-z', '/play/tour?boss-aware-you']);
  });

  it('says nothing on the tour page when the tour is where you already are', async () => {
    Object.assign(tour, { code: 'boss-aware-you', phase: 'voting' });
    expect((await band('/play/tour')).find('.tour-band').exists()).toBe(false);
  });

  it('offers the tour back from inside the game it sent you to', async () => {
    // The band is the way back, so on the game's own page it points at the tour rather than hiding itself.
    Object.assign(tour, { code: 'boss-aware-you', phase: 'playing', game: 'hearts', gameCode: 'x-y-z' });
    const w = await band('/play/hearts');
    expect(w.find('.tour-band').exists()).toBe(true);
    expect(w.findAll('a').map((a) => a.attributes('href'))).toEqual(['/play/tour?boss-aware-you']);
    expect(w.text()).toContain('The tour');
  });

  it('offers the game from the tour page while one is being played', async () => {
    Object.assign(tour, { code: 'boss-aware-you', phase: 'playing', game: 'hearts', gameCode: 'x-y-z' });
    const w = await band('/play/tour');
    expect(w.findAll('a').map((a) => a.attributes('href'))).toEqual(['/play/hearts?x-y-z'], 'and does not offer the page you are on');
  });

  it('can be hidden, and stays hidden until the tour moves again', async () => {
    Object.assign(tour, { code: 'boss-aware-you', phase: 'voting' });
    const w = await band('/');
    await w.find('button.quiet').trigger('click');
    expect(w.find('.tour-band').exists()).toBe(false);
    expect(tour.dismissed).toBe(true);
  });

  it('falls back to the game id when the site does not know the game', async () => {
    session.games = [];
    Object.assign(tour, { code: 'boss-aware-you', phase: 'playing', game: 'mystery', gameCode: 'x-y-z' });
    expect((await band('/')).text()).toContain('mystery');
  });
});
