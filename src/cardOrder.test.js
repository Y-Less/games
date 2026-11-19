// The order one player is shown their own hand in: their profile setting, applied in the browser.
import { beforeEach, describe, expect, it } from 'vitest';
import { sortHand } from '../shared/cards.js';
import { session } from './session.js';
import { myCardOrder, orderForMe } from './cardOrder.js';

const HAND = sortHand(['AH', '5S', '2C', '10H', 'KD', 'JK1', '7S']);

beforeEach(() => {
  session.user = { id: 1, displayName: 'Ann' };
});

describe('the order this player is shown their hand in', () => {
  it('is high to low for somebody who has never chosen, and for somebody not signed in at all', () => {
    expect(orderForMe(HAND)).toEqual(sortHand(HAND));
    session.user = null;
    expect(orderForMe(HAND)).toEqual(sortHand(HAND));
  });

  it('follows the setting, and changes the moment the setting does', () => {
    session.user.cardOrder = 'lowHigh';
    const low = orderForMe(HAND);
    expect(low).not.toEqual(sortHand(HAND));
    expect([...low].sort()).toEqual([...HAND].sort());
    session.user.cardOrder = 'highLow';
    expect(orderForMe(HAND)).toEqual(sortHand(HAND));
  });

  it('keeps the trump suit at the front, whichever way the player has the ranks', () => {
    for (const cardOrder of ['highLow', 'lowHigh']) {
      session.user.cardOrder = cardOrder;
      expect(orderForMe(HAND, { trump: 'C' })[0]).toBe('2C');
    }
  });

  it('scatters a hand differently per table, and never changes it under the player', () => {
    session.user.cardOrder = 'random';
    const here = orderForMe(HAND, { salt: 'boss-aware-you' });
    expect(orderForMe(HAND, { salt: 'boss-aware-you' })).toEqual(here);
    expect(orderForMe(HAND, { salt: 'other-code-here' })).not.toEqual(here);
  });

  it('gives the comparator to a game that must keep its own places (Cheat deals several packs)', () => {
    session.user.cardOrder = 'lowHigh';
    const hand = ['AH', '2C', 'AH'];
    const places = hand.map((card, at) => ({ card, at })).sort((one, other) => myCardOrder()(one.card, other.card));
    expect(places.map((place) => place.card)).toEqual(['AH', 'AH', '2C']);
    expect(places.filter((place) => place.card === 'AH').map((place) => place.at)).toEqual([0, 2], 'the copies keep the places they came in');
  });

  it('does not change the hand it was given', () => {
    session.user.cardOrder = 'random';
    const hand = [...HAND];
    orderForMe(hand, { salt: 'x' });
    expect(hand).toEqual(HAND);
  });
});
