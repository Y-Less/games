// Invite codes for game rooms: three words from a word list, like "boss-aware-you". Shared by every module.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseCode } from '../shared/codes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORDS = fs.readFileSync(path.join(here, 'code-words.txt'), 'utf8').split(/\r?\n/).filter((w) => /^[a-z]+$/.test(w));

export const codes = {
  /** A fresh code that `taken(code)` says is not in use. */
  generate(taken = () => false) {
    for (let i = 0; i < 1000; i++) {
      const picked = [];
      while (picked.length < 3) {
        const word = WORDS[Math.floor(Math.random() * WORDS.length)];
        if (!picked.includes(word)) picked.push(word);
      }
      const code = picked.join('-');
      if (!taken(code)) return code;
    }
    throw new Error('Could not make an invite code.');
  },

  /** Tidies what a person typed or pasted (see shared/codes.js). */
  normalise: normaliseCode,
};
