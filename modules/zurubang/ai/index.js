// The Zurubang computer players.  `standard` is first, which makes it the fallback for a room saved before AIs
// existed or holding one that has since been removed.
// Depends on shared/ai.js and each AI file in this folder.
import { defineAIs } from '../../../shared/ai.js';
import { hasardeur } from './hasardeur.js';
import { random } from './random.js';
import { sharp } from './sharp.js';
import { standard } from './standard.js';

export const AIS = defineAIs([standard, sharp, hasardeur, random]);
