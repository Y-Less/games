# Splendour computer players (AIs)

## Purpose and how bots get an AI

Computer players in Splendour come in several styles, from a carefully calculating one to one that plays any legal move
at random. The registry is `ai/index.js` (built with `defineAIs` from `shared/ai.js`); the first entry, `standard`, is
the original bot and is the fallback.

- When a game starts, every bot seat is given an AI by a weighted random pick (`assignAIs` in `shared/ai.js`), using
  the game's own seeded `rng`. This happens after the deal, so the deal itself is unchanged. A new game (play again)
  draws afresh.
- The choice is stored on the room as `room.ais`, keyed by the bot's seat id, so it survives a restart.
- A bot that takes over from a human who leaves mid-game picks its AI at that moment (`pickAI` in `removeHuman`). In the
  lobby nothing is picked.
- A room saved before AIs existed (no `room.ais`), or one naming an AI that no longer exists, falls back to
  `standard` (`aiById`).
- The view shows `seats[].ai = { id, name }` for bot seats once the game has started, and nothing else about the AI.
- Setting the environment variable `SPLENDOUR_AI` to an AI id makes the server give every bot that AI, instead of a
  random pick, for repeatable runs. An unknown id is ignored.

## The AIs

| id | Name | Weight | Summary |
| --- | --- | --- | --- |
| `standard` | Standard | 3 | A sensible all-rounder: buys good cards, collects the gems it needs and reserves what it is about to afford. |
| `sharp` | Sharp | 3 | The strongest: values a position, looks one move ahead at each opponent's reply, and plays the end of the game exactly. |
| `noble-hunter` | Noble hunter | 2 | Chases the nearest noble by buying the colours it needs. |
| `engine-builder` | Engine builder | 2 | Cheap cards first to build discounts, then big point cards. |
| `rusher` | Rusher | 2 | Buys any card worth points as soon as it can, and reserves cards to deny opponents. |
| `blocker` | Blocker | 2 | Plays like standard but reserves or buys what opponents are about to buy. |
| `random` | Random | 1 | A uniformly random legal move. |

## How each one thinks

**Standard.** Scores every legal move. A card is worth its points, plus a base value, plus a little for each visible
noble it brings closer, a little more when cards on the table cost its colour, and less if it already owns five or more
of that colour. It ranks the cards it could aim for (the table plus its own reserve) by value divided by how many gems it is
short, and takes gems for the best two. It buys when it can, penalising Gold spending and heavy use of coloured gems. It
reserves its best target when it is nearly affordable, or a card worth three or more points that an opponent could buy
right now. It adds a small random jitter to break ties, gives back surplus colours first and Gold last, and takes the
first noble offered. Limits: it does not look at what opponents will do next, and it only reacts to a single threat.

**Sharp.** For every legal move it plays the move on a copy of the table, lets each opponent reply with their own best
move (a purchase or a gem take; it does not consider them reserving), and then judges the result: its position minus
the strongest opponent's (and a quarter-weight for the rest). A position is valued by prestige, discounts (the "engine",
weighted more early on), gems that will actually be spent, a little for Gold, nobles it is close to, and how near the best
two cards are to being affordable. This one-move look-ahead is what makes it deny cards and nobles, give back the right
tokens (it chooses returns by the same valuation, so it keeps what it will spend and Gold last) and spend Gold well. Once
somebody has reached the target, or it could, it counts only who wins when the round is played out. When picking a noble
it takes the one an opponent is closest to. Limits: the look-ahead is a single move per opponent, it cannot see the draw
piles or face-down reserved cards (a card it imagines buying or reserving leaves an empty gap on the table), and it
assumes opponents buy or take gems rather than reserve.

**Noble hunter.** Finds the noble nearest to visiting and values cards of the colours that noble still needs, and gems
that help buy them. It will reserve an expensive card of a needed colour (while holding fewer than two reserved cards). Once
no noble is left, or the nearest is already complete, it plays exactly like standard. When several nobles visit at once it
takes the one an opponent is closest to. Limits: it can pursue a noble long after it has stopped being worth it, and it
ignores threats while chasing.

