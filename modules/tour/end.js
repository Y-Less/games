// The one word both halves of a tour have to agree on.  It lives in a file of its own so that the client can import it
// without pulling the whole of the rules (and the shared room vocabulary they import) into the browser's bundle.
// Depends on: nothing.

/** The choice in every vote that is not a game: finish the tour. */
export const END = 'end';
