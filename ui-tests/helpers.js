// Shared plumbing for the browser UI tests (node:test + puppeteer-core).
//
// A test file calls createWorld() once (in `before`) and world.close() in `after`. A world is the real site started
// in this process on a spare port with a temporary data folder and fast computer players, plus one headless Chrome.
// Every simulated person is a User with a browser context of their own, so their cookies never mix.
//
// Chrome is found at CHROME_PATH, or in the usual Windows/macOS/Linux places. The built client (dist/) must exist: the
// helper runs `npm run build` once if it does not.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startSite } from '../server/index.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VIEWPORT = { width: 1280, height: 900 }; // desktop only: the owner does not care about phones
export const PASSWORD = 'correct-horse-9';
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The fast computer-player settings every module reads from the environment (see each module's server.js). */
const FAST_ENV = {
  HEARTS_BOT_DELAY: '0-5',
  HEARTS_TRICK_PAUSE: '0',
  CRIBBAGE_BOT_DELAY: '0-5',
  NOMINATION_WHIST_BOT_DELAY: '0-5',
  NOMINATION_WHIST_TRICK_PAUSE: '0',
  SPLENDOUR_BOT_DELAY: '0-5',
  GAUDI_BOT_DELAY: '0-5',
  AZULEJO_BOT_DELAY: '0-5',
};

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error(`Chrome was not found. Set CHROME_PATH to chrome.exe (looked in: ${candidates.join(', ')}).`);
  return found;
}

let built = false;
function ensureBuilt() {
  if (built) return;
  const index = path.join(root, 'dist', 'index.html');
  if (!fs.existsSync(index)) {
    console.log('dist/index.html is missing, so running `npm run build` first...');
    const result = spawnSync('npm run build', { cwd: root, shell: true, stdio: 'inherit' });
    if (result.status !== 0 || !fs.existsSync(index)) throw new Error('The client is not built: run `npm run build` first (it failed just now).');
  }
  built = true;
}

/** A simulated person: one browser context (own cookies) with one page. */
export class User {
  constructor(world, label, context, page) {
    this.world = world;
    this.label = label;
    this.context = context;
    this.page = page;
    this.username = null;
    this.password = PASSWORD;
    this.displayName = null;
  }

  async goto(pathAndQuery) {
    await this.page.goto(this.world.base + pathAndQuery, { waitUntil: 'domcontentloaded' });
  }

  get url() {
    return new URL(this.page.url());
  }

  async text() {
    return this.page.evaluate(() => document.body.innerText);
  }

  /** Waits until the visible page text contains `text` (a string, or a RegExp tested against the text). */
  async waitForText(text, { timeout = 20000 } = {}) {
    const isRegExp = text instanceof RegExp;
    try {
      await this.page.waitForFunction(
        (source, flags, plain) => {
          const body = document.body.innerText;
          return plain === null ? new RegExp(source, flags).test(body) : body.includes(plain);
        },
        { timeout, polling: 50 },
        isRegExp ? text.source : '',
        isRegExp ? text.flags : '',
        isRegExp ? null : text,
      );
    } catch (error) {
      throw new Error(`${this.label}: timed out waiting for the text ${text}. The page says:\n${(await this.text()).slice(0, 1200)}\n(${error.message})`);
    }
  }

  async waitForNoText(text, { timeout = 20000 } = {}) {
    try {
      await this.page.waitForFunction((plain) => !document.body.innerText.includes(plain), { timeout, polling: 50 }, text);
    } catch (error) {
      throw new Error(`${this.label}: the text "${text}" never went away (${error.message})`);
    }
  }

  async waitForSelector(selector, { timeout = 20000, hidden = false } = {}) {
    try {
      return await this.page.waitForSelector(selector, { timeout, hidden });
    } catch (error) {
      throw new Error(`${this.label}: timed out waiting for ${hidden ? 'the end of ' : ''}${selector}. The page says:\n${(await this.text()).slice(0, 800)}`);
    }
  }

  /**
   * Clicks the first visible, enabled button or link whose text contains `text` (or equals it with { exact: true }),
   * waiting for one to appear. `scope` limits the search to the first element matching that selector.
   */
  async clickButton(text, { exact = false, scope = 'body', timeout = 20000 } = {}) {
    let handle;
    try {
      handle = await this.page.waitForFunction(
        (wanted, whole, scopeSelector) => {
          const root = document.querySelector(scopeSelector);
          if (!root) return null;
          const norm = (s) => s.replace(/\s+/g, ' ').trim();
          const visible = (el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };
          return (
            [...root.querySelectorAll('button, a[href]')].find((el) => {
              if (el.disabled || !visible(el)) return false;
              const label = norm(el.innerText || '');
              const aria = el.getAttribute('aria-label') ?? '';
              return whole ? label === wanted || aria === wanted : label.includes(wanted) || aria.includes(wanted);
            }) ?? null
          );
        },
        { timeout, polling: 50 },
        text,
        exact,
        scope,
      );
    } catch (error) {
      throw new Error(`${this.label}: no enabled button "${text}" appeared in ${scope}. The page says:\n${(await this.text()).slice(0, 1000)}\n(${error.message})`);
    }
    await handle.asElement().click();
    await handle.dispose();
  }

