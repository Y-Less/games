// The profile page: name, backgrounds, card backs and password, all through the UI.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld, PASSWORD, writePng } from './helpers.js';

let world;
let user;
let config;
before(async () => {
  world = await createWorld({ suite: 'profile' });
  user = await world.newUser('profile');
  await user.signUp('prof', { displayName: 'Old Name' });
  config = await user.api('GET', '/api/config');
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const openProfile = async () => {
  await user.goto('/profile');
  await user.waitForText('Card back');
};
/** Sets an <input type=color> or range the way the browser would (puppeteer cannot type into those). */
const setInput = (selector, value) =>
  user.page.$eval(
    selector,
    (el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    value,
  );
const headerName = () => user.page.$eval('.account button', (e) => e.textContent.trim());

test('the display name can be changed and the header follows', { timeout: 60000 }, guarded('name', async () => {
  await openProfile();
  assert.equal(await headerName(), 'Old Name ▾');
  await user.fill('input[aria-label="Display name"]', 'New Name');
  await user.clickButton('Save', { exact: true });
  await user.waitForText('Name saved.');
  assert.equal(await headerName(), 'New Name ▾');
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForText('New Name ▾');
}));

test('a preset background changes --site-bg and survives a reload', { timeout: 60000 }, guarded('preset background', async () => {
  await openProfile();
  const keys = Object.keys(config.backgrounds);
  assert.ok(keys.length >= 3);
  const before = (await user.vars()).siteBg;
  const key = keys.find((k) => config.backgrounds[k] !== before) ?? keys[1];
  await user.page.click(`button[aria-label="${key} background"]`);
  await user.waitForText('Background saved.');
  assert.equal((await user.vars()).siteBg, config.backgrounds[key]);
  assert.equal(await user.page.$eval(`button[aria-label="${key} background"]`, (e) => e.getAttribute('aria-pressed')), 'true');
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForText('Card back');
  assert.equal((await user.vars()).siteBg, config.backgrounds[key], 'still there after a reload');
  assert.notEqual(before, config.backgrounds[key]);
}));

test('a colour and a gradient can be chosen as the background', { timeout: 60000 }, guarded('colour and gradient', async () => {
  await openProfile();
  await setInput('input[aria-label="Background colour"]', '#aa3355');
  await user.clickButton('Use this colour', { exact: true });
  await user.waitForText('Background saved.');
  assert.equal((await user.vars()).siteBg, 'linear-gradient(#aa3355, #aa3355)');
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForText('Card back');
  assert.equal((await user.vars()).siteBg, 'linear-gradient(#aa3355, #aa3355)');
  assert.equal(await user.page.$eval('input[aria-label="Background colour"]', (e) => e.value), '#aa3355', 'the picker remembers the saved colour');

  await setInput('input[aria-label="Gradient start"]', '#112233');
  await setInput('input[aria-label="Gradient end"]', '#445566');
  await setInput('input[type="range"]', '90');
  await user.clickButton('Use this gradient', { exact: true });
  await user.waitForText('Background saved.');
  assert.equal((await user.vars()).siteBg, 'linear-gradient(90deg, #112233, #445566)');
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForText('Card back');
  assert.equal((await user.vars()).siteBg, 'linear-gradient(90deg, #112233, #445566)');
}));

test('a small PNG can be uploaded as the background and as the card back', { timeout: 60000 }, guarded('uploads', async () => {
  const png = writePng('picture.png');
  const bad = writePng('fake.png');
  try {
    await openProfile();
    const background = await user.waitForSelector('input[aria-label="Upload a background picture"]');
    await background.uploadFile(png.file);
    await user.waitForText('Background saved.');
    const bg = (await user.vars()).siteBg;
    const file = /url\(\/uploads\/(bg-[^)]+\.png)\)/.exec(bg)?.[1];
    assert.ok(file, `--site-bg points at an uploaded background (${bg})`);

    const cardBack = await user.waitForSelector('input[aria-label="Upload a card back picture"]');
    await cardBack.uploadFile(png.file);
    await user.waitForText('Card back saved.');
    const cb = (await user.vars()).cardBack;
    const cbFile = /url\(\/uploads\/(cb-[^)]+\.png)\)/.exec(cb)?.[1];
    assert.ok(cbFile, `--card-back points at an uploaded picture (${cb})`);

    // The files really are served.
    for (const name of [file, cbFile]) {
      const served = await user.page.evaluate(async (n) => {
        const res = await fetch(`/uploads/${n}`);
        return { status: res.status, type: res.headers.get('content-type'), size: (await res.arrayBuffer()).byteLength };
      }, name);
      assert.equal(served.status, 200);
      assert.equal(served.type, 'image/png');
      assert.ok(served.size > 20);
    }

    await user.page.reload({ waitUntil: 'domcontentloaded' });
    await user.waitForText('Card back');
    assert.equal((await user.vars()).siteBg, bg);
    assert.equal((await user.vars()).cardBack, cb);
    assert.ok(await user.page.$('.back.chosen[title="Your picture"]'), 'the picture is shown as the chosen card back');

    // A file that is not really a picture is refused with the server's message, and nothing changes.
    fs.writeFileSync(bad.file, 'this is not a png at all');
    await (await user.waitForSelector('input[aria-label="Upload a background picture"]')).uploadFile(bad.file);
    await user.waitForText('That file is not really an image of that type.');
    assert.equal((await user.vars()).siteBg, bg);
  } finally {
    png.cleanup();
    bad.cleanup();
  }
}));

test('a card-back preset changes --card-back', { timeout: 60000 }, guarded('card back preset', async () => {
  await openProfile();
  const keys = Object.keys(config.cardBacks);
  const key = keys[2];
  await user.page.click(`button[aria-label="${key} card back"]`);
  await user.waitForText('Card back saved.');
  assert.equal((await user.vars()).cardBack, config.cardBacks[key]);
  assert.equal(await user.page.$eval(`button[aria-label="${key} card back"]`, (e) => e.getAttribute('aria-pressed')), 'true');
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForText('Card back');
  assert.equal((await user.vars()).cardBack, config.cardBacks[key]);
  const other = keys[0];
  await user.page.click(`button[aria-label="${other} card back"]`);
  await user.waitForText('Card back saved.');
  assert.equal((await user.vars()).cardBack, config.cardBacks[other]);
}));

test('the password can be changed, and the new one works for signing in again', { timeout: 60000 }, guarded('password', async () => {
  await openProfile();
  const newPassword = 'a-brand-new-pw-1';
  const changeButton = () => user.buttonState('Change password');
  assert.equal((await changeButton()).disabled, true, 'disabled until both boxes are filled in');
  await user.fill('input[aria-label="Current password"]', 'wrong-current-pw');
  await user.fill('input[aria-label="New password"]', newPassword);
  await user.clickButton('Change password', { exact: true });
  await user.waitForText('Your current password is wrong.');

  await user.fill('input[aria-label="Current password"]', PASSWORD);
  await user.fill('input[aria-label="New password"]', 'short');
  assert.equal((await changeButton()).disabled, true, 'a short new password cannot be sent');
  await user.fill('input[aria-label="New password"]', newPassword);
  await user.clickButton('Change password', { exact: true });
  await user.waitForText('Password changed.');

  await user.clickButton('New Name ▾');
  await user.clickButton('Sign out', { exact: true });
  await user.waitForSelector('#username');
  await user.login(user.username, PASSWORD);
  await user.waitForText('Wrong username or password.');
  await user.login(user.username, newPassword);
  await user.waitForText('Choose a game.');
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
