// Reading numbers out of what a client sent. `Number(value)` throws for an object that cannot become a primitive (one
// with no prototype, say), and a socket handler or an HTTP route that throws on a hostile payload is a crash where a
// refusal was due; this never throws.
// Depends on: nothing.

/**
 * The number a client payload field holds: a number as it is, a numeric string parsed, anything else NaN.
 * @param {unknown} value  the field as sent
 * @returns {number} a number, or NaN (which every range check then refuses)
 * Side effects: none.
 */
export const numberFrom = (value) => (typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN);

/**
 * The text a client payload field holds: a string as it is, a number written out, anything else '' (so a range or
 * emptiness check then refuses it, where `String(value)` would have thrown or given "[object Object]").
 * @param {unknown} value  the field as sent
 * @returns {string}
 * Side effects: none.
 */
export const textFrom = (value) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
