// Shared helpers for the headless capture and check tools.
// DEMO_URL selects the dev server, CHROME_PATH the Chrome binary, GL_BACKEND how it renders WebGL.
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { Browser as BrowserName, computeExecutablePath } from '@puppeteer/browsers';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const BASE = process.env.DEMO_URL || 'http://127.0.0.1:5180';

// The Chromium build `npm run browser:install` puts in .browsers/. Pinned, because golden images depend on the browser version.
export const CHROMIUM = { browser: BrowserName.CHROMIUM, buildId: '1710741', cacheDir: fileURLToPath(new URL('../.browsers', import.meta.url)) };
const PINNED = computeExecutablePath(CHROMIUM);
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const CHROME = process.env.CHROME_PATH || (existsSync(PINNED) || process.platform !== 'darwin' ? PINNED : MAC_CHROME);

// ANGLE backends. SwiftShader renders on the CPU, the same everywhere but slow; `gl` and `vulkan` use the real GPU (Linux).
const BACKENDS: Record<string, string[]> = {
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  gl: ['--use-gl=angle', '--use-angle=gl', '--enable-gpu'],
  vulkan: ['--use-angle=vulkan', '--enable-features=Vulkan', '--enable-gpu'],
};
export const GL_BACKEND = process.env.GL_BACKEND || (process.platform === 'linux' ? 'vulkan' : 'swiftshader');
if (!BACKENDS[GL_BACKEND]) throw new Error(`GL_BACKEND must be one of ${Object.keys(BACKENDS).join(', ')}`);
export const GL_ARGS = [...BACKENDS[GL_BACKEND], '--ignore-gpu-blocklist', '--mute-audio'];

/** The WebGL renderer string the page actually got, e.g. "ANGLE (AMD, Vulkan 1.4.328 (AMD Radeon RX 570 Series (...)), radv)". */
export const glRenderer = (page: Page) => page.evaluate((): string => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'none';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
});

/**
 * Name of the golden-image set for this machine: platform, CPU architecture, backend, the GPU model on a GPU, and "chrome"
 * for any browser other than the pinned Chromium, e.g. "linux-x64-vulkan-amd-radeon-rx-570" or "darwin-arm64-swiftshader-chrome".
 * Output is only pixel-identical within one set. `launch()` has already checked that the renderer matches GL_BACKEND.
 */
export function goldenSet(renderer: string) {
  const parts = [process.platform, process.arch, GL_BACKEND];
  if (GL_BACKEND !== 'swiftshader') parts.push(gpuName(renderer));
  if (!isPinned(CHROME)) parts.push('chrome');
  return parts.join('-');
}

// The GPU model without vendor marks, driver details or backend: "ANGLE (AMD, AMD Radeon RX 570 Series (radeonsi polaris10
// ACO), OpenGL ES 3.2)" and "ANGLE (AMD, Vulkan 1.4.328 (AMD Radeon RX 570 Series (RADV POLARIS10) (0x000067DF)), radv)" both give
// "amd-radeon-rx-570"; "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL ES 3.2)" gives "intel-uhd-620".
// Some drivers put the Vulkan version in a field of its own: "ANGLE (AMD, Vulkan 1.4.318, AMD Radeon Graphics RADV GFX1151)".
function gpuName(renderer: string) {
  const fields = topLevelFields(renderer.replace(/^ANGLE \((.*)\)$/, '$1'));
  let device = fields.slice(1).find((f) => !/^(Vulkan|OpenGL( ES)?) [\d.]+$/.test(f)) ?? renderer;
  const vulkan = device.match(/^Vulkan [\d.]+ \((.*)\)$/);
  if (vulkan) device = vulkan[1];
  device = device.replace(/\((R|TM)\)/gi, '').replace(/[(/].*$/, '').replace(/^(Mesa |ANGLE Metal Renderer: )/, '')
    .replace(/\b(Series|Graphics)\b/gi, '');
  return device.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown-gpu';
}

// Splits "a, b (c, d), e" at the commas outside parentheses.
function topLevelFields(text: string) {
  const fields: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) { fields.push(text.slice(start, i).trim()); start = i + 1; }
  }
  fields.push(text.slice(start).trim());
  return fields;
}

