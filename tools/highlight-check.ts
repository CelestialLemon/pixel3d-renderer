// GPU hover-highlight regression: shared instances, view/zoom/day-night coverage, occlusion and style-only updates.
// Requires the dev server and browser used by the other renderer checks. Goldens are checked separately.
import assert from 'node:assert/strict';
import type { BakedScene as PixelScene } from '../src/renderer/index.ts';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 160, height: 120 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, FluidCollector, place, lookAt, DEFAULT_SETTINGS, MAX_HIGHLIGHTS } = await import('/src/renderer/index.ts');
    const W = 160, H = 120;
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const box = new THREE.BoxGeometry(1, 1, 1), local = new GeometryCollector();
    local.add(box, null, [0.8, 0.12, 0.07]);
    const geometry = local.build(), out: string[] = [];
    const scene = (wall: boolean | 'close' = false): PixelScene => {
      const s = new GeometryCollector();
      s.add(box, place(0, -0.1, 0, 0, 0, 0, 12, 0.2, 12), [0.4, 0.4, 0.4]);
      if (wall === 'close') s.add(box, place(0.25, 1, 0.29, 0, 0, 0, 0.5, 0.5, 0.02), [0.4, 0.4, 0.4]);
      else if (wall) s.add(box, place(0, 1, 1, 0, 0, 0, 4, 2, 0.2), [0.4, 0.4, 0.4]);
      return { staticGeometry: s.build(), dynamicGeometry: new GeometryCollector().build(), lamps: [], grooves: null,
        fluids: new FluidCollector().build(), shadow: { center: new THREE.Vector3(), radius: 8 }, stats: { triangles: 0, paletteColors: 0 } };
    };
    const make = (wall: boolean | 'close' = false, S: 1 | 3 = 3, warmHighlight?: boolean) => {
      const r = new PixelRenderer(document.createElement('canvas'), scene(wall), {
        supersample: S, shadowMapSize: 128, objectShadowMapSize: 128,
        ...(warmHighlight === undefined ? {} : { warmHighlight }),
      });
      r.renderer.info.autoReset = false;
      r.resize(W, H); r.setLook(lookAt(12));
      r.canvas.style.cssText = `position:fixed;left:7px;top:11px;width:${W}px;height:${H}px;image-rendering:pixelated`;
      document.body.append(r.canvas);
      return r;
    };
    const image = (r: InstanceType<typeof PixelRenderer>, cleanup = true) => {
      r.renderer.info.reset();
      r.renderStyle({ ...DEFAULT_SETTINGS, cleanup }, 8);
      const pixels = new Uint8Array(W * H * 4), gl = r.renderer.getContext();
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      check(gl.getError() === gl.NO_ERROR, 'No GL error after highlight draw');
      return pixels;
    };
    const ids = (r: InstanceType<typeof PixelRenderer>) => {
      const pixels = new Float32Array(W * H * 4);
      r.renderer.readRenderTargetPixels(r['gbuf'], 0, 0, W, H, pixels, undefined, 2);
      return pixels;
    };
    const changed = (a: Uint8Array, b: Uint8Array, p: number) => {
      const i = p * 4;
      return a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2];
    };
    const diff = (a: Uint8Array, b: Uint8Array) => {
      let n = 0; for (let p = 0; p < W * H; p++) if (changed(a, b, p)) n++; return n;
    };
    try {
      // Unused highlights compile nothing by default; opt-in warming must leave the displayed frame unchanged
      // and populate the actual draw-program cache, so the first hover cannot compile another variant.
      for (const warm of [undefined, false, true]) {
        const r = make(false, 1, warm), pending: Promise<unknown>[] = [];
        const compile = r.renderer.compileAsync.bind(r.renderer);
        r.renderer.compileAsync = (...args) => {
          const promise = compile(...args); pending.push(promise); return promise;
        };
        try {
          r.placeCamera(new THREE.Vector3(0, 1, 0), 0, 0, 6);
          r.renderGeometry(8); image(r);
          check(pending.length === 0, `warm=${warm}: no highlight warm-up without objects`);
          const programsBefore = r.renderer.info.programs!.length;
          const o = r.addObject(geometry); o.position.set(0, 1, 0); o.scale.setScalar(0.5);
          r.renderGeometry(8);
          const baseline = image(r);
          check(pending.length === (warm ? 2 : 0), `warm=${warm}: highlight compilation is opt-in`);
          await Promise.all(pending);
          check(r.renderer.getRenderTarget() === null, `warm=${warm}: warm-up restores the canvas target`);
          check(diff(baseline, image(r)) === 0, `warm=${warm}: warm-up preserves the displayed frame`);
          const programsReady = r.renderer.info.programs!.length;
          if (warm) check(programsReady >= programsBefore + 2, 'Opt-in warming compiles both highlight passes');
          o.highlight = true;
          check(diff(baseline, image(r)) > 0, `warm=${warm}: first hover renders a highlight`);
          const programsLit = r.renderer.info.programs!.length;
          check(warm ? programsLit === programsReady : programsLit >= programsReady + 2,
            `warm=${warm}: first hover ${warm ? 'reuses warm' : 'lazily compiles'} programs`);
          o.highlight = false;
          check(diff(baseline, image(r)) === 0, `warm=${warm}: clearing restores baseline`);
          o.highlight = true; image(r);
          check(r.renderer.info.programs!.length === programsLit, `warm=${warm}: later hover reuses cached programs`);
          check(pending.length === (warm ? 2 : 0), `warm=${warm}: warm-up runs only once`);
          out.push(`warm=${warm}: opt-in compilation, stable frame/target and cached hover programs`);
        } finally { r.dispose(); r.canvas.remove(); }
      }

      // Closing a scene during compileAsync must let its pending shader polls finish without page errors.
      const closing = make(false, 1, true), pendingClose: Promise<unknown>[] = [];
      const compileClose = closing.renderer.compileAsync.bind(closing.renderer);
      const disposeClose = closing.renderer.dispose.bind(closing.renderer);
      let releases = 0;
      closing.renderer.dispose = () => { releases++; disposeClose(); };
      closing.renderer.compileAsync = (...args) => {
        const promise = compileClose(...args); pendingClose.push(promise); return promise;
      };
      try {
        closing.addObject(geometry).position.set(0, 1, 0);
        closing.renderGeometry(8); image(closing);
        check(pendingClose.length === 2, 'Immediate-dispose fixture starts both warm-up compilations');
        closing.dispose();
        closing.dispose();
        const completed = await Promise.race([
          Promise.all(pendingClose).then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
        ]);
        check(completed, 'Disposal during warm-up allows shader compilation to finish');
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        check(releases === 1, 'Repeated disposal during warm-up releases the renderer exactly once');
        out.push('Immediate disposal during asynchronous warm-up finishes without page errors');
      } finally { closing.dispose(); closing.canvas.remove(); }

      for (const S of [1, 3] as const) {
        const r = make(false, S);
        try {
          const objects = Array.from({ length: 6 }, (_, i) => {
            const o = r.addObject(geometry);
            o.position.set((i % 3 - 1) * 1.25, 0.6, i < 3 ? -0.65 : 0.65); o.scale.setScalar(0.5);
            return o;
          });
          for (let view = 0; view < 4; view++) for (const zoom of [1, 2, 3]) for (const hour of [12, 22]) {
            const name = `S=${S}, view=${view}, zoom=${zoom}, hour=${hour}`;
            r.setLook(lookAt(hour)); r.placeCamera(new THREE.Vector3(0, 0.6, 0), Math.PI / 4 + view * Math.PI / 2, Math.PI / 6, 12 / zoom);
            r.renderGeometry(8);
            const beforeIds = ids(r), baseline = image(r);
            for (const o of objects) {
              let visible = 0; for (let p = 0; p < W * H; p++) if (beforeIds[p * 4] === o.id) visible++;
              check(visible > 4, `${name}: fixture instance ${o.id} is visible (${visible} pixels)`);
            }
            r.canvas.style.width = `${W * zoom}px`; r.canvas.style.height = `${H * zoom}px`;
            const rect = r.canvas.getBoundingClientRect();
            const p = beforeIds.findIndex((v, i) => i % 4 === 0 && v === objects[0].id) / 4;
            const x = p % W, y = H - 1 - Math.floor(p / W);
            check(r.pick(rect.left + (x + 0.5) * zoom, rect.top + (y + 0.5) * zoom)?.object === objects[0],
              `${name}: pointer identifies shared instance at ${zoom}x CSS pixel scale`);
            // Move hover using renderStyle only; no geometry/shadow work is required between pointer events.
            for (const selected of [objects[0], objects[5]]) {
              selected.highlight = true;
              const lit = image(r), calls = r.renderer.info.render.calls;
              check(diff(baseline, lit) > 0, `${name}: highlight ${selected.id} changes the image`);
              check(calls === 2, `${name}: style-only hover unexpectedly adds draw calls (${calls})`);
              for (let p = 0; p < W * H; p++) {
                if (!changed(baseline, lit, p)) continue;
                // Cleanup can move a changed colour by one pixel; all effects must stay near the selected footprint.
                const x = p % W, y = Math.floor(p / W);
                let near = false;
                for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                  if (Math.abs(dx) + Math.abs(dy) > 2) continue;
                  const qx = x + dx, qy = y + dy;
                  if (qx >= 0 && qx < W && qy >= 0 && qy < H && beforeIds[(qy * W + qx) * 4] === selected.id) near = true;
                }
                check(near, `${name}: highlight leaks outside selected instance at ${x},${y}`);
                const id = beforeIds[p * 4];
                check(!objects.some((o) => o.id === id && o !== selected), `${name}: shared instance ${id} changed`);
              }
              const afterIds = ids(r);
              check(beforeIds.every((v, i) => afterIds[i] === v), `${name}: style-only hover preserves IDs and sun-shadow mask`);
              selected.highlight = false;
              check(diff(baseline, image(r)) === 0, `${name}: clearing hover restores exact baseline`);
            }
            out.push(name);
          }
        } finally { r.dispose(); r.canvas.remove(); }
      }

      // A foreground wall hides the whole object: toggling its highlight must never reveal it through the wall.
      const hidden = make(true);
      try {
        hidden.placeCamera(new THREE.Vector3(0, 1, 0), 0, 0, 6);
        const o = hidden.addObject(geometry); o.position.set(0, 1, 0); o.scale.setScalar(0.5);
        hidden.renderGeometry(8);
        check(!ids(hidden).some((v, i) => i % 4 === 0 && v === o.id), 'Wall fixture fully hides object');
        const baseline = image(hidden); o.highlight = true;
        check(diff(baseline, image(hidden)) === 0, 'Fully occluded highlight has no x-ray pixels');
        o.position.x = 1.9; hidden.renderGeometry(8);
        o.highlight = false; const partialIds = ids(hidden), partial = image(hidden);
        check(partialIds.some((v, i) => i % 4 === 0 && v === o.id), 'Partial-occlusion fixture has visible object pixels');
        o.highlight = true; const lit = image(hidden);
        check(diff(partial, lit) > 0, 'Partially occluded highlight remains visible');
        const normals = new Float32Array(W * H * 4);
        hidden.renderer.readRenderTargetPixels(hidden['gbuf'], 0, 0, W, H, normals, undefined, 1);
        for (let p = 0; p < W * H; p++) if (partialIds[p * 4] === 0 && normals[p * 4 + 2] > 0.99) {
          check(!changed(partial, lit, p), 'Highlight does not paint foreground wall pixels');
        }
        out.push('Full/partial occlusion: visible rim only, no x-ray');
      } finally { hidden.dispose(); hidden.canvas.remove(); }

      for (const S of [1, 3] as const) {
        const closeWall = make('close', S);
        try {
          closeWall.placeCamera(new THREE.Vector3(0, 1, 0), 0, 0, 6);
          const o = closeWall.addObject(geometry); o.position.set(0, 1, 0); o.scale.setScalar(0.5); o.snap = false;
          closeWall.renderGeometry(8);
          const identity = ids(closeWall), normals = new Float32Array(W * H * 4);
          closeWall.renderer.readRenderTargetPixels(closeWall['gbuf'], 0, 0, W, H, normals, undefined, 1);
          check(identity.some((v, i) => i % 4 === 0 && v === o.id), `S=${S}: close wall leaves visible object pixels`);
          for (const cleanup of [false, true]) {
            o.highlight = false; const baseline = image(closeWall, cleanup);
            o.highlight = true; const lit = image(closeWall, cleanup);
            check(diff(baseline, lit) > 0, `S=${S}: selected object next to close wall still highlights`);
            let wallPixels = 0;
            // The wall's front face occupies the centre-right 10x10 block; depth separates it from the ground.
            for (let y = 55; y < 65; y++) for (let x = 80; x < 90; x++) {
              const p = y * W + x;
              check(identity[p * 4] === 0 && normals[p * 4 + 2] > 0.99, `S=${S}: close wall pixel ${x},${y}`);
              wallPixels++;
              check(!changed(baseline, lit, p), `S=${S}, cleanup=${cleanup}: highlight paints close foreground wall at ${x},${y}`);
            }
            check(wallPixels === 100, `S=${S}: close-occluder fixture covers 100 wall pixels`);
          }
          out.push(`S=${S}: close foreground wall retains its pixels with cleanup off/on`);
        } finally { closeWall.dispose(); closeWall.canvas.remove(); }
      }

      const skyRim = make();
      try {
        skyRim.placeCamera(new THREE.Vector3(0, 1, 0), 0, 0, 6);
        const o = skyRim.addObject(geometry); o.position.set(0, 1, 0); o.scale.setScalar(0.5); o.snap = false;
        skyRim.renderGeometry(8);
        const identity = ids(skyRim), albedo = skyRim.readAlbedo(), baseline = image(skyRim);
        o.highlight = true; const lit = image(skyRim);
        let rimPixels = 0, colour: Uint8Array | null = null;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const p = y * W + x;
          if (albedo[p * 4 + 3] >= 0.5) continue;
          const adjacent = [p - 1, p + 1, p - W, p + W].some((q) => identity[q * 4] === o.id);
          check(changed(baseline, lit, p) === adjacent, `Sky rim is exactly one art pixel wide at ${x},${y}`);
          if (!adjacent) continue;
          rimPixels++;
          const pixel = lit.slice(p * 4, p * 4 + 3);
          if (colour === null) colour = pixel;
          else check(colour.every((v, i) => pixel[i] === v), 'One-material sky rim has one uniform ink colour');
        }
        check(rimPixels >= 36, `Sky fixture has a complete visible rim (${rimPixels} pixels)`);
        out.push('Sky boundary: exactly one art-pixel rim, uniform ink colour, no wider halo');
      } finally { skyRim.dispose(); skyRim.canvas.remove(); }

      // Equal-colour, coplanar touching instances have no depth silhouette; their ID boundary must still read.
      const touching = make();
      try {
        touching.placeCamera(new THREE.Vector3(0, 1, 0), 0, 0, 6);
        const a = touching.addObject(geometry), b = touching.addObject(geometry);
        a.position.set(-0.25, 1, 0); b.position.set(0.25, 1, 0);
        a.scale.setScalar(0.5); b.scale.set(-0.5, 0.5, 0.5);
        touching.renderGeometry(8);
        const identity = ids(touching), baseline = image(touching), rawBaseline = image(touching, false);
        a.highlight = true; const lit = image(touching), rawLit = image(touching, false);
        let boundary = 0;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const p = y * W + x;
          if (identity[p * 4] === b.id) {
            check(!changed(rawBaseline, rawLit, p), `Raw highlight never paints touching mirrored sibling at ${x},${y}`);
            // Cleanup votes on neighbour colours. Its response to a changed rim is confined to adjacent pixels;
            // this must not change the sibling's own shading or spread into its interior.
            const adjacent = [p - 1, p + 1, p - W, p + W].some((q) => identity[q * 4] === a.id);
            check(!changed(baseline, lit, p) || adjacent, `Cleanup effect spreads into sibling interior at ${x},${y}`);
          }
          if (identity[p * 4] === a.id && identity[(p + 1) * 4] === b.id && changed(rawBaseline, rawLit, p)) {
            check(!changed(rawLit, lit, p), `Cleanup erases selected rim at ${x},${y}`);
            boundary++;
          }
        }
        check(boundary >= 4, `Coplanar instance boundary has a visible inner rim (${boundary} pixels)`);
        a.highlight = false;
        check(diff(baseline, image(touching)) === 0, 'Touching-instance clear restores exact baseline');
        a.highlight = true; a.remove(); touching.renderGeometry(8);
        const removed = image(touching);
        const c = touching.addObject(geometry); c.position.set(100, 100, 0); touching.renderGeometry(8);
        check(diff(removed, image(touching)) === 0, 'Removed highlight does not transfer to a new shared instance');
        out.push('Touching coplanar instances, mirrored sibling isolation, cleanup rim retention and removal');
      } finally { touching.dispose(); touching.canvas.remove(); }

      const budget = make();
      try {
        budget.placeCamera(new THREE.Vector3(0, 1, 0), 0, 0, 6);
        const objects = Array.from({ length: MAX_HIGHLIGHTS + 1 }, (_, i) => {
          const o = budget.addObject(geometry); o.position.set((i - 2) * 0.9, 1, 0); o.scale.setScalar(0.5); return o;
        });
        budget.renderGeometry(8);
        const baseline = image(budget);
        for (let i = 0; i < MAX_HIGHLIGHTS; i++) objects[i].highlight = true;
        const full = image(budget);
        for (let i = 0; i < MAX_HIGHLIGHTS; i++) {
          // Reassigning true at the limit is idempotent, and each packed ID is rendered independently.
          objects[i].highlight = true;
          const id = objects[i].id, footprint = ids(budget);
          check(full.some((_, k) => k % 4 === 0 && footprint[k] === id && changed(baseline, full, k / 4)), `Highlight slot ${i} is visible`);
        }
        const extra = objects[MAX_HIGHLIGHTS];
        let rejected = false;
        try { extra.highlight = true; } catch (e) { rejected = e instanceof RangeError; }
        check(rejected && !extra.highlight, 'Exceeding highlight budget rejects before changing the extra handle');
        check(diff(full, image(budget)) === 0, 'Overflow preserves all active highlight pixels');
        objects[0].highlight = false; extra.highlight = true;
        check(extra.highlight && diff(full, image(budget)) > 0, 'Clearing a highlight frees its slot for another object');
        const removed = objects[1]; removed.remove();
        check(!removed.highlight, 'Removing an object clears its highlight');
        removed.highlight = true;
        check(!removed.highlight, 'Removed handles ignore attempts to reserve highlight slots');
        objects[0].highlight = true;
        for (const o of objects) o.highlight = false;
        budget.renderGeometry(8);
        const off = image(budget); extra.highlight = true; image(budget); extra.highlight = false;
        check(diff(off, image(budget)) === 0, 'Repeated empty/nonempty transitions restore exact pixels');
        out.push('All highlight slots, idempotence, transactional overflow, slot reuse and removed-handle no-op');
      } finally { budget.dispose(); budget.canvas.remove(); }
    } finally { geometry.dispose(); box.dispose(); }
    return out;
  });
  assert.deepEqual(errors, [], 'No browser or shader errors');
  results.forEach((r) => console.log('PASS:', r));
} finally { await browser.close(); }
