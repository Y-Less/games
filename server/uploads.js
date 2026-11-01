// Uploaded pictures (backgrounds and card backs): what is accepted, how they are stored under <dataDir>/uploads and how
// they are served. The routes that receive them are in routes/uploads.js.
// Depends on: express (serving), node:crypto (random names), node:fs/node:path, and ./errors.js (AuthError).
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AuthError } from './errors.js';

/** The picture types accepted, by Content-Type: the file extension, and a check of the file's first bytes. */
export const IMAGE_TYPES = {
  'image/png': { ext: 'png', magic: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  'image/jpeg': { ext: 'jpg', magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', magic: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
};

/**
 * Makes the uploads folder and the operations on it. `serve` hands the files out with a long cache time because each name
 * is random and never reused, and with nosniff so a mislabelled file is never run as a page.
 * @param {string} uploadsDir  the folder pictures are kept in (created when missing)
 * @returns {{ serve: import('express').RequestHandler, removeImages: Function, saveImage: Function }}
 * Side effects: creates the folder.
 */
export function createUploads(uploadsDir) {
  fs.mkdirSync(uploadsDir, { recursive: true });

  /**
   * Deletes a user's uploaded pictures of one kind, except one file.
   * @param {'bg' | 'cb'} kind  'bg' for backgrounds, 'cb' for card backs
   * @param {number} userId
   * @param {string | null} [except]  a file name to keep
   * @returns {void}
   * Side effects: deletes files from the uploads folder.
   */
  function removeImages(kind, userId, except = null) {
    for (const file of fs.readdirSync(uploadsDir)) {
      if (file.startsWith(`${kind}-${userId}-`) && file !== except) fs.rmSync(path.join(uploadsDir, file), { force: true });
    }
  }

  /**
   * Checks an uploaded picture, stores it as <kind>-<user>-<random>.<ext> and deletes the user's earlier ones of that kind.
   * @param {{ kind: 'bg' | 'cb', userId: number, contentType: string | undefined, body: * }} upload
   *   body is what express.raw produced (a Buffer when the type was accepted)
   * @returns {string}  the stored file's name
   * @throws {AuthError} 415 when it is not a PNG, JPEG or WebP picture
   * Side effects: writes a file and deletes the earlier ones.
   */
  function saveImage({ kind, userId, contentType, body }) {
    const type = IMAGE_TYPES[contentType?.split(';')[0]];
    if (!type || !Buffer.isBuffer(body) || !body.length) throw new AuthError('Please upload a PNG, JPEG or WebP image (up to 3 MB).', 415);
    if (!type.magic(body)) throw new AuthError('That file is not really an image of that type.', 415);
    const file = `${kind}-${userId}-${crypto.randomBytes(6).toString('hex')}.${type.ext}`;
    fs.writeFileSync(path.join(uploadsDir, file), body);
    removeImages(kind, userId, file);
    return file;
  }

  const serve = express.static(uploadsDir, { maxAge: '30d', immutable: true, setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') });

  return { serve, removeImages, saveImage };
}
