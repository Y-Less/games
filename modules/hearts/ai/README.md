# Hearts computer players (AIs)

Every computer-controlled seat in Hearts plays with one of six AIs, each a different style from "carefully safe" to
"anything legal". This file describes what each one does and how to add another. The general mechanism is in
`MODULES.md` ("Computer players (AIs)") and `shared/ai.js`.

## How a bot gets its AI

- When the host starts a game, every bot seat is given an AI by a weighted random pick (`assignAIs(AIS, botSeats, rng)`
  from `shared/ai.js`, using the game's own seeded `rng`). This happens just after the deal, so the deal itself is not
  changed. Play again draws afresh.
- The AI id is stored on the seat (`room.seats[i].ai`), so it survives a restart, a reconnection and a human leaving.
- A bot that takes over from a human who leaves mid-game picks its AI at that moment (`pickAI(AIS, rng)`).
- A room saved before AIs existed, or with an unknown id, falls back to the first AI (`standard`) via `aiById`.
- The view exposes `seats[].ai` as `{ id, name }` for bot seats once the game has started (not in the lobby, and never
  for humans).
- An illegal answer from an AI is overruled: a bad pass falls back to the standard pass, a bad play to the first legal
  card.

## The AIs

| id | Name | Weight | Summary |
| --- | --- | --- | --- |
| `standard` | Standard | 3 | The original bot: leads low, ducks point tricks, flushes out the Queen of Spades, dumps danger cards. First in the list, so it is the fallback. |
| `sharp` | Sharp | 3 | Counts cards, infers voids, and looks ahead by simulating the rest of the hand. The strongest. |
| `moon` | Moon shooter | 1 | Always tries to shoot the moon, giving up when the attempt is clearly dead. |
| `jack` | Jack hunter | 1 | Hunts the Jack of Diamonds when that option is on; otherwise exactly Standard. |
| `avoider` | Avoider | 1 | Avoids points at all costs; ducks everything and dumps penalty cards. |
| `random` | Random | 0.5 | Any legal pass and any legal card. |

## How each one decides

**Standard.** Passes the three most dangerous cards: the Queen of Spades first, then high spades (unless it holds the
Queen with five or more spades, when they are cover) and high hearts, then its highest other cards; with the Jack of
Diamonds option on it keeps the Jack. When leading it plays the lowest card (picked at random among equal ranks), avoiding
hearts, avoiding spades if it holds the Queen, and avoiding the Jack. If it holds no Queen and the Queen is unplayed it
leads low spades to flush it out. When following it plays the highest card that still loses the trick; if it cannot
duck it wins as cheaply as possible, or, when last to play, sheds its highest card (never the Queen if it can help it).
When it cannot follow suit it dumps by a worry ranking: the Queen, then high spades while the Queen is unaccounted for,
then hearts high-first, then other high cards. It bids for the moon only with an overwhelming hand (at least five hearts
including the Ace and King, six cards of King or higher, and the Queen of Spades). When it has bid, it passes its three
lowest cards and plays to win tricks. Limitations: it keeps no memory of voids and never tracks who has taken points,
so it can feed a lone point-taker the hearts they need for a moon.

**Sharp.** The strongest AI. For passing it tries every set of three cards from its hand (286 for a 13-card hand) and keeps the set that leaves the hand
with the lowest risk estimate (uncovered Queen, high spades, high hearts, minus a credit for short suits; the Jack counts
as an asset when the option is on). With a moon-worthy hand it passes like Moon. For play it counts every card seen,
notes which seats are void in which suits (from failures to follow), and then looks ahead: it deals the unseen cards to
the other seats in 16 plausible ways (respecting known voids and the cards it passed), plays each candidate card out to
the end of the hand against opponents modelled on Standard, and picks the card with the lowest average penalty. That one
mechanism produces its safe leads, Queen management, dumping penalty cards on whoever will win the trick, and good
timing of when to win or duck. On top it has moon rules (the hold-back tactic): while exactly one other seat owns every
point so far, it will not feed that seat more penalty cards (it keeps its high hearts and the Queen back, and treats that
seat as a moon chaser once they hold three hearts), and it may take a point trick itself so that two seats own points and
the moon is dead. Once two seats have points it dumps high hearts and the Queen freely. If it has bid for the moon it
plays Moon's strategy while that attempt is alive. Limitations: it is a sampled estimate, not perfect play, and its
model of opponents is the Standard AI, so it can misjudge unusual opponents.

**Moon shooter.** Always tries to shoot the moon. It passes the three cards worth least to a moon attempt and keeps long,
strong suits and hearts. It cashes sure winners (cards nothing unseen can beat) from side suits first, then hearts; wins
tricks, especially ones with hearts or the Queen; and never gives a heart away while the attempt is alive. The attempt is
treated as dead once another seat has taken a point card, once a point card sits under a rival's winning card it cannot
beat, or (from the fourth trick) once five or more of the remaining tricks are out of reach; then it plays exactly like
Standard. Limitations: it commits whatever its hand, and plays like Standard once the attempt is dead.

**Jack hunter.** Only differs from Standard when the Jack of Diamonds option is on. It does not pass diamonds, and while
the Jack is still unwon and it holds a diamond it uses Sharp's look-ahead with the Jack valued at 16 points rather than
its real -5. This makes it lead diamonds to flush the Jack out, play its own Jack only when it will win, and accept a few
hearts to take the trick. Otherwise (or with the option off) it plays exactly as Standard, including the moon bid.
Limitations: it only hunts while the Jack is still out and it holds a diamond, and otherwise has Standard's weaknesses.

**Avoider.** Tries never to take points. It passes the Queen (unless it has a long spade suit covering it), high spades and
high hearts, and also empties short suits to make voids. It leads low non-hearts (flushing the Queen with a low spade if
it is not its own), ducks with the highest card that still loses, takes unavoidable tricks as cheaply as possible (or sheds
its top card when last), and dumps the Queen, then high hearts, then high spades when it cannot follow. It also uses the
hold-back tactic: while exactly one other seat owns all the points, it sheds other cards instead of hearts and the Queen
(if it has any non-point card). Limitations: it never tries to win a trick on purpose and does no look-ahead or card
counting beyond the Queen, so it is no better than Standard.

**Random.** Passes three random cards and plays a random legal card. It exists as the weakest opponent for relaxed games.

## How strong are they?

Seeded tournaments (lower score is better in Hearts):

- Sharp against three Standard bots, 1000 games: Sharp averages 58.6 against Standard's 79.5, and wins 47.9% of games
  (fair share is 25%).
- Sharp against Avoider, Standard and Jack hunter, 300 games: 59.4 against 75.9, Sharp winning 40%.
- Moon shooter shoots the moon in 30.4% of hands against Standard's 0.5%, and wins about 55% of games against Standard.
- Jack hunter takes the Jack of Diamonds in 41.6% of hands against Standard's 24.3%.
- Avoider averages 74.8 against Standard's 75.0: parity, not better.
- Random averages about 106 against about 40 for its opponents.

`ai.test.js` also asserts that Moon shoots at least ten per cent of hands and more than eight times Standard's rate (200
games), that Sharp beats Standard by at least 8 points on average and wins more than 35% over 120 games, and that Sharp
beats a mixed Avoider/Standard/Jack table over 60 games.

