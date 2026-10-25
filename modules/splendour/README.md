# Splendour

An original engine-building gem game for two to four players (the standard gem-collecting and card-buying mechanics of
the genre, with its own names, card set and artwork), with optional computer players. The rules players see are in
`rules.md`; the module contract is in `../../MODULES.md`.

## Layout

```
module.json    menu entry (1 to 4 people), and the statistics this game reports
rules.md       the player-facing rules
cards.js       the card set: gem colours, 90 development cards and 10 nobles, generated from cost patterns
game.js        the rules as pure functions over a plain room object (no sockets, no files), and each player's view
bot.js         the computer players (heuristics over legal moves; only public information)
server.js      the socket layer: rooms, saving to ctx.dataDir/rooms.json, timers for computer moves, statistics
client/        Vue 3: Splendour (root), Lobby, Table, and the drawn pieces Gem, CardFace and NobleTile
*.test.js      cards, rules, computer players, invariants, robustness (garbage payloads), kick, end to end
```

## Rules decisions

- Tokens are arrays of six counts (Diamond, Sapphire, Emerald, Ruby, Onyx, Gold). Cards and nobles have opaque ids
  (`c01`..`c90`, `n1`..`n10`), so the hidden-information tests can search a view for them.
- Card set: every cost pattern is used once for each bonus colour (rotated, and mirrored on odd patterns), so the
  colours are perfectly balanced: level 1 has 8 per colour (cost 3 to 5, only the best are worth 1 point), level 2 has
  6 per colour (1 to 3 points, cost 5 to 8) and level 3 has 4 per colour (3 to 5 points, cost 7 to 14).
- Taking gems: exactly three different colours when at least three are in the supply, otherwise any number from one up
  to the number of colours left. Two of a colour needs at least four in the supply.
- Going over ten tokens, or having a choice of nobles, makes the room wait in a `pending` state for the same player
  (`giveBack` / `noble`), which is part of the same turn. A computer player does the whole turn in one step.
- A player with no legal move at all passes (`pass`). A game in which a whole round passes, or that reaches round 100,
  ends and is scored normally (so a game can never run for ever).
- Seat order is shuffled at the start. A round is one turn for every seat; the game ends after the round in which
  someone reached the target. Placing: prestige, then fewer cards bought, ties share the place.
- Scoreboard rounds hold the prestige each seat gained in the round, with a note such as "bought a level 2 card (2
  points), noble visited".