  /** True if there is a visible button with exactly this text, and whether it is disabled. */
  async buttonState(text, { scope = 'body' } = {}) {
    return this.page.evaluate(
      (wanted, scopeSelector) => {
        const root = document.querySelector(scopeSelector);
        const norm = (s) => s.replace(/\s+/g, ' ').trim();
        const el = [...(root?.querySelectorAll('button') ?? [])].find((b) => norm(b.innerText) === wanted);
        return el ? { present: true, disabled: el.disabled } : { present: false, disabled: null };
      },
      text,
      scope,
    );
  }

  /** Replaces the contents of an input with `value`, typing it as a person would. */
  async fill(selector, value) {
    await this.waitForSelector(selector);
    await this.page.$eval(selector, (el) => {
      el.focus();
      el.select?.();
    });
    await this.page.keyboard.press('Backspace');
    await this.page.keyboard.type(value);
  }

  /** Finds an element in the page with `finder` (run in the page: return an Element or null) and clicks it. */
  async clickFound(finder, ...args) {
    const handle = await this.page.evaluateHandle(finder, ...args);
    const el = handle.asElement();
    if (!el) {
      await handle.dispose();
      return false;
    }
    try {
      await el.click();
    } catch {
      return false; // the page re-rendered under us: the caller just tries again
    } finally {
      await handle.dispose();
    }
    return true;
  }

  /**
   * Like clickFound, but for elements that overlap their neighbours (a fanned hand): scrolls the element into view and
   * clicks a point where it, rather than a neighbour, is on top.
   */
  async clickFoundOnTop(finder, ...args) {
    const spot = await this.page.evaluate(
      (source, ...a) => {
        const el = new Function(`return (${source})`)()(...a);
        if (!el) return null;
        el.scrollIntoView({ block: 'nearest' });
        const b = el.getBoundingClientRect();
        for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.15, 0.5], [0.85, 0.5], [0.5, 0.1]]) {
          const x = b.left + b.width * fx;
          const y = b.top + b.height * fy;
          if (el.contains(document.elementFromPoint(x, y))) return { x, y };
        }
        return null;
      },
      finder.toString(),
      ...args,
    );
    if (!spot) return false;
    await this.page.mouse.click(spot.x, spot.y);
    return true;
  }

  /** The text of the open GameModal pop-up ('' when none is open), and its title. */
  async modalTitle() {
    return this.page.evaluate(() => document.querySelector('.modal-backdrop [role="dialog"] h2')?.textContent?.trim() ?? '');
  }

  /** Closes an open GameModal with Esc and waits for it to go. */
  async closeModalWithEsc() {
    await this.page.keyboard.press('Escape');
    await this.waitForSelector('.modal-backdrop', { hidden: true, timeout: 5000 });
  }

  /** The inline CSS variables the site sets on <html>. */
  async vars() {
    return this.page.evaluate(() => ({
      siteBg: document.documentElement.style.getPropertyValue('--site-bg').trim(),
      cardBack: document.documentElement.style.getPropertyValue('--card-back').trim(),
    }));
  }

  /** Calls the site's API from inside the page (so with this user's cookie). */
  async api(method, url, body) {
    return this.page.evaluate(
      async (m, u, b) => {
        const res = await fetch(u, { method: m, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      },
      method,
      url,
      body ?? null,
    );
  }

  /** Fills in the New account form and submits it. Leaves the page wherever the site sends the new user. */
  async register(username, { displayName = '', password = PASSWORD, expectUrl = true } = {}) {
    await this.waitForSelector('#username');
    await this.clickButton('New account', { exact: true });
    await this.fill('#username', username);
    if (displayName) await this.fill('#display', displayName);
    await this.fill('#password', password);
    await this.clickButton('Create account', { exact: true });
    this.username = username;
    this.password = password;
    this.displayName = displayName || username;
    if (expectUrl) await this.waitForSelector('.account button');
  }

  async login(username, password = PASSWORD) {
    await this.waitForSelector('#username');
    await this.fill('#username', username);
    await this.fill('#password', password);
    await this.page.click('form.panel > button.primary');
  }

  /** A new user who registers through the UI with a unique name and ends up on the menu. */
  async signUp(prefix, options = {}) {
    await this.goto('/login');
    await this.register(this.world.uniqueName(prefix), options);
    await this.waitForText('Choose a game.');
    return this;
  }

  /** The invite code shown in a lobby or game header. */
  async inviteCode() {
    await this.waitForSelector('.invite .code');
    return this.page.$eval('.invite .code', (el) => el.textContent.trim());
  }

  /** Clicks the invite-code pill and returns what ended up on the clipboard (the invite link). */
  async copyInvite() {
    await this.waitForSelector('.invite');
    await this.page.click('.invite');
    await this.waitForText('Link copied');
    return this.page.evaluate(() => navigator.clipboard.readText());
  }

  /** The room code in the address bar (games keep it there as ?<code>). */
  async waitForCodeInUrl(code) {
    await this.page.waitForFunction((c) => window.location.search === `?${c}`, { timeout: 15000 }, code);
  }

  async screenshot(file) {
    try {
      await this.page.screenshot({ path: file });
    } catch {
      /* the page may be gone */
    }
  }
}

/** Starts the site and Chrome. `env` adds or overrides environment variables read by the modules. */
export async function createWorld({ suite = 'ui', env = {} } = {}) {
  ensureBuilt();
  Object.assign(process.env, FAST_ENV, env);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-hub-ui-'));
  const logs = [];
  const site = await startSite({ port: 0, dataDir, log: (line) => logs.push(line) });
  const base = `http://127.0.0.1:${site.port}`;
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, defaultViewport: VIEWPORT, args: ['--no-first-run', '--disable-extensions'] });
  const failuresDir = path.join(os.tmpdir(), 'game-hub-ui-failures', suite);
  fs.rmSync(failuresDir, { recursive: true, force: true });

  const users = [];
  const pageErrors = [];
  let counter = 0;
  const world = {
    site,
    base,
    dataDir,
    users,
    pageErrors,
    uniqueName(prefix) {
      counter += 1;
      return `${prefix}${counter}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20);
    },
    /** A new person with an isolated browser context (own cookies). */
    async newUser(label = `user${users.length + 1}`) {
      const context = await browser.createBrowserContext();
      await context.overridePermissions(base, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
      const page = await context.newPage();
      await page.setViewport(VIEWPORT);
      page.setDefaultTimeout(20000);
      page.on('dialog', (dialog) => dialog.accept().catch(() => {})); // window.confirm / prompt: always say yes
      page.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`));
      const user = new User(world, label, context, page);
      users.push(user);
      return user;
    },
    /** Wraps a test body: on failure, screenshots every page into a temp folder (and says where), then rethrows. */
    guard(name, body) {
      return async (t) => {
        try {
          return await body(t);
        } catch (error) {
          fs.mkdirSync(failuresDir, { recursive: true });
          const safe = name.replace(/[^a-z0-9]+/gi, '-').slice(0, 50);
          await Promise.all(users.map((u) => u.screenshot(path.join(failuresDir, `${safe}-${u.label}.png`))));
          error.message += `\n[screenshots of this failure: ${failuresDir}]`;
          throw error;
        }
      };
    },
    async close() {
      for (const user of users) await user.context.close().catch(() => {});
      await browser.close().catch(() => {});
      await site.close().catch(() => {});
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return world;
}