**Engine builder.** While it has bought fewer than nine cards and has under eight prestige, it buys the cheapest cards it
can (never level 3 by preference), spreading its discounts across colours and avoiding more than four of one. After that
it goes for points per missing gem, preferring higher levels, and only then reserves a big card it is nearly able to
afford. It never reserves early. Limits: it is slow, and never reacts to what an opponent is about to do.

**Rusher.** Buys any card with points at once, the biggest first, and only buys a plain card when nothing better is
possible. It collects gems for the card with the best points per turn. It reserves a card an opponent could buy now when
that is worth three or more points (counting extra if it would put them on the target), or its own best card when it is
nearly affordable and worth two points or more. Limits: it ignores discounts and nobles, so it runs out of cheap
purchases quickly.

**Blocker.** Uses the standard player's move scores and adds a threat bonus: for buying a card, 0.7 times the threat; for
reserving a face-up card, 1.1 times the threat. The threat is how much an opponent gains from a card they can afford now
(or, at a reduced weight, are one gem short of): its points, a large extra if it would put them on the target, and extra
if it would complete a noble for them. It takes the noble an opponent is closest to. Limits: it only sees threats one move
away and otherwise is no better than standard.

**Random.** A uniformly random legal move, random gems to give back and a random noble. It never passes when it has a
move.

## How strong are they?

These are results of seeded tournaments (all-bot games).

- 3 players, 150 games: sharp won 86.7%, standard 13.3%, random 0%.
- 2 players: sharp 92% against standard 8%.
- Standard beat random in 100% of games.
- Noble hunter, engine builder and blocker each beat random 100% of the time, and rusher 98%.
- In ad-hoc four-way runs, noble hunter, engine builder, rusher and blocker all beat standard; standard was only mid-pack.
- A first version of sharp lost 97.5% of its games to standard, because it hoarded gems. Re-weighting its valuation
  fixed that.

`ai.test.js` asserts only the floor of these: in a seeded tournament sharp beats standard, which beats random (3
players, 150 games); sharp wins more than 60% of 150 duels against standard; standard wins more than 80% of 100
games against random; and every other AI beats random more than 70% of the time over 60 games.

## Adding an AI

1. Add `modules/splendour/ai/<id>.js` whose default export is a plain object:
   `{ id, name, description, weight, chooseMove(s, rng), chooseReturn(s, rng), chooseNoble(s, rng) }`.
   `id` is lowercase and unique (it is saved in rooms, so do not rename it later). `weight` is optional and defaults to 1;
   `0` keeps an AI out of the random pool.
2. Add it to the list in `ai/index.js`. Keep `standard` first.
3. `chooseMove(s, rng)` returns one of `s.moves` (or `{ type: 'pass' }` when there are none). `chooseReturn(s, rng)` returns
   six counts (five colours then Gold) that sum to `s.returnCount`. `chooseNoble(s, rng)` returns one of `s.options`.
4. `s` is the plain-data situation built by `situation()` in `bot.js` and documented at the top of `ai/lib.js`: `seat`,
   `n`, `target`, `round`, `finalRound`, `triggeredBy`, `supply`, `board`, `decks` (counts only), `nobles`, `players`
   (tokens, bonuses, prestige, bought, nobles, `reservedCount`, and `reserved` ids, which are all of your own but only the
   face-up ones for others), `moves`, `returnCount` and `options`. Nothing hidden is included: the draw piles and
   opponents' face-down cards are not available, and the tests check this. Do not reach for the room.
5. Use only the `rng` you are given, never `Math.random`, so seeded games and tests repeat. Helpers (`pickBest`,
   `payment`, `targetsOf`, `returnByNeeds`, `randomReturn` and others) are in `ai/lib.js`, and `scoreMoves` in
   `standard.js` is there for AIs that build on standard.
6. Add the id to the checks in `ai.test.js` (the registry test, legality over random positions, whole games at 2, 3 and 4
   players, and a test of its distinguishing trait). `ai-kit.js` has `playWith` and tournament helpers.
