// The rules of one fight, with no room, no sockets, and no computer players: a pair of cards, a position, and what the
// rulebook says should come of it.  Everything here reads like the rules themselves on purpose — these are the tests
// that have to stay readable when somebody comes back to an argument about a talent two years from now.
import test from 'node:test';
import assert from 'node:assert/strict';
import { POSITIONS, WIN_POINTS, beatsByElement, beatsBySpecial, fightAt, fullestStack, pickUp, printedPower, refillStacks, sweep } from './duel.js';

/**
 * A battle with two cards facing each other at one position and nothing else on the table, which is what most of
 * these tests want.  `stacks` and `graveyard` are given so that a talent that draws has somewhere to draw from.
 */
function pair(a, b, { position = 0, stacks = [[], [], []], graveyard = [], fiveElement = [null, null], marker = 0, also = [] } = {}) {
  const placed = [Array(POSITIONS).fill(null), Array(POSITIONS).fill(null)];
  placed[0][position] = a;
  placed[1][position] = b;
  for (const [side, at, id] of also) placed[side][at] = id;
  return { placed, stacks, graveyard, fiveElement, at: position, fights: [], points: [0, 0], marker };
}

/** Fights the pair and gives back the fight, for a test that wants to read the result rather than the battle. */
const fight = (battle, rng = () => 0) => fightAt(battle, rng);

test('the element decides before anything else: fire beats earth however big the earth card is', () => {
  const result = fight(pair('red-03', 'green-16')); // Flameling, power 1 fire; Earth Elemental, power 8 earth
  assert.equal(result.winner, 0);
  assert.equal(result.by, 'element');
});

test('non-elemental faces never collide, so a fight between them is settled on power', () => {
  const result = fight(pair('white-19', 'white-21')); // Star Dreamer 8, Sapphire Golem 9: both "none"
  assert.equal(result.winner, 1);
  assert.equal(result.by, 'power');
});

test('equal powers draw, and each card takes a point', () => {
  const result = fight(pair('white-18', 'green-16')); // Air Elemental 8 air, Earth Elemental 8 earth: no collision
  assert.equal(result.winner, null);
  assert.deepEqual(result.points, [1, 1]);
});

test('the Zurubang beats everything, and the winner takes two points', () => {
  const result = fight(pair('white-02', 'white-01')); // the Zurubang against a Dragon
  assert.equal(result.winner, 0);
  assert.equal(result.by, 'zurubang');
  assert.equal(result.points[0], WIN_POINTS);
});

test('a card of power 4 or less beats the Zurubang, which is discarded, and takes an extra point for it', () => {
  const battle = pair('white-02', 'white-09', { stacks: [['white-22'], [], []] }); // against the Death Scarecrow, 4
  const result = fight(battle);
  assert.equal(result.winner, 1);
  assert.equal(result.points[1], WIN_POINTS + 1, 'two for the win and one for felling a Zurubang');
  assert.equal(battle.placed[0][0], 'white-22', 'the Zurubang is gone, and a fresh card stands in its place');
  assert.deepEqual(battle.graveyard, ['white-02']);
});

test('two Zurubangs draw: each beats everything, and neither is weak enough to lose', () => {
  const result = fight(pair('white-02', 'green-01'));
  assert.equal(result.winner, null);
  assert.equal(result.by, 'zurubang');
});

test('"power 4 or less" is the power printed on the card, not the power a talent has grown it to', () => {
  // The Beast Kid is printed at 4 and draws a card to add to it; he beats a Zurubang however well he draws.
  const battle = pair('white-02', 'green-09', { stacks: [['white-22'], [], []] }); // he will draw the Cyclops, power 10
  const result = fight(battle);
  assert.equal(result.powers[1], 14, 'his 4 and the 10 he drew');
  assert.equal(result.winner, 1, 'and he still beats the Zurubang, because 4 is what is printed on him');
});

test('shooting beats flying whatever the powers are', () => {
  const result = fight(pair('green-02', 'white-03')); // Doomer: none, 1, destroying... and no shooting
  assert.equal(result.by, 'power');
  const shot = fight(pair('white-09', 'white-03')); // Death Scarecrow, none 4 shooting, against a flying air card
  assert.equal(shot.winner, 0);
  assert.equal(shot.by, 'shooting');
});

test('a flying card that is weaker escapes, for a draw', () => {
  const result = fight(pair('white-03', 'white-21')); // Cloud Gnome, flying 1, against the Sapphire Golem, 9
  assert.equal(result.winner, null);
  assert.equal(result.by, 'flying');
});