/**
 * Plays a game as a human: repeats `act()` (which clicks something and returns true, or returns false when there is
 * nothing to do yet) until `finished()` is true. Throws after `timeout` ms.
 */
export async function drive({ act, finished, timeout = 90000, what = 'the game' }) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await finished()) return;
    if (!(await act())) await sleep(25);
  }
  throw new Error(`timed out playing ${what}`);
}

/** After a pop-up is closed: scroll the page and check that the score bar is still just under the site header. */
export async function checkScoreBarSticks(user) {
  const result = await user.page.evaluate(async () => {
    const bar = document.querySelector('.score-bar');
    if (!bar) return { found: false };
    if (document.documentElement.scrollHeight < window.innerHeight + 600) {
      // Not enough content to scroll: add some below the game, inside the bar's own container, as longer content would.
      const spacer = document.createElement('div');
      spacer.id = 'ui-test-spacer';
      spacer.style.height = '2500px';
      bar.parentElement.appendChild(spacer);
    }
    window.scrollTo(0, 500);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const header = document.querySelector('header.bar').getBoundingClientRect();
    const rect = bar.getBoundingClientRect();
    const result = { found: true, scrolled: window.scrollY, headerBottom: header.bottom, top: rect.top, bottom: rect.bottom, height: rect.height, viewport: window.innerHeight };
    document.getElementById('ui-test-spacer')?.remove();
    window.scrollTo(0, 0);
    return result;
  });
  return result;
}

/** The tiny valid PNG used for upload tests: a solid-colour image of the given size. */
export function makePng({ width = 4, height = 4, rgb = [200, 40, 90] } = {}) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** Writes a tiny PNG into a fresh temp folder and returns its path (the caller deletes the folder with `cleanup`). */
export function writePng(name = 'tiny.png', options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-hub-ui-png-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, makePng(options));
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
