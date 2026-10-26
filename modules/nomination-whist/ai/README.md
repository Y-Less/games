# Nomination Whist computer players (AIs)

Every computer-controlled seat in Nomination Whist plays with one of six AIs. The game has three to seven players. An AI
makes two kinds of decision: how many tricks to nominate, and which card to play to hit that number exactly. The general
mechanism is described in `MODULES.md` ("Computer players (AIs)") and `shared/ai.js`.

## How a bot gets its AI

- When the host starts a game, every bot seat is given an AI by a weighted random pick (`assignAIs(AIS, bots, rng)` from
  `shared/ai.js`, with the game's seeded `rng`). Play again starts a new game and draws afresh.
- The AI id is stored on the seat (`room.seats[i].ai`), so it survives a restart and a human leaving.
- A bot that replaces a human who leaves mid-game picks its AI at that moment (`pickAI`).
- Rooms saved before AIs existed, or with an unknown id, fall back to the first AI, `standard`.
- The view exposes `seats[].ai` as `{ id, name }` for bots once the game has left the lobby, and `null` otherwise.
- Illegal answers are overruled: a bad nomination or card is replaced by the Standard AI's choice.

## The AIs

| id | Name | Weight | Summary |
| --- | --- | --- | --- |
| `standard` | Standard | 3 | The original bot: nominates from a rule-of-thumb trick count, then plays to hit its number exactly. First in the list, so it is the fallback. |
| `random` | Random | 0.5 | Any allowed nomination and any legal card. |
| `cautious` | Cautious | 1 | Nominates fewer tricks than its hand is worth, then ducks as soon as it has enough. |
| `optimist` | Optimist | 1 | Nominates more tricks than its hand is worth and fights for them. |
| `counter` | Counter | 1 | Counts the unseen cards to judge its chance of winning each trick. |
| `sharp` | Sharp | 1.5 | Simulates the rest of the round many times to choose the nomination and the card. |

## How each one decides

**Standard.** Its nomination comes from `estimateTricks`: high trumps count for most of a trick each (Ace 0.95 down to
about 0.14 for low trumps), side-suit Aces and Kings add partial tricks, and short side suits add ruffing tricks; more
players reduce the side-suit values because somebody is more likely to be void. A little noise is added and the nearest
allowed number is chosen (the dealer's forbidden number is excluded by `allowed`). If the instant-win round is on and its
hand is a run of top trumps that can realistically take all seven tricks, it nominates 7. For play it works from `need`
(its nomination minus tricks won). While it needs tricks it leads sure winners (trump masters first), otherwise a high
side card, and when following it wins as cheaply as it can (the lowest winner if last to play, a sure winner if it has
one, otherwise the highest card of the suit led). Once it has enough tricks it ducks: leads low, plays the highest card
that loses, and sheds high cards when it cannot follow. Limitations: its estimate is a rule of thumb that ignores the
other nominations and who is void in what, so it can fail to see a trick coming.

**Random.** Picks any allowed number and any legal card. Weakest opponent.

**Cautious.** Uses the Standard estimate scaled by 0.7 and reduced by 0.25 (never below 0), so it often nominates low or
zero. It plays exactly as Standard does. The aim is to avoid being forced to win tricks it does not want, at the cost of
rarely nominating high scores. Limitations: it does not use the instant-win nomination, and under-nominating loses the
points of a big hand.

**Optimist.** Uses the Standard estimate scaled by 1.1 plus 0.45 (capped at the hand size), so it nominates more than the
hand is probably worth; it still nominates 7 for a hand that can take everything when the instant-win round is on. It then
plays as Standard, fighting to win the tricks it has promised. Limitations: it often cannot deliver what it promised, which
is why it scores worst of the non-random AIs.

**Counter.** Counts cards. For each card in hand it computes the chance of winning a trick from the unseen cards (how many
higher cards of the suit are still out and how likely the opponents are to hold them, with an allowance for opponents
being void and ruffing with trumps), and its nomination is the sum of those chances. When playing, it scores each legal
card by its chance of winning; if it needs tricks it plays the cheapest card within five percentage points of the best
chance, and if it has enough it plays the highest card that is among the least likely to win. It also takes the
instant-win nomination of 7 when it can. Limitations: it plays cards well but nominates less well (see the tournament figures below); its estimate is the sum of per-card chances, which may be
a simplification.

**Sharp.** For nomination it takes the Standard estimate as a centre, considers the allowed numbers within about 2.2 of it
(and 0), and for each candidate deals the unseen cards to the other seats at random 36 times, plays the whole round out
(opponents using Standard's card play and bids estimated from their dealt hands, or their real nominations once made),
and picks the number with the best average score; the scoring is the game's (a hit scores 10 plus the number, a miss scores
the tricks taken only if that option is on, plus a large bonus for the instant-win round). For play it does the same with
each legal card over 40 samples, respecting suits known to be void from the trick in progress, with a small bias
in favour of the card Standard would play so that sampling noise does not argue it out of a good card. It nominates 7 for
the instant win exactly as Standard does. Limitations: it is a sampled estimate, it only infers voids from the current
trick, and it models opponents as Standard players.

## How strong are they?

Mean scores from seeded tournaments (higher is better):

- 4 seats (Sharp, Standard, Standard, Random), 100 games: Sharp 107.5, Standard 93.0, Random 49.7.
- 6 seats, 60 games: Sharp 116.9, Standard 106.9, Cautious 100.3, Counter 102.1, Optimist 79.6, Random 40.1.
- Counter is good at card play but weaker at nominating.

`ai.test.js` asserts that Sharp's mean beats Standard's by more than 3 in the 4-seat game and that Standard beats Random by
more than 20; and in the 6-seat game that Sharp beats Standard, and Standard beats both Random and Optimist.

## Adding an AI

1. Create `modules/nomination-whist/ai/<id>.js` exporting a named object (the existing files use `export const <id> = {...}`):

   ```js
   export const mine = {
     id: 'mine',        // unique, lowercase; stored in saved rooms, so do not rename casually
     name: 'Mine',
     description: '...',
     weight: 1,         // optional; 0 keeps it out of the random pool
     nominate(ctx) { /* return a number from ctx.allowed */ },
     play(ctx) { /* return one card from ctx.legal */ },
   };
   ```

2. Import it in `ai/index.js` and add it to the `defineAIs([...])` list. Keep `standard` first (the fallback).
3. Contexts are plain data built in `game.js` (`nominateContext`, `playContext`). Nominate: `hand`, `trump` (may be null
   for a no-trump round), `players`, `allowed`, `instantWin`, `missPoints`, `seat`, `dealer`, `cards` (cards this round),
   `nominations` (so far; undefined until made), `rng`. Play: `hand`, `legal`, `trick` (cards), `trickPlays`
   (`[{ seat, card }]`), `trump`, `played` (every card seen this round), `need`, `players`, `seat`, `nominations`, `taken`,
   `handSizes`, `cards`, `instantWin`, `missPoints`, `rng`. AIs never see another player's hand.
4. Use `ctx.rng`, never `Math.random` (default to it only for callers that supply no `rng`, as the existing AIs do), so
   seeded games and tests repeat. Keep AIs free of sockets, files and state. Card helpers (`strength`, `winningCard`,
   `isMaster`, `unseenCards`, `nearestAllowed`) are in `ai/cards.js`; `estimateTricks`, `canTakeAllSeven` and `chooseCard`
   are in `ai/standard.js`.
5. Add tests to `modules/nomination-whist/ai.test.js`: the AI nominates allowed numbers and plays legal cards in random
   situations and in complete games at each player count, shows its distinguishing trait, and fits the id and weight list test.
