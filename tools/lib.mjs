// Shared helpers for the headless capture and check tools.
// DEMO_URL selects the dev server, CHROME_PATH the Chrome binary.
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';

export const BASE = process.env.DEMO_URL || 'http://127.0.0.1:5180';
export const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Headless Chrome only gets WebGL2 through SwiftShader.
export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'];

export const launch = () => puppeteer.launch({ executablePath: CHROME, headless: true, args: GL_ARGS });

/** New page that records page errors and console errors into `errors`. */
export async function newPage(browser, { width = 1440, height = 900, scale = 1 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/GPU stall|GL Driver|favicon/.test(m.text())) errors.push(`[console] ${m.text()}`); });
  return { page, errors };
}

export const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Open `path` (relative to BASE, e.g. "pass3.html?hour=12") and wait for the app to finish building. */
export async function open(page, path) {
  await page.goto(`${BASE}/${path}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.appReady === true, { timeout: 180000 });
  await settle(page);
}

export const canvasPng = (page, id) => page.$eval(`#${id}`, (c) => c.toDataURL('image/png'));

export async function writePng(path, dataUrl) {
  await mkdir(path.slice(0, path.lastIndexOf('/')) || '.', { recursive: true });
  await writeFile(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

/** Count differing pixels between two PNG data URLs (decoded in the page). */
export const pixelDiff = (page, a, b) => page.evaluate(async (a, b) => {
  const load = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i; };
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: true, a: [ia.width, ia.height], b: [ib.width, ib.height] };
  const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(ia, 0, 0); const da = ctx.getImageData(0, 0, c.width, c.height).data;
  ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(ib, 0, 0); const db = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) n++;
  return { pixels: n, total: da.length / 4 };
}, a, b);
