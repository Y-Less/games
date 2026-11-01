// Talking to the site's JSON API: every page and composable goes through these two functions.
// Depends on: the browser's fetch and messageText.js (a refusal's code becomes words in the player's language).
// session.js registers what to do when the server says the session has gone (onUnauthorised), so that this file does
// not have to import it.
import { errorText, messageText } from './messageText.js';

let unauthorised = () => {};

/**
 * Registers what to do when any API call is refused as not signed in (HTTP 401): the session has expired, or the
 * password was changed on another device. session.js uses it to sign the user out locally, so every page reacts the
 * same way instead of showing the raw error text.
 * @param {() => void} handler
 * @returns {void}
 * Side effects: replaces the handler.
 */
export function onUnauthorised(handler) {
  unauthorised = handler;
}

/**
 * The error a failed request throws: the server's code in words (an unknown reply gets the generic text with the status).
 * @param {{ error?: string, params?: object } | string | null} data  the reply's body
 * @param {number} status  the HTTP status
 * @returns {Error} with `code` (the server's error code, or '') for callers that act on a particular refusal
 * Side effects: none.
 */
function refusal(data, status) {
  const reply = data && typeof data === 'object' ? data : null;
  const error = new Error(reply?.error ? errorText(reply) : messageText({ key: 'errors.somethingWrong', params: { status } }));
  error.code = reply?.error ?? '';
  return error;
}

/**
 * Calls the API and returns the parsed body.
 * @param {string} method  'GET', 'POST', 'PATCH' ...
 * @param {string} url  e.g. '/api/me'
 * @param {*} [body]  sent as JSON when given
 * @returns {Promise<*>}  the parsed JSON reply (or the text, when it is not JSON)
 * @throws {Error} with the server's refusal in words (its `code` is the server's error code) on failure
 * Side effects: one fetch.
 */
export async function api(method, url, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (res.status === 401) unauthorised();
  if (!res.ok) throw refusal(data, res.status);
  return data;
}

/**
 * Uploads a picture (sent as it is, not as JSON).
 * @param {string} url  e.g. '/api/me/background-image'
 * @param {File} file  the picture
 * @returns {Promise<{ user: object }>}  the server's reply
 * @throws {Error} with the server's refusal in words (or the generic upload failure) on failure
 * Side effects: one fetch.
 */
export async function uploadImage(url, file) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': file.type }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw refusal(data.error ? data : { error: 'uploadFailed' }, res.status);
  return data;
}
