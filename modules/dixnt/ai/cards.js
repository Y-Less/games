// Card metadata for the AIs, as plain data. The site only knows which category each card belongs to, so that is all
// there is: { categoryOf: { [cardId]: categoryKey }, categories: { [key]: { label, description } } }.

export const NO_CARDS = Object.freeze({ categoryOf: {}, categories: {} });

/** Builds the card info from the parsed contents of cards/categories.json ({ categories: [{ key, label, description, ids }] }). */
export function buildCardInfo(json) {
  const info = { categoryOf: {}, categories: {} };
  for (const c of json?.categories ?? []) {
    info.categories[c.key] = { label: c.label ?? c.key, description: c.description ?? '' };
    for (const id of c.ids ?? []) info.categoryOf[id] = c.key;
  }
  return info;
}
