const WORDS = { A: ['Ace', 'Aces'], J: ['Jack', 'Jacks'], Q: ['Queen', 'Queens'], K: ['King', 'Kings'] };

/** "Aces", "7s" (or, for one card, "an Ace", "a 7"): how a rank is spoken. */
export function rankWord(rank, count = 2) {
  const [one, many] = WORDS[rank] ?? [rank, `${rank}s`];
  if (count !== 1) return many;
  return `${rank === 'A' || rank === '8' ? 'an' : 'a'} ${one}`;
}
