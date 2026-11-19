# Zurubang

A duelling card game for two, by Arne Kaehler.  The first player to 30 points wins.

The whole game turns on one unusual rule: **the back of every card you hold is on show, and the face of
every card you hold is not.**  Your opponent always knows you are holding two blue cards and a black one;
they never know which blue cards.  Most backs tell the truth about the face, and some of them lie.

## Your hand

You hold five cards.  Each one has a **face** — a power from 1 to 11, an element, perhaps an ability, and
perhaps a talent — and a **back**, which shows an element in a colour.

Of the 21 cards behind each back, 16 really are that element, three are non-elemental, one is a Zurubang,
and one is a "ghost" of the element that back's element loses to.  So a blue back is water five times out of
six, and the sixth time it is something else entirely.

## Your turn

You must do exactly one of these.  There is no passing.

1. **Swap one card.**  Put a card face down on the graveyard, and take the top card of whichever stack you
   like.
2. **Swap all five.**  Throw the whole hand away and draw five fresh cards.  Your opponent gets 1 point for
   the privilege.
3. **Challenge to a duel.**  Your opponent may accept or decline.  If they decline, you take 5 points at
   once, and the next turn is theirs.

## The duel

If the challenge is accepted, **the challenged player decides who places the first card** — and placing
first is the better end of it, for reasons that become clear below.

### Laying the cards out

There are five positions, counted from the stacks.  Every card goes down face down, with its back on show.

The player who starts places one card.  After that the two of you take turns placing **two** cards each: one
opposite the card just played, and one in the next position along.  The last card of all is the second
player's, and by then they have no choice left about it — which is the advantage of starting, because you
can see from the backs what that last card will be.

```
         1     2     3     4     5
second   2nd   2nd   4th   4th   6th      <- places 2, 2, 1
first    1st   3rd   3rd   5th   5th      <- places 1, 2, 2
```

### The fights

The two cards in position 1 are turned over together and fought, then position 2, and so on to position 5.
Each fight is worth **2 points for a win, 1 for a draw, and nothing for a loss**, and some talents hand out
extra points on top.

A fight is decided in this order:

1. **A Zurubang** beats anything — unless the card facing it has power 4 or less, in which case the Zurubang
   loses, is thrown away, and the little card that beat it takes an extra point.
2. **The element.**  Spirit beats air, air beats water, water beats fire, fire beats earth, and earth beats
   spirit.  Nothing else matters when the elements collide.  Non-elemental cards never win or lose this way.
3. **A talent** that simply says it beats something — the Gnomeling against the big cards, the Ember Monkey
   against the other non-elemental ones.
4. **Shooting beats flying**, and a Dragon that meets a shooting card draws with it.
5. **Flying.**  A flying card that is the weaker one escapes, and the fight is a draw.  If both of them fly,
   nobody escapes and the stronger wins.
6. **Power.**  The higher power wins, and equal powers draw.

Whoever has more points when all five fights are done **banks the lot**.  The loser banks nothing at all.

### Abilities

- **Flying** — escape a fight you would lose, for a draw.
- **Shooting** — beat any flying card.
- **Destroying** — the card opposite is destroyed once the fight is over, however the fight went.  It goes to
  the graveyard, and its owner draws a replacement, face down, into the same position.

### Sudden death

If the two totals are level, nobody has won yet.  Both of you secretly choose one of the five positions —
you may look at your own card there first — and on "Zu-Ru-Bang!" the two chosen cards fight.  That result is
added to the level scores.  If it is *also* a draw, both those cards are taken out and you choose again.

### Special hands

These are judged on the **backs in your hand at the moment the duel starts**, and nothing that happens
afterwards changes them.

- **Rainbow** — all five backs different.  Win the duel and take 2 points extra.
- **Five of a kind** — all five backs the same.  Win the duel and take 4 points extra; and for the whole
  duel, your cards also beat the element they would normally lose to.

### After the duel

Every card is picked up again, the winner's points go on the score, and **the player who was challenged
takes the next turn**.

## The cards worth knowing

- **The Zurubang** (one behind each back) beats everything except a card with power 4 or less.
- **The Dragons** are the power 11 cards, and a shooting card holds them to a draw.
- **The Elementals** gain a point of power for every card of their own element face up on the battlefield.
- **The Energy Knights** gain 5 power on the one position each of them calls home.
- **The Trolls** grow the further from the stacks they stand.
- **Indestructible** cards cannot be destroyed, and take a point from any destroying card that tries.
- **The swapping cards** — the Orc Shaman, the Voodoo Priestess, and the Wumpi Girl — change sides with the
  card opposite once the duel is over, so you go home with one of theirs.

Everything else, you will meet.
