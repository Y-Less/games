// What Gaudi counts about each player for the statistics and achievements (see module.json "stats").
//
// Gaudi keeps its counters on the seat as the game goes along rather than in a tally object, so unlike the other
// fifteen modules there is nothing here but the list of keys — which is still where the other fifteen keep theirs,
// and so is where somebody looking for it will look.  `game.js` re-exports it, as it does everywhere else.
//
// Depends on: nothing.

/** The extra statistics recorded for each finished game (see game.js statsPlayers). */
export const STAT_KEYS = ['dicePlaced', 'toolsUsed', 'perfectWindows', 'bestPublicObjective', 'perfectBoards', 'privateTotal', 'emptySpaces', 'thriftyGames', 'allToolsUsed'];
