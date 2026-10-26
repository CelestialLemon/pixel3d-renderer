// Glass (FLAG.GLASS, glass.ts): panes are drawn over the finished image yet leave the opaque world alone (G-buffer, sun
// shadow and picking see only what is behind), take an object's tint, follow an object's opacity, and cost nothing when there
// is no glass. Requires the dev server and the pinned browser, like the other checks.
//   node tools/glass-check.ts
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, FluidCollector, place, lookAt, FLAG } = await import('/src/renderer/index.ts');
    const W = 160, H = 120, HEIGHT = 12;
    const GREY: [number, number, number] = [0.4, 0.4, 0.4], GLASS: [number, number, number] = [0.3, 0.6, 0.5], BROWN: [number, number, number] = [0.3, 0.15, 0.05];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    // A 4 x 4 m pane lying 1 m above the ground, and a 4 x 4 m ground slab.
    const pane = () => {
      const g = new THREE.PlaneGeometry(4, 4); g.rotateX(-Math.PI / 2); g.translate(0, 1, 0);
      return g.toNonIndexed();
    };
    const pieces = (withGlass: boolean, ground = true) => {
      const c = new GeometryCollector();
      if (ground) c.add(box, place(0, -0.1, 0, 0, 0, 0, 24, 0.2, 24), GREY);
      c.add(box, place(-1.8, 0.5, -1.8, 0, 0, 0, 0.2, 1, 0.2), BROWN);   // a post under the pane's corner
      if (withGlass) c.add(pane(), null, GLASS, FLAG.GLASS);
      return c;
    };
    const scene = (c: InstanceType<typeof GeometryCollector>) => ({ staticGeometry: c.build(), dynamicGeometry: new GeometryCollector(true).build(), lamps: [], grooves: null,
      fluids: new FluidCollector().build(), shadow: { center: new THREE.Vector3(), radius: 14 }, stats: { triangles: 0, paletteColors: 0 } });
    const make = (s: ReturnType<typeof scene>) => {
      const r = new PixelRenderer(document.createElement('canvas'), s, { supersample: 3, shadowMapSize: 1024 });
      r.resize(W, H); r.setLook({ ...lookAt(12), sunAz: 90, sunEl: 45 }); r.placeCamera(new THREE.Vector3(), 0.4, 0.9, HEIGHT);
      return r;
    };
    type R = InstanceType<typeof PixelRenderer>;
    const image = (r: R) => {
      r.renderGeometry(0); r.renderStyle(0);
      const t = document.createElement('canvas'); t.width = W; t.height = H;
      const x = t.getContext('2d')!; x.drawImage(r.canvas, 0, 0);
      return x.getImageData(0, 0, W, H).data;
    };
    const gbuffer = (r: R) => {
      const albedo = r.readAlbedo(), shadow = new Float32Array(W * H * 4);
      r.renderer.readRenderTargetPixels(r['gbuf'], 0, 0, W, H, shadow, undefined, 2);
      return { albedo, shadow };
    };
    const differences = (a: ArrayLike<number>, b: ArrayLike<number>, stride = 1) => { let n = 0; for (let i = 0; i < a.length; i += stride) if (a[i] !== b[i]) n++; return n; };
    const out: Record<string, unknown> = {};
    const centre = (r: R) => { const q = new THREE.Vector3(0, 1, 0).project(r.camera); return [(q.x * 0.5 + 0.5) * W, (1 - (q.y * 0.5 + 0.5)) * H] as const; };

    // A scene with its own glass: the image differs from the one without it, the opaque world (G-buffer and its shadows) doesn't.
    {
      const withGlass = make(scene(pieces(true))), without = make(scene(pieces(false)));
      try {
        const a = image(withGlass), b = image(without);
        const ga = gbuffer(withGlass), gb = gbuffer(without);
        const changed = differences(a, b, 4);
        check(changed > 300, `Glass changes the image where the pane is (${changed} px)`);
        check(differences(ga.albedo, gb.albedo) === 0, 'Glass never reaches the opaque G-buffer');
        check(differences(ga.shadow, gb.shadow) === 0, 'Glass casts no sun shadow');
        check(withGlass['glassBuf'] !== undefined && without['glassBuf'] === undefined, 'The glass target exists only while glass is drawn');
        const [px, py] = centre(withGlass), hit = withGlass.pickPixel(px, py);
        check(!!hit && hit.object === null, 'A pick goes through glass');
        out.scene = { changed };
      } finally { withGlass.dispose(); without.dispose(); }
    }

    // An object's glass: placed with the object, tinted by it, dithered by its opacity, gone with it.
    {
      const glass = new GeometryCollector(); glass.add(pane(), null, GLASS, FLAG.GLASS);
      glass.add(box, place(-1.8, 0.5, -1.8, 0, 0, 0, 0.2, 1, 0.2), BROWN);
      const geometry = glass.build();
      const r = make(scene(pieces(false)));
      try {
        const empty = image(r);
        const o = r.addObject(geometry);
        const shown = image(r), g = gbuffer(r);
        check(differences(shown, empty, 4) > 300, 'An object\'s glass is drawn');
        check(differences(g.albedo, gbuffer(make(scene(pieces(false)))).albedo) > 0, 'The object\'s frame is in the G-buffer');
        const tintless = Uint8ClampedArray.from(shown);
        o.tint = new THREE.Color(1, 1, 1); o.tintStrength = 1;
        const whitened = image(r);
        let brighter = 0;
        for (let i = 0; i < whitened.length; i += 4) if (whitened[i + 1] > tintless[i + 1] + 20) brighter++;
        check(brighter > 200, `The object tint reaches the glass (${brighter} px lighter)`);
        o.tint = null; o.opacity = 0.5;
        const half = image(r);
        check(differences(half, tintless, 4) > 100 && differences(half, empty, 4) > 100, 'Opacity thins the glass out');
        o.opacity = 1;
        check(differences(image(r), tintless) === 0, 'Back to opaque, the glass is as it was');
        const mirrored = r.addObject(geometry); mirrored.scale.set(-1, 1, 1); o.visible = false; image(r);
        o.remove(); mirrored.remove();
        check(differences(image(r), empty) === 0 && r['glassBuf'] === undefined, 'Removing the objects removes their glass and frees the target');
        out.object = { brighter };
      } finally { r.dispose(); }
    }
    return out;
  });
  console.log(JSON.stringify(results));
  if (errors.length) { console.log(errors.slice(0, 10).join('\n')); process.exitCode = 1; }
} finally { await browser.close(); }
