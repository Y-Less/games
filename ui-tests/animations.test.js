// Animations: the player's own choice (Profile > Animations), not the device's setting alone, decides whether anything on
// the site moves.  Only a real browser can answer this, because the whole rule lives in CSS (see src/style.css), so this
// looks at the three kinds of motion the site has: a bought background animation (the Moving gradient), a bought name
// animation, and the interface's own transitions.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';

let world;
let user;
before(async () => {
  world = await createWorld({ suite: 'animations' });
  user = await world.newUser('motion');
  await user.signUp('motion');
  // The Moving gradient slides the player's own gradient, so the background has to be one; the name pill wears the glow.
  await user.api('PATCH', '/api/me', {
    background: { type: 'gradient', from: '#16252d', to: '#7a3e55', angle: 160 },
    backgroundAnimation: 'gradient',
    nameStyle: { style: 'plain', animation: 'glow' },
  });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);

/**
 * Loads the menu with this device setting and this profile choice, and says what is moving on it.
 * @param {object} options  { device: 'reduce'|'no-preference', choice: true|false|null }
 * @returns {Promise<{background: string, name: string, interfaceMoves: boolean}>}  the two animation names ('none' when
 *   stopped) and whether the site's own buttons still have a transition
 */
async function motion({ device, choice }) {
  await user.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: device }]);
  await user.api('PATCH', '/api/me', { playAnimations: choice });
  await user.goto('/');
  await user.waitForSelector('.bg-fx');
  await user.waitForSelector('.account button.name-pill[data-animation="glow"]');
  return user.page.evaluate(() => {
    // A button of this test's own, so the interface's motion is read from the site's button rule rather than from
    // whichever buttons the menu happens to be showing today.
    const probe = document.body.appendChild(document.createElement('button'));
    const interfaceMoves = getComputedStyle(probe)
      .transitionDuration.split(',')
      .some((length) => Number.parseFloat(length) > 0);
    probe.remove();
    // A built BackgroundFx has its keyframes renamed (fx-gradient-8010a92b): the scoped styles are hashed, so the hash
    // comes off again here and the test reads the same in `npm run dev` and in a build.
    const unhashed = (name) => name.replace(/-[0-9a-f]{8}$/, '');
    return {
      background: unhashed(getComputedStyle(document.querySelector('.bg-fx'), '::before').animationName),
      name: getComputedStyle(document.querySelector('.account button.name-pill')).animationName,
      interfaceMoves,
    };
  });
}

test('everything moves when the player has not chosen and the device is happy with motion', { timeout: 60000 }, guarded('auto, no preference', async () => {
  assert.deepEqual(await motion({ device: 'no-preference', choice: null }), { background: 'fx-gradient', name: 'ns-glow', interfaceMoves: true });
}));

test('the device decides for a player who has not chosen', { timeout: 60000 }, guarded('auto, reduce', async () => {
  assert.deepEqual(await motion({ device: 'reduce', choice: null }), { background: 'none', name: 'none', interfaceMoves: false });
}));

test('"always" plays every animation, whatever the device asks for', { timeout: 60000 }, guarded('on, reduce', async () => {
  assert.deepEqual(await motion({ device: 'reduce', choice: true }), { background: 'fx-gradient', name: 'ns-glow', interfaceMoves: true });
}));

test('"never" stops every animation, whatever the device asks for', { timeout: 60000 }, guarded('off, no preference', async () => {
  assert.deepEqual(await motion({ device: 'no-preference', choice: false }), { background: 'none', name: 'none', interfaceMoves: false });
}));
