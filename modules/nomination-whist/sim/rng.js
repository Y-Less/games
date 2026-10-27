// A small seeded random number generator, so a run can be repeated exactly and resumed chunk by chunk.

/** mulberry32: a fast 32-bit generator. Returns () => number in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes several integers into one 32-bit seed (the base seed and a chunk number, say). */
export function mixSeed(...parts) {
  let h = 0x12345678;
  for (const part of parts) {
    h = Math.imul(h ^ (part + 0x9e3779b9 + (h << 6) + (h >>> 2)), 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}
