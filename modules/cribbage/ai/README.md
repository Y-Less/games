# Cribbage computer players (AIs)

Every computer-controlled seat in Cribbage plays with one of six AIs. The game is for two to four players; the AIs make
two kinds of decision: which cards to discard to the crib, and which card to peg. The general mechanism is described in
`MODULES.md` ("Computer players (AIs)") and `shared/ai.js`.

## How a bot gets its AI

- When the host starts a game, every bot seat is given an AI by a weighted random pick (`assignAIs(AIS, bots, rng)` from
  `shared/ai.js`, with the game's seeded `rng`); human seats have none.
- The AI id is stored on the seat (`room.seats[i].ai`), so it survives a restart and a human leaving.
- A bot that replaces a human who leaves picks its AI at that moment (`pickAI`).
- Rooms saved before AIs existed, or with an unknown id, fall back to the first AI, `standard`.
- The view exposes `seats[].ai` as `{ id, name }` for bots once the game has left the lobby, and `null` otherwise.
- Illegal answers are overruled: a bad discard or play is replaced by the Standard AI's choice.

## The AIs

| id | Name | Weight | Summary |
| --- | --- | --- | --- |
| `standard` | Standard | 3 | The original bot: best hand with a nod to the crib, and simple pegging. First in the list, so it is the fallback. |
| `random` | Random | 0.5 | Any legal discard and any legal card. |
| `greedy` | Greedy | 1 | Keeps the highest-scoring hand and plays whichever card scores most right now. |
| `balanced` | Balanced | 1 | Weighs hand against crib by simulation; Standard's pegging. |
| `pegger` | Pegger | 1 | Greedy's discards with careful, look-one-reply-ahead pegging. |
| `sharp` | Sharp | 1.5 | Expected-value discards that allow for the score, and pegging that looks ahead and plays to the board. |

## How each one decides

**Standard.** For the discard it tries every split of the hand, scoring the kept cards averaged over every starter card
that could be cut, then adds (as dealer) or subtracts (as non-dealer) 0.8 times a rule-of-thumb value of the crib (pairs,
fifteens, fives, nearby ranks and matching suits score in the crib). For pegging it picks the card with the most points
from the play, minus a small penalty for leaving the count at 5, 10 or 21 (which gives an easy fifteen or thirty-one),
and otherwise plays low when leading and high when following. Limitations: the crib value is a crude estimate, it does
not count what the opponent might hold, and it ignores the score.

**Random.** Picks a random discard split and a random card that does not take the count over 31. Weakest opponent.

**Greedy.** Keeps the hand with the best average score over possible starters and ignores the crib entirely, so it will
happily give an opponent a five or a pair. In pegging it plays the card that scores most immediately (the highest card
if nothing scores). Limitations: it gives away points in both phases.

**Balanced.** Uses a simulated crib estimate (24 sampled cribs, with the unseen cards dealt at random) instead of
Standard's rule of thumb: it adds the estimate when it is the dealer and subtracts it otherwise, so it feeds its own crib
and starves an opponent's of fives and pairs. With more than two players the penalty for another player's crib is
divided by the number of opponents. Its pegging is exactly Standard's.

**Pegger.** Discards exactly like Greedy (best hand, ignores the crib), but pegs carefully. For each playable card it
works out the points scored now, minus the expected best reply the next player with cards could score from the cards still
unseen (allowing for how many cards they hold), plus a bonus for the chance the opponent cannot play and it earns the go,
with a slight preference for low leads and high follows. It chases fifteens and thirty-one and avoids setting up pairs,
runs and fifteens. Limitations: the crib is ignored when discarding.

**Sharp.** For discards it takes each split's average hand score and adds or subtracts the crib's expected value from a
60-sample simulation (the sample is seeded from the hand, so it answers the same way for the same cards). It also reads
the board: a non-dealer near home (within 12 points of 121) shrinks the crib's weight to 40%, because the player who
counts first wins a close finish; a dealer whose opponent is near home shrinks it to 80%; with several players the crib
weight for non-dealers is divided among the opponents. For pegging, if any card scores enough to win the game it plays
it; otherwise it uses the Pegger's look-one-reply-ahead values, giving more weight to its own points when it is close to
going out and more weight to the danger of an opponent's reply when an opponent is close. Limitations: it is an estimate
with limited sampling, and it only looks one reply ahead.

## How strong are they?

Seeded two-player tournaments to 121:

- Sharp against Standard, 200 games: Sharp wins 111-89. Over 300 games it wins 175-125 (58%), with a mean final score of
  113.3 against Standard's 111.7.
- Standard against Random: 39-1 (40 games). Sharp against Random: 40-0 (40 games).
- Against Standard over 300 games: Pegger wins 156, Balanced 152, Greedy 136 (so Greedy is weaker than Standard).

`ai.test.js` also checks that Pegger hands back fewer reply points than Greedy over 150 random pegging positions, and
that the Sharp, Standard and Random tournament results above hold (Sharp beats Standard, and each beats Random by more than 3 to 1).

## Adding an AI

1. Create `modules/cribbage/ai/<id>.js` exporting a named object (the existing files use `export const <id> = {...}`):

   ```js
   export const mine = {
     id: 'mine',        // unique, lowercase; stored in saved rooms, so do not rename casually
     name: 'Mine',
     description: '...',
     weight: 1,         // optional; 0 keeps it out of the random pool
     discard(ctx) { /* return an array of ctx.discardCount different cards from ctx.hand */ },
     play(ctx) { /* return one card from ctx.hand that keeps the count at 31 or less, or null if none */ },
   };
   ```

2. Import it in `ai/index.js` and add it to the `defineAIs([...])` list. Keep `standard` first (the fallback).
3. Contexts are plain data built in `game.js` (`discardContext`, `playContext`). Discard: `hand`, `discardCount`,
   `isDealer`, `players`, `me`, `scores`, `target`, `rng`. Play: `hand`, `count`, `sequence` (cards played in this run),
   `played` (cards already played in earlier runs this hand), `starter`, `players`, `me`, `isDealer`, `cardsLeft`
   (cards still held per seat), `scores`, `target`, `rng`. AIs never see another player's hand.
4. Use `ctx.rng`, never `Math.random`. An AI that samples should be repeatable: see `hashedRng` in `ai/helpers.js`, which
   seeds from the cards. Helpers for splits, unseen cards, crib estimates and reply outlooks are in `ai/helpers.js`
   (`splits`, `unseenFrom`, `averageHandScore`, `cribEstimate`, `replyOutlook`), and `peggingValues` is in `pegger.js`.
5. Add tests to `modules/cribbage/ai.test.js`: the AI is legal in random situations and in complete games at each player
   count, shows its distinguishing trait, and is covered by the id and weight list test (which asserts the exact id order).
