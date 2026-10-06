/// <reference path="../src/baked-env.d.ts" />
// Bake default demo scenes once, using their actual browser asset pipeline, into compressed exact binary assets.
import { createServer } from 'vite';
import { mkdir, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { launch, newPage } from './lib.ts';
import { bakedScenes, bakeFingerprint, type BakeManifest } from './baked-plugin.ts';

const root = fileURLToPath(new URL('..', import.meta.url)), destination = resolve(root, 'public/baked');
await mkdir(destination, { recursive: true });
const fingerprint = await bakeFingerprint(root);
const server = await createServer({ root, configFile: false, plugins: [bakedScenes(), {
  name: 'scene-bake-upload',
  configureServer(server) { server.middlewares.use('/__bake-upload', async (req, res) => {
  const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id');
  if (req.method !== 'POST' || !id || !/^[a-z][a-z0-9-]*$/.test(id)) { res.statusCode = 400; res.end(); return; }
  const path = resolve(destination, `${id}-${fingerprint.slice(0, 12)}.p3dz`);
  try { await pipeline(req, createWriteStream(`${path}.tmp`)); await rename(`${path}.tmp`, path); res.end('ok'); }
  catch (error) { res.statusCode = 500; res.end(String(error)); }
  }); },
}], server: { host: '127.0.0.1', port: 0, hmr: false } });
let browser: Awaited<ReturnType<typeof launch>> | undefined;
try {
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('Bake server has no port');
  browser = await launch();
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  page.on('console', (message) => { if (message.type() === 'log') console.log(message.text()); });
  await page.goto(`http://127.0.0.1:${address.port}/tools/bake.html`);
  const scenes = await page.evaluate(async (fingerprint) => {
    const { SCENES } = await import('/src/scenes/index.ts');
    const { encodeScene } = await import('/src/renderer/baked.ts');
    const { DEFAULT_PALETTE_SIZE, resolveLimits } = await import('/src/renderer/index.ts');
    const entries: BakeManifest['scenes'] = {};
    for (const def of SCENES) {
      const t = performance.now(), scene = await def.build(), buffer = encodeScene(scene);
      const compressed = await new Response(new Blob([buffer]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      const response = await fetch(`/__bake-upload?id=${encodeURIComponent(def.id)}`, { method: 'POST', body: compressed });
      if (!response.ok) throw new Error(`Bake upload failed: ${await response.text()}`);
      entries[def.id] = { url: `/baked/${def.id}-${fingerprint.slice(0, 12)}.p3dz`,
        paletteSize: def.paletteSize ?? DEFAULT_PALETTE_SIZE, limits: { ...resolveLimits(def.limits) } };
      console.log(`baked ${def.id}: ${(compressed.byteLength / 1048576).toFixed(2)} MiB, ${(performance.now() - t).toFixed(0)} ms`);
      for (const g of [scene.staticGeometry, scene.dynamicGeometry, scene.fluids.geometry, ...Object.values(scene.objectGeometries ?? {})]) g.dispose();
    }
    return entries;
  }, fingerprint);
  if (errors.length) throw new Error(errors.join('\n'));
  if (await bakeFingerprint(root) !== fingerprint) throw new Error('Bake inputs changed during generation. Run npm run bake again.');
  const manifest: BakeManifest = { fingerprint, scenes };
  await writeFile(resolve(destination, 'manifest.json.tmp'), JSON.stringify(manifest, null, 2) + '\n');
  await rename(resolve(destination, 'manifest.json.tmp'), resolve(destination, 'manifest.json'));
  const current = new Set(Object.values(scenes).map((s) => s.url.split('/').at(-1)!));
  for (const name of await readdir(destination)) {
    if (/^[a-z][a-z0-9-]*-[a-f0-9]{12}\.p3d(?:z|\.gz)$/.test(name) && !current.has(name)) await rm(resolve(destination, name));
  }
  console.log(`Baked ${Object.keys(scenes).length} scenes into public/baked/ (${fingerprint.slice(0, 12)}).`);
} finally { await browser?.close(); await server.close(); }
