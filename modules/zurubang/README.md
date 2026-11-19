# Zurubang

A duelling card game for exactly two players, by Arne Kaehler.  Players read `rules.md`; this file is for
whoever has to change the code.

The sources are in `../../../zurubang`: `RULES.md` (a compilation), `cards.json` (one entry per physical
card), the beta rulebook PDF, and the card sheets.  The rulebook says of itself that it is "an unpolished,
a little bit buggy, but almost completed rulebook", and it is right: a good deal of this file is the
rulings it does not make.

## The shape of it

```
cards.js      the 105 cards as data: back, face, power, abilities, and which talent.  No English at all
duel.js       one fight, decided: the pure function the whole game hangs off, and the talents
game.js       the rules as functions over a plain room object
server.js     the socket half (shared/roomServer.js) and the server's own moves
ai/           the computer players, one file each, named after the rulebook's own playing styles
client/       the screens: the root, the lobby, the table, and one card
arena.js      whole games of computers against computers, for the AI and invariant tests
views.js      a seeded game recorded view by view, for the view, leak and drawing tests
locales/en.json  every word, including all 105 card names and 25 talent texts under `cards.`
cards/        the art, served at /assets/zurubang/cards/{faces,backs}/<name>.jpg
```

The tests, in the order they are worth reading:

```
duel.test.js        one fight at a time: the order of the checks, and every talent
game.test.js        a turn, a challenge, a duel laid out and fought, and what each does to the score
rules-gaps.test.js  one test per ruling below, named after it
invariants.test.js  every card is in exactly one place after every move of 72 whole games
view.test.js        the same views for a seed, and never a face its reader has not been shown
ai.test.js          every AI plays legally, finishes, and is recognisably itself
robustness.test.js  garbage at all 24 socket events in all 9 phases
e2e.test.js         real sockets: a whole game, a chair changing hands, and a tournament of three
client/render-all.test.js  every view of two whole games, drawn by the real table
../../ui-tests/zurubang.test.js  two browsers: five faces against five backs, and ten cards going down
```

`cards.js` and the `cards` block of `locales/en.json` are generated from `../../../zurubang/cards.json`,
and the card art from the sheets there, with ImageMagick:

```sh
magick <face>.png -resize 360x -strip -interlace Plane -quality 84 cards/faces/<id>.jpg
```

Card names are **not** in any `.js` file on purpose.  `src/i18n.test.js` reads every string literal in a
module and fails on anything that reads like English, so a hundred card names in a data file would be a
hundred pieces of untranslatable text.  They live in the locale file under `cards.<id>`, which that test
exempts from "English nobody asks for" because the keys are looked up by card id.

## Why the deck is 105 cards and not 107

The card sheets carry a second, uncensored artwork of the Harpy and of the Succubus.  They are identical in
power, element, and abilities; only the picture differs.  The rulebook counts 105 cards, and 105 is what
this deck holds: the censored artwork of each.

## The rulings

The rulebook does not settle these.  Each one has a test of its own named after it in `rules-gaps.test.js`.

