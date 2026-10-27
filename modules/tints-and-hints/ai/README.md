# Tints and Hints computer players (AIs)

The computer players exist for testing, so there is one AI and it has no logic.

| id | name | what it does |
| --- | --- | --- |
| `random` | Random | As the hinter it types a random everyday word (the list `WORDS` in `random.js`); as a guesser it picks a random square of the grid, in round two too (it ignores the first guesses and the hint). |

- **Layout.** `index.js` builds `AIS` with `defineAIs` from `shared/ai.js`; add an AI by dropping a file here and listing
  it. Keep the first entry as the fallback. Files use only the `rng` they are given, never `Math.random`.
- **Choosing.** When a game starts every computer player is dealt an AI with `assignAIs(AIS, ids, rng)` and the id is
  stored on the seat (`room.players[i].ai`). A new game deals again. People who leave are not replaced.
- **View.** `players[].ai` is `{ id, name }` for computer players once the game has started, otherwise `null`.
- **Context.** `game.js` builds the decision from that seat's own `viewFor`, so a guesser never sees the secret tint.
  If an AI throws or answers with something illegal, a random legal choice is made instead.
