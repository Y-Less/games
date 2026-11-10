// Uploaded pictures (backgrounds and card backs): what is accepted, how they are stored under <dataDir>/uploads and how
// they are served.  The routes that receive them are in routes/uploads.js.
//
// Every file has a row in the `uploads` table, and the row is written before the file is.  That order is the whole
// point of the table: a crash between writing a picture and recording it on the profile used to leave a file nothing
// pointed at and nothing could find, and the only thing that ever cleared one was a scan of the entire uploads folder
// on somebody's next upload.  Now the row exists either way, so the hourly sweep can see it, and no request path reads
// the directory at all.
//
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

/** How long an uploaded file may sit unclaimed before the sweep takes it (one hour). */
export const ORPHAN_MS = 60 * 60 * 1000;

/**
 * Makes the uploads folder and the operations on it. `serve` hands the files out with a long cache time because each name
 * is random and never reused, and with nosniff so a mislabelled file is never run as a page.
 * @param {string} uploadsDir  the folder pictures are kept in (created when missing)
 * @param {import('node:sqlite').DatabaseSync} db  the site database, which holds one row per stored file
 * @returns {{ serve: import('express').RequestHandler, removeImages: Function, saveImage: Function, keep: Function, sweep: Function }}
 * Side effects: creates the folder, and gives a row to any file that has not got one (see below).
 */
export function createUploads(uploadsDir, db) {
  fs.mkdirSync(uploadsDir, { recursive: true });

  const insert = db.prepare('INSERT OR IGNORE INTO uploads (file, user_id, kind, created_at, in_use) VALUES (?, ?, ?, ?, ?)');
  const markKept = db.prepare('UPDATE uploads SET in_use = 1 WHERE file = ?');
  const forget = db.prepare('DELETE FROM uploads WHERE file = ?');
  const othersOfKind = db.prepare('SELECT file FROM uploads WHERE user_id = ? AND kind = ? AND file <> ?');
  const allOfKind = db.prepare('SELECT file FROM uploads WHERE user_id = ? AND kind = ?');
  const unclaimed = db.prepare('SELECT file FROM uploads WHERE in_use = 0 AND created_at < ?');
  const known = db.prepare('SELECT 1 FROM uploads WHERE file = ?');

  /**
   * Gives a row to every file that has not got one, once, when the site starts.
   *
   * Pictures stored before this table existed have no row, and without one nothing would ever replace or remove them:
   * their owner's next upload would leave the old file behind for good.  They are taken as kept, because a file that
   * was there before the site restarted is one somebody's profile is using.  A file left behind by a crash is *not*
   * adopted, because it already has a row — written before it was — and so it stays unclaimed and is swept.
   *
   * This reads the directory, which is exactly what the rest of this file no longer does; it happens once at start-up
   * rather than on a request.
   *
   * @returns {void}
   * Side effects: inserts rows.
   */
  function adoptStrays() {
    const now = Date.now();
    for (const file of fs.readdirSync(uploadsDir)) {
      const [kind, userId] = file.split('-');
      if (!known.get(file)) insert.run(file, Number(userId) || 0, kind, now, 1);
    }
  }
  adoptStrays();

  /** Deletes one file and forgets it, whether or not the file is still there. */
  const drop = (file) => {
    fs.rmSync(path.join(uploadsDir, file), { force: true });
    forget.run(file);
  };

  /**
   * Deletes a user's uploaded pictures of one kind, except one file.
   * @param {'bg' | 'cb'} kind  'bg' for backgrounds, 'cb' for card backs
   * @param {number} userId
   * @param {string | null} [except]  a file name to keep
   * @returns {void}
   * Side effects: deletes files from the uploads folder and their rows.
   */
  function removeImages(kind, userId, except = null) {
    const rows = /** @type {{ file: string }[]} */ (except === null ? allOfKind.all(userId, kind) : othersOfKind.all(userId, kind, except));
    for (const row of rows) drop(row.file);
  }

  /**
   * Checks an uploaded picture and stores it as <kind>-<user>-<random>.<ext>.
   *
   * The earlier pictures are *not* deleted here: that happens in `keep`, once the profile naming this one has been
   * written.  If anything goes wrong in between, the user still has the picture they had, and the new file is left
   * unclaimed for the sweep rather than having destroyed the old one on the strength of an upload that never counted.
   *
   * @param {{ kind: 'bg' | 'cb', userId: number, contentType: string | undefined, body: *, now?: number }} upload
   *   body is what express.raw produced (a Buffer when the type was accepted)
   * @returns {string}  the stored file's name
   * @throws {AuthError} 415 when it is not a PNG, JPEG or WebP picture
   * Side effects: writes a row, then a file.
   */
  function saveImage({ kind, userId, contentType, body, now = Date.now() }) {
    const type = IMAGE_TYPES[contentType?.split(';')[0]];
    if (!type || !Buffer.isBuffer(body) || !body.length) throw new AuthError('invalidImage', 415);
    if (!type.magic(body)) throw new AuthError('imageTypeMismatch', 415);
    const file = `${kind}-${userId}-${crypto.randomBytes(6).toString('hex')}.${type.ext}`;
    insert.run(file, userId, kind, now, 0); // the row first: a file with no row is a file nobody can find
    fs.writeFileSync(path.join(uploadsDir, file), body);
    return file;
  }

  /**
   * The profile now names this picture, so it is the user's one of its kind: it is kept, and the ones it replaces go.
   * @param {'bg' | 'cb'} kind
   * @param {number} userId
   * @param {string} file  the file `saveImage` returned
   * @returns {void}
   * Side effects: marks the row kept, and deletes the user's earlier files of that kind with their rows.
   */
  function keep(kind, userId, file) {
    markKept.run(file);
    removeImages(kind, userId, file);
  }

  /**
   * Deletes pictures that were stored but never claimed by a profile — an upload that failed between the file being
   * written and the setting being saved.  Run on the site's hourly sweep.
   * @param {number} [now]  the clock
   * @param {number} [maxAge]  how long an unclaimed file is given before it goes
   * @returns {number} how many were deleted
   * Side effects: deletes files and rows.
   */
  function sweep(now = Date.now(), maxAge = ORPHAN_MS) {
    const rows = /** @type {{ file: string }[]} */ (unclaimed.all(now - maxAge));
    for (const row of rows) drop(row.file);
    return rows.length;
  }

  const serve = express.static(uploadsDir, { maxAge: '30d', immutable: true, setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') });

  return { serve, removeImages, saveImage, keep, sweep };
}
