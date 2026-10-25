# Rummikub

Be the first to empty your rack by building **runs** and **groups** of numbered tiles on the table. Two to six players; computer players can fill any seats.

## The tiles

- Tiles are numbered **1 to N** in **C colours**, with **two copies** of every colour and number, plus a few **wildcards** (jokers). The standard game is 13 numbers, 4 colours and 2 wildcards: 106 tiles.
- Every colour has its own shape as well as its own hue, so no tile depends on colour alone.
- The host chooses in the lobby (anything out of range is moved to the nearest allowed value): **numbers per colour** (2 to 20, default 13), **colours** (2 to 8, default 4), **wildcards** (0 to 8, default 2), **rounds** (1 to 10, default 1), the **first meld** points (0 to 60, default 30) and an optional **turn timer** (off by default; 15 seconds to 5 minutes).
- The tile set must be able to make a set at all (at least 3 numbers or 3 colours).

## Dealing

- Everyone is dealt **14 tiles**; the rest form the face-down **pool**. If the pool would be smaller than a hand (a small tile set with many players) each player gets fewer: the tile total divided by the number of players plus one, rounded down. A game is refused at the start if that would be fewer than 6 tiles each.
- Play goes clockwise. The first player of the first round is random and the first player moves along one seat each round.

## Sets

- A **run** is three or more tiles of **one colour** with **consecutive numbers**. It cannot go round from the highest number back to 1.
- A **group** is three or more tiles of **one number** in **different colours** (so at most one tile per colour).
- A **wildcard** stands for any tile that makes the set valid. Several wildcards can be in one set, but a set needs at least one ordinary tile. The order you place the tiles in does not matter: the game works out what each wildcard stands for (a wildcard that could go at either end of a run counts at the higher end).

## Your turn

You either **play** or **draw**.

- **Draw**: take one tile from the pool and your turn ends. When the pool is empty, drawing is a **pass**.
- **Play**: add one or more tiles from your rack to the table. You may rearrange the table however you like: split runs, combine sets, take a tile from one set to make another, replace a wildcard with the tile it stood for and use the wildcard elsewhere. When you press **End turn** the table must follow these rules, or nothing changes and you can carry on arranging (or press **Reset turn**):
  - every tile that was on the table at the start of your turn is still on the table;
  - the only new tiles come from your own rack, and you added at least one;
  - every set is a valid run or group.
- Wildcards can never be kept: because every tile must stay on the table, one you take from a set has to be used in a valid set again in the same turn.

## The first meld

Before you may touch the table you must lay down a **first meld**: new sets made **only of your own rack tiles**, worth at least **30 points** together (or whatever the host chose). Each tile counts its number, and a wildcard counts as the tile it stands for. Until you have melded you cannot add to, split or take from sets already on the table; those stay exactly as they are. Once you have melded, the whole table is yours to rearrange.

## Ending a round and scoring

- A round ends when somebody **empties their rack** and wins it, or when the **pool is empty and everybody has passed in a row**; then the player with the **lowest rack total** wins (tied players share the win).
- Tiles in a rack are worth their number, and a wildcard is worth **30**.
- Every other player **loses their rack total** and the winner **gains the total of the others' racks**. If the round ended with nobody out, each other player loses the difference between their rack and the winner's, and the winner gains all of that (shared, rounded down, between tied winners).
- A game is one round by default. With more rounds, scores add up, everybody presses Continue to start the next round (it starts by itself after a minute), and the highest total after the last round wins.