// `pipe` talks to Chrome over a pipe instead of a port, so Chrome exits as soon as this process dies, even when it is
// killed outright; with a port, a killed run leaves a headless Chrome animating its page at full CPU.
// Fails when the browser has no WebGL2 or doesn't render with GL_BACKEND: a GPU backend can fall back to SwiftShader or to
// Mesa's CPU drivers (llvmpipe, lavapipe), and Chrome can ignore the requested ANGLE backend.
export async function launch() {
  if (!existsSync(CHROME)) {
    throw new Error(`no browser at ${CHROME}: run \`npm run browser:install\`${process.env.CHROME_PATH ? ' or fix CHROME_PATH' : ''}`);
  }
  // Hosted CI may disallow the user namespaces Chromium's sandbox needs. Pages here are repository test fixtures.
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: [...GL_ARGS, ...(process.env.CI ? ['--no-sandbox'] : [])], pipe: true });
  try {
    const page = await browser.newPage();
    const renderer = await glRenderer(page);
    await page.close();
    if (renderer === 'none') throw new Error(`GL_BACKEND=${GL_BACKEND}: the browser has no WebGL2`);
    if (!rendersWith(renderer, GL_BACKEND)) {
      throw new Error(`GL_BACKEND=${GL_BACKEND} but the browser renders with "${renderer}". Use GL_BACKEND=swiftshader if this machine has no usable GPU.`);
    }
  } catch (e) { await browser.close(); throw e; }
  return browser;
}

// The pinned Chromium, also when reached through a symlink or another spelling of its path.
const isPinned = (path: string) => existsSync(path) && existsSync(PINNED) && realpathSync(path) === realpathSync(PINNED);

function rendersWith(renderer: string, backend: string) {
  if (backend === 'swiftshader') return /SwiftShader/i.test(renderer);
  if (/SwiftShader|llvmpipe|lavapipe|softpipe/i.test(renderer)) return false;
  return /Vulkan/i.test(renderer) === (backend === 'vulkan');
}

/** New page that records page errors and console errors into `errors`. */
export async function newPage(browser: Browser, { width = 1440, height = 900, scale = 1 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${(e as Error).message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/GPU stall|GL Driver|favicon/.test(m.text())) errors.push(`[console] ${m.text()}`); });
  return { page, errors };
}

export const settle = (page: Page) => page.evaluate(() => new Promise<number>((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Open `path` (relative to BASE, e.g. "pass3.html?hour=12") and wait for the app to finish building. */
export async function open(page: Page, path: string) {
  await page.goto(`${BASE}/${path}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.appReady === true, { timeout: 180000 });
  await settle(page);
}

export const canvasPng = (page: Page, id: string) => page.$eval(`#${id}`, (c) => (c as HTMLCanvasElement).toDataURL('image/png'));

export async function writePng(path: string, dataUrl: string) {
  await mkdir(path.slice(0, path.lastIndexOf('/')) || '.', { recursive: true });
  await writeFile(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

/** Count differing pixels between two PNG data URLs (decoded in the page). */
export const pixelDiff = (page: Page, a: string, b: string) => page.evaluate(async (a, b) => {
  const load = async (src: string) => { const i = new Image(); i.src = src; await i.decode(); return i; };
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: true as const, a: [ia.width, ia.height], b: [ib.width, ib.height] };
  const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(ia, 0, 0); const da = ctx.getImageData(0, 0, c.width, c.height).data;
  ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(ib, 0, 0); const db = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) n++;
  return { pixels: n, total: da.length / 4 };
}, a, b);
