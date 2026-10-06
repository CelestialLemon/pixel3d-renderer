/// <reference path="../src/baked-env.d.ts" />
// Warm asset/cache medians, one browser and renderer at a time. --baked includes compressed asset load and decompression.
import { mkdir, writeFile } from 'node:fs/promises';
import { launch, newPage, open } from './lib.ts';

const baked = process.argv.includes('--baked'), browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const reports = await page.evaluate(async (baked) => {
    const { SCENES } = await import('/src/scenes/index.ts');
    const api = await import('/src/renderer/index.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const manifest = baked ? await (await fetch('/baked/manifest.json')).json() : undefined;
    const reports = [];
    for (const id of ['cookie-co', 'village']) {
      const def = SCENES.find((s) => s.id === id)!;
      const runs: { loadMs: number; constructorMs: number; firstDrawMs: number; totalMs: number; triangles: number; occluders: number }[] = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        const s = baked ? api.decodeScene(await new Response((await fetch(manifest.scenes[id].url)).body!
          .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : await def.build();
        const loaded = performance.now();
        const r = new api.PixelRenderer(document.createElement('canvas'), s, { limits: def.limits });
        const constructed = performance.now();
        try {
          r.resize(160, 120); r.placeCamera(new THREE.Vector3(), 0.66, 0.7, 18); r.setLook(api.lookAt(22));
          r.renderGeometry(8); r.renderStyle(api.DEFAULT_SETTINGS, 8); r.renderer.getContext().finish();
          const drawn = performance.now();
          runs.push({ loadMs: loaded - start, constructorMs: constructed - loaded, firstDrawMs: drawn - constructed,
            totalMs: drawn - start, triangles: s.stats.triangles, occluders: r['lampShadows'].occluderTriangles ?? s.stats.triangles });
        } finally {
          r.dispose();
          if (s.maps) for (const t of [s.maps.fluids.texture, s.maps.fluids.height, s.maps.windows.texture, s.maps.windows.source]) t.dispose();
        }
      }
      const median = (key: 'loadMs' | 'constructorMs' | 'firstDrawMs' | 'totalMs') => Math.round(runs.map((r) => r[key]).sort((a, b) => a - b)[1]);
      reports.push({ scene: id, mode: baked ? 'baked' : 'live', loadMs: median('loadMs'), constructorMs: median('constructorMs'),
        firstDrawMs: median('firstDrawMs'), totalMs: median('totalMs'), runs });
    }
    return reports;
  }, baked);
  if (errors.length) throw new Error(errors.join('\n'));
  await mkdir('out/startup-bench', { recursive: true });
  await writeFile(`out/startup-bench/${baked ? 'baked' : 'live'}.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); }