test('when both cards fly, nobody escapes and the stronger wins', () => {
  const result = fight(pair('white-03', 'white-20')); // Cloud Gnome 1 and Ki-Rin 9, both flying, both air
  assert.equal(result.winner, 1);
  assert.equal(result.by, 'power');
});

test('a Dragon that meets a shooting card draws with it', () => {
  const result = fight(pair('white-01', 'white-19')); // White Dragon (air) against the Star Dreamer (none, shooting)
  assert.equal(result.winner, null);
  assert.equal(result.by, 'dragon');
});

test('but the element still beats a Dragon, because the element goes before every ability', () => {
  const result = fight(pair('white-01', 'blue-18')); // White Dragon, air; Basilisk, water: air beats water
  assert.equal(result.winner, 0);
  assert.equal(result.by, 'element');
});

test('the Gnomeling beats any non-fire card of power 9 or more', () => {
  assert.equal(fight(pair('green-03', 'white-21')).winner, 0, 'the Sapphire Golem, power 9 and non-elemental');
  assert.equal(fight(pair('green-03', 'white-20')).winner, 0, 'and a flying one is no different');
  const fire = fight(pair('green-03', 'red-21')); // the Red Dragon is fire, which the talent excludes
  assert.equal(fire.winner, 1);
  assert.equal(fire.by, 'element', 'fire beats earth, and the talent never comes into it');
});

test('the Ember Monkey beats every other non-elemental card', () => {
  const result = fight(pair('red-05', 'white-21')); // against the Sapphire Golem, power 9
  assert.equal(result.winner, 0);
  assert.equal(result.by, 'talent');
});

test('an Energy Knight gains five power on its own position and nothing anywhere else', () => {
  assert.equal(fight(pair('blue-10', 'white-21', { position: 2 })).powers[0], 10, 'the Blue Energy Knight is at home on position 3');
  assert.equal(fight(pair('blue-10', 'white-21', { position: 1 })).powers[0], 5, 'and is a 5 everywhere else');
});

test('a Troll grows the further it stands from the stacks', () => {
  assert.equal(fight(pair('red-12', 'white-21', { position: 0 })).powers[0], 6);
  assert.equal(fight(pair('red-12', 'white-21', { position: 4 })).powers[0], 10);
});

test('an Elemental counts its own element face up, including the card opposite but never itself', () => {
  // The Air Elemental fights at position 2, with one air card already fought and one still face down.
  const battle = pair('white-18', 'white-03', { position: 1, also: [[0, 0, 'white-22'], [1, 2, 'white-01']] });
  const result = fight(battle);
  assert.equal(result.powers[0], 10, 'eight, plus the Cyclops already turned and the Cloud Gnome opposite');
});

test('the Dark Warlord counts the spirit cards still face down', () => {
  const battle = pair('black-08', 'white-21', { position: 0, also: [[0, 1, 'black-07'], [1, 3, 'black-06'], [1, 1, 'white-22']] });
  assert.equal(fight(battle).powers[0], 8, 'four, and two apiece for the Zombie and the Voodoo Priestess still down');
});

test('Melody counts every non-elemental card on the battlefield, turned or not, except herself', () => {
  const battle = pair('black-09', 'white-21', { position: 0, also: [[0, 2, 'white-19'], [1, 4, 'red-05']] });
  assert.equal(fight(battle).powers[0], 10, 'four, and two each for the Sapphire Golem, the Star Dreamer and the Ember Monkey');
});

test('the Beholder has a different ability on every position', () => {
  assert.equal(fight(pair('black-19', 'white-21', { position: 3 })).powers[0], 10, 'one more power on position 4');
  assert.equal(fight(pair('black-19', 'white-21', { position: 4 })).powers[0], 8, 'and one less on position 5');
  // Position 3 gives him shooting; the Shadow Pixie is spirit too, so the element decides nothing and the ability can.
  const shooting = fight(pair('black-19', 'black-02', { position: 2 }));
  assert.equal(shooting.by, 'shooting');
});

test('the Carrot Knight gains four against an even power, and a Zurubang is not an even power', () => {
  assert.equal(fight(pair('green-10', 'white-21')).powers[0], 5, 'the Sapphire Golem is a 9');
  assert.equal(fight(pair('green-10', 'white-19')).powers[0], 9, 'and the Star Dreamer an 8');
  assert.equal(fight(pair('green-10', 'white-02')).powers[0], 5, 'and the Zurubang has no number at all');
});

test('the Otter Warrior gains eight against water, and nothing against anything else', () => {
  assert.equal(fight(pair('blue-04', 'blue-20')).powers[0], 10, 'against the Hydra, which is water');
  assert.equal(fight(pair('blue-04', 'white-21')).powers[0], 2);
});

