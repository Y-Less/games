// A small hand-written word list per card category, used by the AIs that try to match a clue to a card. The only
// card metadata the site has is each card's category (cards/categories.json), so "does this word suit this card"
// really means "does this word suit this category". Stems are matched as word prefixes ("dragon" matches "dragons").
// Category keys that are not listed here are still matched against the words of their own description.

export const THEMES = {
  fantasy: ['dragon', 'elf', 'elves', 'wizard', 'magic', 'spell', 'enchant', 'myth', 'legend', 'unicorn', 'sword', 'quest', 'wonder', 'beast', 'giant', 'ghost', 'spirit', 'moon', 'star', 'dream', 'shadow', 'dark', 'mystic', 'secret', 'ancient', 'curse', 'potion', 'forest', 'hero', 'brave', 'valour', 'holy', 'grail', 'prayer', 'relic', 'riddle', 'enigma', 'witch', 'tower', 'mirror', 'echo', 'hollow'],
  fairy_tales: ['fairy', 'tale', 'story', 'sleeping', 'beauty', 'wolf', 'thief', 'gentle', 'kind', 'wish', 'gingerbread', 'princess', 'prince', 'queen', 'king', 'witch', 'apple', 'glass', 'slipper', 'bargain', 'once', 'lost', 'forest', 'cottage', 'child', 'family', 'heir', 'orphan', 'goose', 'bear', 'sheep', 'swan', 'gift', 'tender', 'innocen', 'folk', 'moral', 'lesson', 'spider', 'web', 'tower', 'spindle'],
  modern: ['house', 'home', 'train', 'library', 'city', 'street', 'office', 'car', 'bus', 'phone', 'screen', 'room', 'kitchen', 'family', 'friend', 'party', 'day', 'trip', 'commute', 'rain', 'light', 'door', 'window', 'garden', 'park', 'shop', 'school', 'work', 'weekend', 'neighbour', 'gossip', 'evening', 'morning', 'parlour', 'personal', 'space', 'spare', 'everyday', 'routine', 'souvenir', 'stranger', 'journey'],
  sci_fi: ['space', 'robot', 'star', 'planet', 'alien', 'galaxy', 'rocket', 'future', 'machine', 'android', 'cyber', 'laser', 'orbit', 'moon', 'cosmic', 'cosmos', 'signal', 'silent', 'cold', 'drift', 'void', 'outer', 'light', 'time', 'borrowed', 'paradox', 'pendulum', 'lattice', 'circuit', 'energy', 'experiment', 'discover', 'breakthrough', 'ship', 'ghost ship', 'frozen', 'isolation', 'strange'],
  steampunk: ['brass', 'clockwork', 'airship', 'gas', 'lamp', 'lantern', 'steam', 'gear', 'cog', 'engine', 'machine', 'invent', 'victorian', 'goggle', 'smoke', 'iron', 'pendulum', 'tick', 'watch', 'ship', 'balloon', 'fog', 'soot', 'copper', 'lattice', 'mechan', 'gondola', 'jetty', 'harbour', 'dusk', 'nocturne', 'elegance', 'nobility', 'parlour', 'heavy', 'leaden', 'precaution', 'duty'],
  medieval: ['castle', 'knight', 'market', 'minstrel', 'king', 'queen', 'noble', 'crown', 'banner', 'shield', 'sword', 'siege', 'tournament', 'feast', 'fair', 'peasant', 'monk', 'abbey', 'village', 'tower', 'watch', 'gate', 'honour', 'duty', 'valour', 'bargain', 'alliance', 'oath', 'heir', 'family', 'stone', 'heavy', 'ruin', 'hardship', 'scarcity', 'harvest', 'herald', 'fire', 'hearth', 'justice', 'prayer', 'chivalr'],
  games: ['game', 'play', 'player', 'dice', 'card', 'board', 'chess', 'puzzle', 'level', 'quest', 'score', 'win', 'lose', 'luck', 'rotten', 'bluff', 'party', 'move', 'rule', 'toy', 'challenge', 'contest', 'race', 'running', 'joke', 'bet', 'gamble', 'rival', 'alliance', 'tactic', 'strategy', 'token', 'pawn', 'king', 'bright', 'spark', 'rising', 'star', 'prize', 'trophy', 'fair'],
  food: ['food', 'feast', 'bread', 'cake', 'bak', 'kitchen', 'cook', 'hunger', 'thirst', 'craving', 'spicy', 'sweet', 'sour', 'salt', 'sugar', 'fruit', 'apple', 'summer', 'harvest', 'market', 'abundance', 'plenty', 'lavish', 'table', 'dinner', 'supper', 'breakfast', 'tea', 'wine', 'fireside', 'hearth', 'gathering', 'family', 'gratitude', 'comfort', 'warm', 'tender', 'recipe', 'taste'],
};

const tokens = (text) => String(text ?? '').toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3);

const STOP = new Set(['and', 'the', 'for', 'with', 'new', 'that', 'this', 'from', 'into', 'our']);

/** How many of the stems match the clue (a stem with a space must appear in the phrase; others match word starts). */
function matches(word, stems) {
  const text = String(word ?? '').toLowerCase();
  const words = tokens(text);
  let score = 0;
  for (const stem of stems) {
    if (stem.includes(' ')) {
      if (text.includes(stem)) score++;
    } else if (words.some((t) => t.startsWith(stem) || (t.length >= 4 && stem.startsWith(t)))) score++;
  }
  return score;
}

/**
 * How well a clue suits each category: { [categoryKey]: score >= 0 }.
 * @param {string} word the clue
 * @param {{ [key: string]: { label?: string, description?: string } }} categories from the card info
 */
export function themeScores(word, categories) {
  const out = {};
  for (const [key, info] of Object.entries(categories)) {
    const descriptionStems = tokens(`${info.label ?? ''} ${info.description ?? ''}`).filter((t) => !STOP.has(t) && t.length >= 4);
    out[key] = matches(word, THEMES[key] ?? []) + matches(word, descriptionStems);
  }
  return out;
}
