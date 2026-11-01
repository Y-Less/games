// Invite codes for game rooms: three words from a word list, like "boss-aware-you". Shared by every module.
// Depends on: code-words.txt (the word list, next to this file) and ../shared/codes.js (normaliseCode).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseCode } from '../shared/codes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORDS = fs.readFileSync(path.join(here, 'code-words.txt'), 'utf8').split(/\r?\n/).filter((w) => /^[a-z]+$/.test(w));

export const codes = {
  /**
   * A fresh code that `taken(code)` says is not in use. Tries up to 1000 times, since a clash is rare but possible.
   * @param {(code: string) => boolean} [taken]  whether a code is already in use (nothing is taken by default)
   * @returns {string} three distinct words joined by hyphens
   * Side effects: none (reads Math.random); throws if no free code is found.
   */
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

  /**
   * Tidies what a person typed or pasted (see shared/codes.js).
   * @param {string} input  the raw text
   * @returns {string} the code in its canonical form
   * Side effects: none.
   */
  normalise: normaliseCode,
};