test('destroying takes the card opposite whoever won, and a replacement comes off a stack face down', () => {
  const battle = pair('blue-02', 'white-21', { stacks: [['white-22'], [], []] }); // the Jellyfish Pixie destroys
  const result = fight(battle);
  assert.equal(result.winner, 1, 'the Sapphire Golem wins the fight on power');
  assert.equal(battle.placed[1][0], 'white-22', 'and is destroyed anyway, with a fresh card in its place');
  assert.deepEqual(battle.graveyard, ['white-21']);
  assert.equal(result.destroyed[0], 1);
});

test('an indestructible card survives a destroying one and takes a point for the insult', () => {
  const battle = pair('blue-02', 'blue-20', { stacks: [['white-22'], [], []] }); // Jellyfish Pixie against the Hydra
  const result = fight(battle);
  assert.equal(battle.placed[1][0], 'blue-20', 'the Hydra is still standing');
  assert.equal(result.points[1], WIN_POINTS + 1, 'two for the win, and one for being unharmed');
});

test('a Zurubang cannot be destroyed either, and takes nothing for it', () => {
  // The Banshee is a 7, so the Zurubang is in no danger from its power, only from its destroying.
  const battle = pair('black-15', 'white-02', { stacks: [['white-22'], [], []] });
  const result = fight(battle);
  assert.equal(battle.placed[1][0], 'white-02');
  assert.equal(result.points[1], WIN_POINTS, "the win and no more: the extra point is the indestructible talent's");
});

test('the Hill Dwarf takes a point when he wins and is thrown away when he loses', () => {
  const won = pair('white-11', 'white-06', { stacks: [['white-22'], [], []] }); // against Firgol, air 2, which cannot fly off
  const first = fight(won);
  assert.equal(first.winner, 0);
  assert.equal(first.points[0], WIN_POINTS + 1);
  const lost = pair('white-11', 'white-22', { stacks: [['green-02'], [], []] }); // against the Cyclops, 10
  fight(lost);
  assert.equal(lost.placed[0][0], 'green-02', 'thrown away, and replaced');
  assert.deepEqual(lost.graveyard, ['white-11']);
});

test('the Bembi takes four points for going down to fire, and is thrown away', () => {
  const battle = pair('green-04', 'red-12', { stacks: [['white-22'], [], []] }); // Bembi, earth 2; Desert Troll, fire
  const result = fight(battle);
  assert.equal(result.winner, 1, 'fire beats earth');
  assert.equal(result.points[0], 4);
  assert.deepEqual(battle.graveyard, ['green-04']);
});

test('the Necromancer drags the top of the graveyard into the place opposite before anything else happens', () => {
  const battle = pair('black-21', 'white-03', { graveyard: ['red-03', 'white-22'], stacks: [[], [], []] });
  const result = fight(battle);
  assert.deepEqual(result.cards, ['black-21', 'white-22'], 'the Cyclops came out of the graveyard to fight him');
  assert.equal(battle.graveyard[0], 'white-03', 'and the Cloud Gnome went to the bottom, where it cannot come straight back');
});

test('the Necromancer does nothing at all against an empty graveyard', () => {
  const battle = pair('black-21', 'white-03', { graveyard: [] });
  assert.deepEqual(fight(battle).cards, ['black-21', 'white-03']);
});

test('the Ogre Mage only troubles a card of power 8 or less', () => {
  const weak = pair('red-17', 'white-19', { graveyard: ['white-22'] }); // the Star Dreamer is an 8
  assert.deepEqual(fight(weak).cards, ['red-17', 'white-22']);
  const strong = pair('red-17', 'white-21', { graveyard: ['white-22'] }); // the Sapphire Golem is a 9
  assert.deepEqual(fight(strong).cards, ['red-17', 'white-21']);
});

test('the Mercy Twister sends the card opposite away for one off a stack', () => {
  const battle = pair('white-04', 'white-21', { stacks: [['white-22'], [], []] });
  const result = fight(battle);
  assert.deepEqual(result.cards, ['white-04', 'white-22']);
  assert.deepEqual(battle.graveyard, ['white-21']);
});

test('the Ki-Rin draws after its fight: a small card is a point, and a big one throws the Ki-Rin away', () => {
  const small = pair('white-20', 'white-21', { stacks: [['white-11'], [], []] }); // it will draw the Hill Dwarf, 5
  assert.equal(fight(small).points[0], 1 + 1, 'the draw it escaped with, and the point for drawing well');
  // A stack is drawn from the top, which is the end of the list: the Cyclops, power 10, comes off it first.
  const big = pair('white-20', 'white-21', { stacks: [['green-02', 'white-22'], [], []] });
  fight(big);
  assert.equal(big.placed[0][0], 'green-02', 'the Ki-Rin went, and something took its place');
});

