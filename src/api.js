// Talking to the site's JSON API.

/**
 * Calls the API and returns the parsed body.
 * @param {string} method  'GET', 'POST', 'PATCH' ...
 * @param {string} url  e.g. '/api/me'
 * @param {*} [body]  sent as JSON when given
 * @returns {Promise<*>}  the parsed JSON reply (or the text, when it is not JSON)
 * @throws {Error} with the server's message on failure
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
  if (!res.ok) throw new Error(data?.error ?? `Something went wrong (${res.status}).`);
  return data;
}

/**
 * Uploads a picture (sent as it is, not as JSON).
 * @param {string} url  e.g. '/api/me/background-image'
 * @param {File} file  the picture
 * @returns {Promise<{ user: object }>}  the server's reply
 * @throws {Error} with the server's message (or 'Could not upload that image.') on failure
 * Side effects: one fetch.
 */
export async function uploadImage(url, file) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': file.type }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Could not upload that image.');
  return data;
}
