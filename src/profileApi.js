// Changing your own profile: settings, pictures, and password.  The server's reply (the new user) becomes the session's user.
// Depends on: api.js (requests) and session.js (setUser).
import { api, uploadImage } from './api.js';
import { setUser } from './session.js';

/**
 * Saves some profile settings.
 * @param {object} changes  the settings to change (see PATCH /api/me)
 * @returns {Promise<void>}
 * @throws {Error} with the server's reason when refused
 * Side effects: sets the session's user and the page's look.
 */
export async function updateProfile(changes) {
  const { user } = await api('PATCH', '/api/me', changes);
  setUser(user);
}

/**
 * Uploads a picture as your background.
 * @param {File} file
 * @returns {Promise<void>}
 * @throws {Error} with the server's reason when refused
 * Side effects: sets the session's user and the page's look.
 */
export async function uploadBackground(file) {
  setUser((await uploadImage('/api/me/background-image', file)).user);
}

/**
 * Uploads a picture as your card back.
 * @param {File} file
 * @returns {Promise<void>}
 * @throws {Error} with the server's reason when refused
 * Side effects: sets the session's user and the page's look.
 */
export async function uploadCardBack(file) {
  setUser((await uploadImage('/api/me/card-back-image', file)).user);
}

/**
 * Changes your password.
 * @param {string} currentPassword
 * @param {string} newPassword
 * @returns {Promise<*>}
 * @throws {Error} with the server's reason when refused
 * Side effects: one request; the server signs out your other devices.
 */
// (Arrow helper) Returns the promise of the password-change request.
export const changePassword = (currentPassword, newPassword) => api('POST', '/api/me/password', { currentPassword, newPassword });
