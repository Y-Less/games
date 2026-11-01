// The original computer player's decisions now live in ai/standard.js; this keeps the old import path working.
// It only re-exports; there is no code to run here.
export { chooseDiscard, choosePlay, cribPotential } from './ai/standard.js';
