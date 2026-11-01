// The built client: its files, and index.html for every address the client router handles itself.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Serves the built client from `distDir`.
 * @param {import('express').Express} app
 * @param {{ distDir: string }} deps
 * @returns {void}
 * Side effects: adds middleware and a catch-all GET route (so register it after every other route).
 */
export function registerStaticRoutes(app, { distDir }) {
  app.use(express.static(distDir));
  app.get('/{*splat}', (req, res, next) => {
    // Missing files under these folders are genuine 404s, not pages for the client router.
    if (/^\/(uploads|assets|socket\.io)\//.test(req.path)) return next();
    const index = path.join(distDir, 'index.html');
    if (fs.existsSync(index)) res.sendFile(index);
    else next();
  });
}
