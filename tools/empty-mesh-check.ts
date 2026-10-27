// Regression for #57: batch meshes with no instances stay out of three's traversal, in every pass, across 0 <-> n transitions.
// Requires the dev server and the pinned browser, like the other renderer checks.
//   node tools/empty-mesh-check.ts
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 64, height: 64 });
  await open(page, 'pass3.html?scene=test-chart&auto=0&anim=0&time=8');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { PixelRenderer, GeometryCollector, FluidCollector, place, lookAt } = await import('/src/renderer/index.ts');
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const box = new THREE.BoxGeometry(1, 1, 1);
    const g = new GeometryCollector(); g.add(box, null, [0.8, 0.12, 0.07]);
    const geometry = g.build();
    const s = new GeometryCollector(); s.add(box, place(0, -0.1, 0, 0, 0, 0, 24, 0.2, 24), [0.4, 0.4, 0.4]);
    const r = new PixelRenderer(document.createElement('canvas'), {
      staticGeometry: s.build(), dynamicGeometry: new GeometryCollector(true).build(), lamps: [], grooves: null,
      fluids: new FluidCollector().build(), shadow: { center: new THREE.Vector3(), radius: 14 }, stats: { triangles: 0, paletteColors: 0 },
    });
    r.resize(160, 120); r.setLook(lookAt(12)); r.placeCamera(new THREE.Vector3(), 0, 0, 12);
    // Visits three makes per frame to batch meshes (it skips an invisible object before it reaches renderBufferDirect).
    const rd = r.renderer as unknown as { renderBufferDirect: (...a: unknown[]) => void };
    const original = rd.renderBufferDirect.bind(r.renderer);
    let visits = 0;
    rd.renderBufferDirect = (...a: unknown[]) => { visits++; return original(...a); };
    const meshes = () => [...r['batches'].values()].flatMap((b: { meshes: unknown[]; glassMeshes: unknown[] }) => [...b.meshes, ...b.glassMeshes]) as { count: number; visible: boolean }[];
    const frame = () => { visits = 0; r.renderGeometry(0); return visits; };
    const consistent = (label: string) => {
      for (const m of meshes()) check(m.visible === m.count > 0, `${label}: visible=${m.visible} with count=${m.count}`);
    };
    frame(); const base = frame();   // static world and fullscreen passes only
    const out: Record<string, number> = { base };
    const a = r.addObject(geometry), b = r.addObject(geometry); b.position.x = 2;
    const mirrored = r.addObject(geometry); mirrored.scale.set(-1, 1, 1); mirrored.castShadow = false;
    frame(); out.one = frame(); consistent('populated');
    check(meshes().filter((m) => m.visible).length === 2, 'only the two populated slots are visible');
    // Hiding every object empties every slot; showing them again must restore the visits of the populated frame.
    for (const o of [a, b, mirrored]) o.visible = false;
    out.hidden = frame(); consistent('hidden');
    frame(); out.hidden = frame();   // settle the shadow maps
    check(out.hidden === base, `hidden objects cost ${out.hidden - base} visits (${JSON.stringify(out)})`);
    for (const o of [a, b, mirrored]) o.visible = true;
    frame(); out.back = frame(); consistent('shown again');
    check(out.back === out.one, `0 -> n visits ${out.back} vs ${out.one}`);
    return out;
  });
  console.log(JSON.stringify(results));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