| | The ruling |
| --- | --- |
| **Who places last** | The rulebook's pictures give the first player 1, 2, and 2 cards, and the second 2, 2, and 1, so the **last card of the duel is the second player's**, and it is forced.  (`RULES.md` says the opposite; the pictures win.)  This is exactly why starting is the advantage the rulebook claims it is: the first player places their fifth card already knowing, from the backs, which card the second player must put opposite it. |
| **After a declined challenge** | The challenger takes their 5 points, and the **next turn is the decliner's**.  A challenge is a turn like any other, so the turn passes. |
| **Two Zurubangs** | A draw.  Each wins against every card, and neither has a power of 4 or less, so neither clause can break it. |
| **The graveyard is face down** | Only its size is public.  The Necromancer and the Ogre Mage take its top card sight unseen, and on an empty graveyard they do nothing at all.  The card they displace goes to the **bottom** of the graveyard, so that the exchange cannot immediately undo itself. |
| **Who chooses the stack** | On your own turn, you do.  Everywhere else — a destroyed card's replacement, the Mercy Twister, the Beast Kid, the Druid, the Ki-Rin — the card comes off the fullest stack, and the lowest-numbered of two level ones.  Three face-down stacks hold no information between them (the rulebook forbids peeking under one), so a choice between them mid-duel would be a decision about nothing, asked of a player watching a fight they cannot otherwise affect.  It stays where it is a real part of the turn and goes where it is not.  The rulebook's note that the Mercy Twister's owner chooses is therefore the one clause this implementation cannot honour, and it costs the game nothing. |
| **An empty stack** | Cannot be drawn from.  When all three run dry the graveyard is shuffled and dealt back out as three fresh stacks; with nothing in the graveyard either, a draw that cannot happen simply does not. |
| **Order of the checks in a fight** | Zurubang, then element, then a talent that says outright what it beats, then shooting against flying, then flying, then power.  The Zurubang is non-elemental, so it never collides with the element rule; and the rulebook is explicit that "the stronger element just wins" over both flying and shooting. |
| **A Dragon against a shooting card** | A draw, unless the element has already decided the fight.  The Dragon's text does not mention the element, and every other ability in the game yields to it. |
| **Shooting against flying** | The shooter wins whatever the two powers are: the card says its only purpose is to win against flying cards. |
| **A discarded card is replaced** | Any card that leaves the battlefield mid-duel — destroyed, or discarded by its own talent — is replaced from a stack, face down, in the position it left.  The rulebook does this for the Hill Dwarf, and there is no reason for it to be the Hill Dwarf's alone. |
| **Sudden death with nothing left** | Each drawn sudden death takes both cards out of it.  If that empties the battlefield, the duel ends with no winner and **nobody banks**: five draws in a row is the one way the game lets a duel settle nothing. |
| **Two swapping cards** | They stay where they are, having swapped twice.  (The rulebook guesses this, and says so.) |
| **Who acts first** | The Duel card belongs to the **challenged** player from the moment they accept, and whoever holds it acts first, and draws first, whenever both players must do something at the same moment. |
| **The Basilisk on position 5** | Its own fight is resolved first; then every card of the opponent's that can be destroyed leaves the battlefield, along with the Basilisk.  The indestructible ones stay.  Each cleared card is replaced from a stack as usual — which is the point of it, since the opponent takes those replacements home instead of the hand they built. |
| **The Ki-Rin's draw** | A Zurubang drawn has no printed power, which counts as "8 or more": the Ki-Rin is discarded. |
| **The Carrot Knight's "even power"** | The power printed on the card opposite, before any talent changes it.  A Zurubang has no number, so it is not even. |
| **The Dark Warlord's count** | Spirit cards still face down anywhere on the battlefield, on both sides, at the moment of its own fight — which is to say, the positions not yet fought. |
| **The Elementals' count** | Cards of its own element face up on the battlefield: the positions already fought, plus the card opposite it, and never itself. |
| **Melody's count** | Every non-elemental card on the battlefield, face up or face down, except Melody. |
| **Five of a kind** | Judged on the five backs in hand when the duel starts, and nothing afterwards changes it.  For the whole duel, a card of that player's whose **face** is the back's element also beats the element that normally beats it.  The bonus points are added to the total they bank, if they win. |
| **The Ogre Mage only once** | If the card it drags out of the graveyard is also power 8 or less, nothing happens a second time. |
| **"Power 4 or less" against a Zurubang** | The power **printed** on the card, before any talent touches it.  A Beast Kid who has drawn well is still a 4. |
| **An indestructible card's point** | The `indestructible` talent takes its point from a destroying card.  The Zurubang simply survives and takes nothing: it is not one of "those cards" the rulebook's note is about. |
| **Where five of a kind would decide both ways** | A spirit five-of-a-kind facing earth makes each side beat the other.  The element then decides nothing and the fight is settled by the questions after it.  The same holds of two talents that each claim to beat the other. |
| **A swapping card that was destroyed** | The swap moves whatever is standing in the two positions when the duel ends — which is how "the swap also happens after this card has been destroyed" can mean anything at all. |
| **The Beast Kid's drawn card** | Its power is added to his own 4, not put in its place.  A Zurubang drawn has no number, so it adds nothing. |
| **When the Ki-Rin draws** | At the end of its own fight, once the destroying is settled, rather than at the end of the duel.  A Ki-Rin that was destroyed never draws, and the point it may take has to count towards the duel it was won in. |

## Secrecy

Backs are public and faces are private, which is the opposite way round from every other card game on the
site, so it is worth saying plainly what a view may carry:

- your own hand, as card ids;
- the other player's hand, as **backs only**, in hand order;
- the battlefield: your own cards as ids, theirs as backs, until a position has been fought — after which
  both are ids, for ever;
- the stacks and the graveyard, as counts.

A card that is replaced face down mid-duel is a back again, even if its position has already been fought.
`assertNoLeaks` over `views.js` is what keeps all of this honest.

## Tournaments

The game is for two, which makes it the natural shape for a tournament: `fillTo` is 2, the lobby has
exactly two seats, and a tournament deals its tables two at a time with no help from this module.  The
one thing worth knowing is the order: a tournament has to be switched on **before** the third person
arrives, because an ordinary lobby of this game has two chairs and will turn them away.
`e2e.test.js` plays a round of one out to its standings.

## The table

The frame gives its main slot the width of the whole row in `width` and the width of its own part in
`left`, so everything here is sized off `left`, and the arena spans all twelve columns.  Sizing a card
off `width` draws it too wide and lets the hand off the side of the screen, which is what the first run
of the layout test found.

Both hands are drawn as five places rather than as however many cards are in them.  A duel empties a
hand a card at a time, and a row that closed up behind each one would slide the whole table sideways
five times a duel; `ui-tests/layout-stability.test.js` is what says so.
