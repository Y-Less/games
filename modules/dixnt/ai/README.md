# Dixnt computer players (AIs)

## Purpose and how bots get an AI

Dixnt bots are not part of the server. A bot is a separate process (`bots/bot.js`) that uses only the site's public
Socket.IO API, like the browser does. The decision logic is in this folder: one file per AI, and `ai/index.js` exports
the `AIS` array (built with `defineAIs` from `shared/ai.js`).

- **Choosing.** On joining, the bot picks an AI with `pickAI(AIS)` (weighted random), or the one named with `--ai ID`
  (an unknown id is refused at start-up). It picks again whenever a new game starts (the phase moves from the lobby or
  a finished game to the first round); with `--ai` it re-declares the same one. It also re-declares after
  reconnecting, because the server may have restarted.
- **Telling the server.** The bot sends the `declareAI` event with `{ id }`. The server (`game.setAI`) refuses unknown
  ids, stores the id on the player and saves it with the room.
- **View.** `players[].ai` is `{ id, name }` for bots and `null` for people. A seat saved with an AI that no longer
  exists falls back to the first AI (`standard`); one saved before this feature has none.
- **What the bot does.** When it is the chooser it asks the server for hints and the AI picks one; when cards are being
  played the AI picks from its hand; when voting the AI picks from the legal targets. If an AI throws or answers with
  something illegal, the bot makes a random legal choice instead. The bot process passes `Math.random` as the `rng`.

## The AIs

| id | name | weight | summary |
| --- | --- | --- | --- |
| `standard` | Standard | 3 | The bot as it always was: random hint, random card, random vote. |
| `random` | Random | 0.5 | Uniform random legal choices; currently identical to `standard`. |
| `literal` | Literal | 2 | Matches the clue to each card's category; plays the best fit and distrusts the worst. |
| `contrarian` | Contrarian | 1 | Vague clues, half-fitting cards, suspects whoever fits too neatly. |
| `sharp` | Sharp | 2 | Reads the clue and the table, accuses the odd one out; sharp bots agree on a suspect. |

## How each one decides

**Standard.** Every decision is a uniform random choice: which hint, which card, whom to accuse. It is the original
bot. Limitation: it ignores everything it knows.

**Random.** Makes exactly the same decisions as Standard, since both are random. It is kept as a separate AI so it can
be asked for by name (`--ai random`) and given a lower weight in the random pick.

**Literal.** Takes the clue at face value. As the chooser it picks the hint it can match most strongly to a card
category. When playing it chooses the card in its hand whose category suits the clue best. When voting it accuses the
player whose card suits the clue least (in the "favourite" judging style, where the chooser is picking the best card,
it picks the best fit instead). It knows nothing about the other players. When it is the imposter and cannot see the
word, or when the clue means nothing to its word list, it chooses at random.

**Contrarian.** Deliberately hard to read. As the chooser it picks the hint it can match least. It plays the card that
fits the clue about halfway, so nobody can tell a bluff from a real play. When voting it accuses whoever played the
card that fits the clue best (too neat). In the "favourite" style it picks the card that is neither obvious nor off.
It falls back to random when the clue means nothing to it.

**Sharp.** Reads the clue like Literal and also reads the table: players who saw the word play cards that cluster
around it, so the odd one out is probably the imposter. It scores each suspect by how badly their card fits the clue
plus how different its category is from the other cards on the table (the table part still works when the word list
does not know the clue). When it cannot see the word it plays a card from the category it holds most of, the likeliest
to overlap with somebody. Ties are broken by player id rather than at random, so several sharp bots all accuse the
same person (a group needs a clear plurality to catch the imposter). A sharp imposter does the same, which can steer
the vote onto a decoy. In the "favourite" style it picks the best fit.

Limitations common to the smart AIs: clue matching uses a hand-written word list (`lexicon.js`) that recognises only
about 32% of the 1024 hints, and the card metadata (`cards.js`) is category-only, so otherwise they fall back to
table-based or random choices. No AI tracks vote accuracy across rounds.

## How strong are they?

The measure is the share of imposters caught at tables where every player uses the same AI, everyone votes, over 150
seeded games each:

| AI | 4 players | 6 players |
| --- | --- | --- |
| random | 26% | 11% |
| literal | 40% | 27% |
| sharp | 53% | 38% |

- Contrarian is about equal to random (it is built to be hard to read, not to catch anyone).
- Standard and random currently make identical decisions.
- Mixed tables do worse than the all-same ones suggest: a table of 2 sharp and 2 random players caught only 28%,
  because the random players scatter their votes.
- `ai.test.js` asserts that literal beats random by more than 8 points and sharp beats literal by more than 5 at both
  table sizes. It also checks that every AI plays complete, legal games in every judging style, and that each AI is
  repeatable for a given seed.

## Adding an AI

1. Create `ai/<id>.js` exporting an object `{ id, name, description, weight, chooseWord, playCard, vote }`. The `id` is
   lowercase and unique and is saved with the room. `weight` defaults to 1; `0` keeps it out of the random pick (it can
   still be chosen with `--ai`).
2. Implement the three functions, each taking one plain-data context and the `rng`, and returning one of the legal
   options:
   - `chooseWord({ hints, hand, cards, round, judging }, rng)` returns one of `hints`.
   - `playCard({ word, hand, cards, round, judging }, rng)` returns one of `hand`. `word` is `null` when the player is
     the imposter and cannot see the clue.
   - `vote({ word, table, targets, me, imposter, chooser, judging, cards, scores }, rng)` returns one of `targets`.
     `table` is `[{ playerId, cardId }]`; in the "favourite" style this is the chooser picking the best card.

   `cards` is `{ categoryOf, categories }` (category only; see `cards.js`).
3. Keep it to plain data: no sockets, files or clock, and only what that player may know (their own hand, the visible
   table, and the clue only if they can see it). Use the supplied `rng` for randomness, never `Math.random`. The
   helpers in `util.js` (`pick`, `best`, `fitter`, `clueStrength`, `oddness`) and `lexicon.js` are there to reuse.
4. Add it to the list in `ai/index.js`, keeping `standard` first (the fallback for unknown ids).
5. Update `ai.test.js` (the registry test lists the ids) and add a test for the AI's distinguishing behaviour. The bot
   itself needs no change: it uses `AIS`, and `--help` lists the new id.
