// Picture upload routes (a background, a card back) and the folder the pictures are served from.
import express from 'express';
import { handler } from './http.js';
import { IMAGE_TYPES } from '../uploads.js';

/**
 * Registers POST /me/background-image and /me/card-back-image.
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ auth: object, uploads: object, canUse: Function, requireUser: import('express').RequestHandler }} deps
 * @returns {void}
 * Side effects: adds routes; an upload stores a file and makes it the user's setting.
 */
export function registerUploadRoutes(api, { auth, uploads, canUse, requireUser }) {
  /**
   * An upload route: checks the picture, stores it as <kind>-<user>-<random>.<ext>, and makes it the user's setting.
   * @param {string} route  the path under /api
   * @param {'bg' | 'cb'} kind  the stored file name prefix
   * @param {'background' | 'cardBack'} setting  the profile setting the picture becomes
   * @returns {void}
   * Side effects: adds the route.
   */
  const imageUpload = (route, kind, setting) =>
    api.post(
      route,
      requireUser,
      express.raw({ type: Object.keys(IMAGE_TYPES), limit: '3mb' }),
      handler(async (req, res) => {
        // Check the unlock before anything is written to disk.
        canUse(req.user.id, { [setting]: { type: 'image' } });
        const file = uploads.saveImage({ kind, userId: req.user.id, contentType: req.headers['content-type'], body: req.body });
        res.json({ user: auth.updateProfile(req.user.id, { [setting]: { type: 'image', file } }) });
      }),
    );
  imageUpload('/me/background-image', 'bg', 'background');
  imageUpload('/me/card-back-image', 'cb', 'cardBack');
}
