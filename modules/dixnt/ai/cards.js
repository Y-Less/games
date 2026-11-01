// Card metadata for the AIs, as plain data. The site only knows which category each card belongs to, so that is all
// there is: { categoryOf: { [cardId]: categoryKey }, categories: { [key]: { label, description } } }.
// Depends on nothing; the server builds the info once from cards/categories.json and hands it to every AI decision.

export const NO_CARDS = Object.freeze({ categoryOf: {}, categories: {} });

/**
 * Builds the card info from the parsed contents of cards/categories.json.
 * @param {{ categories?: { key: string, label?: string, description?: string, ids?: number[] }[] } | null | undefined} json  parsed file; missing parts are tolerated
 * @returns {{ categoryOf: { [cardId: number]: string }, categories: { [key: string]: { label: string, description: string } } }} the lookup tables the AIs use
 * Side effects: none.
 */
export function buildCardInfo(json) {
  const info = { categoryOf: {}, categories: {} };
  for (const c of json?.categories ?? []) {
    info.categories[c.key] = { label: c.label ?? c.key, description: c.description ?? '' };
    for (const id of c.ids ?? []) info.categoryOf[id] = c.key;
  }
  return info;
}