test('the Basilisk on the last position clears everything of the other player\'s that can be destroyed', () => {
  const battle = pair('blue-18', 'white-21', {
    position: 4,
    stacks: [['green-02', 'red-03', 'white-03', 'white-06'], [], []],
    also: [
      [1, 0, 'blue-20'], // the Hydra cannot be destroyed
      [1, 1, 'white-22'],
      [1, 2, 'white-19'],
      [0, 0, 'white-18'], // and the Basilisk's own side is untouched
    ],
  });
  fight(battle);
  assert.equal(battle.placed[1][0], 'blue-20', 'the Hydra stands');
  assert.notEqual(battle.placed[1][1], 'white-22', 'the Cyclops went');
  assert.notEqual(battle.placed[1][2], 'white-19', 'and so did the Star Dreamer');
  assert.equal(battle.placed[0][0], 'white-18', "nothing of the Basilisk's own side moved");
  assert.notEqual(battle.placed[0][4], 'blue-18', 'and the Basilisk went too');
  assert.ok(battle.graveyard.includes('blue-18'));
});

test('a swapping card changes sides when the cards are picked up, and two of them cancel out', () => {
  const one = pair('red-09', 'white-21'); // the Orc Shaman swaps
  fight(one);
  assert.deepEqual(pickUp(one), [['white-21'], ['red-09']], 'they changed sides');
  const both = pair('red-09', 'black-06'); // the Orc Shaman and the Voodoo Priestess
  fight(both);
  assert.deepEqual(pickUp(both), [['red-09'], ['black-06']], 'swapped twice, so neither moved');
});

test('the circle alone: spirit beats air, air beats water, and a non-elemental face is in none of it', () => {
  assert.equal(beatsByElement('spirit', 'air'), true);
  assert.equal(beatsByElement('spirit', 'earth'), false, 'spirit loses to earth in the ordinary way');
  assert.equal(beatsByElement('spirit', 'none'), false);
});

test('five of a kind adds the one arrow pointing back: the element that normally beats yours', () => {
  assert.equal(beatsBySpecial('spirit', 'earth', 'spirit'), true, 'earth beat spirit, and now it does not');
  assert.equal(beatsBySpecial('spirit', 'earth', null), false, 'without the hand, nothing changes');
  assert.equal(beatsBySpecial('spirit', 'air', 'spirit'), false, 'what it already beat it beats by the circle, not by this');
  assert.equal(beatsBySpecial('air', 'earth', 'spirit'), false, 'and only the hand\'s own element gains anything');
});

test('five of a kind beats the element that would otherwise have beaten it', () => {
  // The Zombie is spirit 3 against the Earth Elemental, 8: earth beats spirit, and five spirit backs say otherwise.
  const plain = fight(pair('black-07', 'green-16'));
  assert.equal(plain.winner, 1);
  assert.equal(plain.by, 'element');
  const special = fight(pair('black-07', 'green-16', { fiveElement: ['spirit', null] }));
  assert.equal(special.winner, 0, 'the hand is an exception to the circle, so it beats the circle');
  assert.equal(special.by, 'element');
});

test('a card that is nothing but its printed power is read as such, and a Zurubang as infinite', () => {
  assert.equal(printedPower('white-21'), 9);
  assert.equal(printedPower('white-02'), Infinity);
  assert.equal(printedPower(null), 0);
});

test('a card comes off the fullest stack, and off the lowest-numbered of two level ones', () => {
  assert.equal(fullestStack([['a'], ['a', 'b'], []]), 1);
  assert.equal(fullestStack([['a'], ['b'], []]), 0);
  assert.equal(fullestStack([[], [], []]), -1);
});

test('when every stack has run dry the graveyard is shuffled back into them', () => {
  const battle = pair('white-21', 'white-22', { stacks: [[], [], []], graveyard: ['a', 'b', 'c', 'd'] });
  assert.equal(refillStacks(battle, () => 0), true);
  assert.deepEqual(battle.graveyard, []);
  assert.equal(battle.stacks.flat().length, 4);
  assert.equal(refillStacks(battle, () => 0), false, 'and there is nothing to do a second time');
});

test('sweeping a card takes it to the graveyard and puts a fresh one face down in its place', () => {
  const battle = pair('white-21', 'white-22', { stacks: [['green-02'], [], []] });
  assert.equal(sweep(battle, 0, 0, () => 0), 'green-02');
  assert.deepEqual(battle.graveyard, ['white-21']);
  assert.equal(battle.placed[0][0], 'green-02');
});
