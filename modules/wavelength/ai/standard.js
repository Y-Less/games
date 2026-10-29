// The usual computer players: they know the example clues of a spectrum (see spectra.js). As the psychic they say the
// example nearest the hidden spot. As a guesser they turn the dial to the place of the example the clue matches, with
// some wobble, or near the middle when the clue is not one they know (such as a person's own words).
//
//   clue({ target, anchors }, rng)               -> the clue text
//   guess({ clue, anchors }, rng)                -> a position from 0 to 100
export function makeStandard({ id, name, description, weight, wobble }) {
  const noise = (rng) => (rng() + rng() - 1) * wobble; // two uniforms: bunched towards zero
  const known = (clue, anchors) => anchors.find((a) => a.text.toLowerCase() === String(clue ?? '').trim().toLowerCase());
  return {
    id,
    name,
    description,
    weight,
    clue: ({ target, anchors }) => anchors.reduce((best, a) => (Math.abs(a.position - target) < Math.abs(best.position - target) ? a : best)).text,
    guess: ({ clue, anchors }, rng) => {
      const anchor = known(clue, anchors);
      return anchor ? anchor.position + noise(rng) : 50 + noise(rng) * 2;
    },
  };
}

export const standard = makeStandard({
  id: 'standard',
  name: 'Standard',
  description: 'Knows the example clues well and turns the dial to within a few points of them.',
  weight: 3,
  wobble: 12,
});

export const wobbly = makeStandard({
  id: 'wobbly',
  name: 'Wobbly',
  description: 'Knows the example clues but has an unsteady hand.',
  weight: 2,
  wobble: 30,
});

export default standard;
