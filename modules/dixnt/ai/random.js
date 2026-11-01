// Every decision is a uniform random choice among the legal ones: exactly what the standard bot does, so this is the
// standard AI under another name and weight, kept so it can be asked for by name (and weighted separately) in tests.
// Depends only on ./standard.js.
import { standard } from './standard.js';

export const random = {
  ...standard,
  id: 'random',
  name: 'Random',
  description: 'Just picks a random legal move every time.',
  weight: 0.5,
};