## Adding an AI

1. Create `modules/hearts/ai/<id>.js` with a default export:

   ```js
   export default {
     id: 'mine',            // unique, lowercase; stored in saved rooms, so do not rename casually
     name: 'Mine',          // shown to people
     description: '...',
     weight: 1,             // optional; 0 keeps it out of the random pool
     choosePass(ctx) { /* return three different cards from ctx.hand */ },
     choosePlay(ctx) { /* return one card from ctx.legal */ },
     bidsMoon(ctx) { /* optional: true to chase every point this hand; ctx has only { hand, settings } */ },
   };
   ```

2. Import it in `ai/index.js` and add it to the `defineAIs([...])` list. Keep `standard` first (it is the fallback).
3. The context is built by `aiContext` in `game.js` and holds plain data only: `seat`, `hand`, `legal`, `trick`
   (`[{ seat, card }]`), `history` (finished tricks of this hand), `taken` (cards won per seat), `scores`, `settings`
   (`target`, `jackOfDiamonds`, `moon`), `heartsBroken`, `tricksPlayed`, `handNumber`, `direction`, `passed`,
   `received`, `moonBid` (the seat chasing the moon, or null) and `rng`. It never contains another player's hand.
4. Use `ctx.rng`, never `Math.random`, so seeded games and tests repeat. Keep the file free of sockets, files and state:
   an AI is a pure function of its context. Shared helpers (card counting in `observe`, `pointTakers`, `cardPoints`,
   and so on) are in `ai/util.js`.
5. Add tests to `modules/hearts/ai.test.js`: the AI plays whole games legally in the all-bot harness, and shows its
   distinguishing trait over seeded games (`versus` in `arena.js`). Update the list and weight tests there too.
