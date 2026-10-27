# Tints and Hints computer players (AIs)

The computer players exist for testing, so there is one AI and it has no logic.

| id | name | what it does |
| --- | --- | --- |
| `random` | Random | The grid is cut into 4 x 4 blocks (12 by 6), each with a description by an object of a similar colour, such as "fresh grass" (`describeGroup` in `grid.js`). As the hinter it gives the description of the block holding its secret square; as a guesser it picks a random square of the block that the current hint describes, or any square if the hint is a person's own words (it ignores the first guesses). |

- **Layout.** `index.js` builds `AIS` with `defineAIs` from `shared/ai.js`; add an AI by dropping a file here and listing
  it. Keep the first entry as the fallback. Files use only the `rng` they are given, never `Math.random`.
- **Choosing.** When a game starts every computer player is dealt an AI with `assignAIs(AIS, ids, rng)` and the id is
  stored on the seat (`room.players[i].ai`). A new game deals again. People who leave are not replaced.
- **View.** `players[].ai` is `{ id, name }` for computer players once the game has started, otherwise `null`.
- **Context.** `game.js` builds the decision from that seat's own `viewFor`, so a guesser never sees the secret tint.
  If an AI throws or answers with something illegal, a random legal choice is made instead.
