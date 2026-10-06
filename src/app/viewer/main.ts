import * as THREE from 'three';
import { DEFAULT_DAY_CYCLE, DEFAULT_PALETTE_SIZE, hourLabel, PixelRenderer, type Look, type PixelObject, type PixelRendererOptions, type PixelScene, type RenderSettings } from '../../renderer';
import { buildWorld } from '../../reference/world';
import { SCENES, sceneById } from '../../scenes';
import type { SceneGame } from '../../scenes/types';
import { Orbit } from '../orbit';
import { $, num, paletteSize as paletteParam, params, settingsFromParams } from '../params';
import { PASSES, type PassView } from '../passes';

// The current renderer on its own, full window, with time-of-day controls. `?scene=<id>` picks the scene.
// For scenes the reference passes also draw, it can wipe against Pass 1. On any scene it can wipe against the
// same scene with another palette size (`?compare=palette`, `?left-k=` for the left side, `?k=` for the right).

const scene = sceneById(params.get('scene'));
const settings: RenderSettings & { pixel: number; animate: boolean } = {
  ...settingsFromParams(), pixel: THREE.MathUtils.clamp(num('px', 3), 1, 8), animate: params.get('anim') !== '0',
};
const orbit = new Orbit(scene.view);
const day = scene.look ?? DEFAULT_DAY_CYCLE;
let hour = num('hour', scene.hour ?? 17.5), cycle = params.get('cycle') === '1', dirty = true;
// What the left of the wipe shows: Pass 1, or this renderer with another palette size.
type Compare = 'off' | 'pass1' | 'palette';
let compare: Compare = params.get('compare') === 'palette' ? 'palette' : params.get('compare') === '1' && scene.hasReference ? 'pass1' : 'off';
let split = num('split', 50);
// The left side defaults to 56 colours, the budget before 2026-10-02.
const LEFT_PALETTE_SIZE = 56;
if (params.has('clean-ui')) document.body.classList.add('clean');

async function main() {
  const paletteSize = params.has('k') ? paletteParam('k', scene.paletteSize ?? DEFAULT_PALETTE_SIZE) : undefined, leftPaletteSize = paletteParam('left-k', LEFT_PALETTE_SIZE);
  const pixelScene = await scene.build(paletteSize);
  // Thin-feature resolve (docs/THIN_FEATURES.md). The default is ss=3 with resolve=thin; ?ss=1 turns supersampling off and
  // ?resolve=majority|near|near3 picks another policy for comparison.
  // Hovering highlights objects (below), so compile the highlight shaders ahead of the first hover.
  const options: PixelRendererOptions = { limits: scene.limits, warmHighlight: true };
  if (num('ss', 3) === 1) options.supersample = 1;
  const resolve = params.get('resolve'), policy = resolve ? ({ majority: 0, near: 1, near3: 2, thin: 1 } as Record<string, number>)[resolve] : undefined;
  if (policy !== undefined) { options.resolvePolicy = policy; options.resolveThinOnly = resolve === 'thin'; }
  const create = (id: string, s: PixelScene) => new PixelRenderer($<HTMLCanvasElement>(id), s, options);
  const p3 = create('p3-view', pixelScene);
  // Scenes with game objects move them to the clock before each frame (see BuiltScene.populate).
  const game = pixelScene.populate?.(p3);
  let p1: PassView | null = null, pOther: PixelRenderer | null = null, otherGame: SceneGame | undefined;
  const left = () => (compare === 'pass1' ? p1 : compare === 'palette' ? pOther : null);
  let look: Look = day.lookAt(hour);
  // Pass 1 has no dusk grade, so it keeps the sun at least 12 degrees up.
  const pass1Look = (): Look => ({ ...look, sunEl: Math.max(look.sunEl, 12) });
  const applyLook = () => {
    look = day.lookAt(hour);
    p3.setLook(look); p1?.setLook(pass1Look()); pOther?.setLook(look);
    $<HTMLOutputElement>('clock').value = hourLabel(hour);
    $('clock-title').textContent = `${day.nearestPreset(hour)} · ${hourLabel(hour)}`;
    $<HTMLInputElement>('hour').value = String(hour);
    dirty = true;
  };

  const ensureP1 = async () => {
    if (p1) return;
    const reference = await buildWorld('/cookie_factory.glb', 44);
    p1 = PASSES.find((p) => p.id === 'pass1')!.create($<HTMLCanvasElement>('p1-view'), { reference, scene: pixelScene });
    p1.setLook(pass1Look());
    fit();
  };
  const ensureOther = async () => {
    if (pOther) return;
    $('loading').classList.remove('done');
    const other = await scene.build(leftPaletteSize);
    pOther = create('pal-view', other);
    otherGame = other.populate?.(pOther);
    $('loading').classList.add('done');
    pOther.setLook(look);
    fit();
  };
  const fit = () => {
    const w = Math.max(1, Math.ceil(innerWidth / settings.pixel)), h = Math.max(1, Math.ceil(innerHeight / settings.pixel));
    for (const [pipe, el] of [[p3, 'p3-view'], [p1, 'p1-view'], [pOther, 'pal-view']] as const) {
      if (!pipe) continue;
      if (pipe.width !== w || pipe.height !== h) pipe.resize(w, h);
      const c = $<HTMLCanvasElement>(el); c.style.width = `${w * settings.pixel}px`; c.style.height = `${h * settings.pixel}px`;
    }
    dirty = true;
  };
  addEventListener('resize', fit);
  fit();

  // ---- UI ----
  for (const key of ['outlines', 'dither', 'cleanup', 'contacts', 'clouds', 'glow', 'vignette', 'animate'] as const) {
    const el = $<HTMLInputElement>(key); el.checked = settings[key];
    el.onchange = () => { settings[key] = el.checked; dirty = true; };
  }
  for (const [name, h] of Object.entries(day.presets)) {
    const b = document.createElement('button'); b.textContent = name;
    b.onclick = () => { hour = h; cycle = false; $<HTMLInputElement>('cycle').checked = false; applyLook(); };
    $('presets').append(b);
  }
  $<HTMLInputElement>('hour').oninput = (e) => { hour = +(e.target as HTMLInputElement).value; applyLook(); };
  const cyc = $<HTMLInputElement>('cycle'); cyc.checked = cycle; cyc.onchange = () => (cycle = cyc.checked);
  const autoEl = $<HTMLInputElement>('auto'); autoEl.checked = orbit.auto; autoEl.onchange = () => (orbit.auto = autoEl.checked);
  const px = $<HTMLSelectElement>('pixel');
  if (![...px.options].some((o) => +o.value === settings.pixel)) px.add(new Option(String(settings.pixel), String(settings.pixel)));
  px.value = String(settings.pixel); px.onchange = () => { settings.pixel = +px.value; fit(); };

  const sceneSelect = $<HTMLSelectElement>('scene');
  for (const s of SCENES) sceneSelect.add(new Option(s.title, s.id));
  sceneSelect.value = scene.id;
  sceneSelect.closest('label')!.hidden = SCENES.length < 2;
  sceneSelect.onchange = () => { const q = new URLSearchParams(location.search); q.set('scene', sceneSelect.value); location.search = q.toString(); };
  $('title-name').textContent = scene.title;

  const setSplit = (v: number) => { split = THREE.MathUtils.clamp(v, 0, 100); document.body.style.setProperty('--split', `${split}%`); $('divider').setAttribute('aria-valuenow', String(Math.round(split))); };
  // Both comparisons draw into the left canvas, so only one can be on at a time. `true` means Pass 1 (the old API).
  const setCompare = async (next: Compare | boolean) => {
    compare = next === true ? 'pass1' : next === false ? 'off' : next;
    if (compare === 'pass1' && !scene.hasReference) compare = 'off';
    $<HTMLInputElement>('compare').checked = compare === 'pass1';
    $<HTMLInputElement>('compare-palette').checked = compare === 'palette';
    if (compare === 'pass1') await ensureP1();
    if (compare === 'palette') await ensureOther();
    $('tag1').textContent = compare === 'palette' && pOther ? `${pOther.pixelScene.stats.paletteColors} colours` : 'Pass 1';
    $('tag3').textContent = compare === 'palette' ? `${pixelScene.stats.paletteColors} colours` : 'Pass 3';
    $('palette-sizes').hidden = compare !== 'palette';
    document.body.classList.toggle('compare', compare !== 'off');
    document.body.classList.toggle('compare-pass1', compare === 'pass1'); document.body.classList.toggle('compare-palette', compare === 'palette'); fit();
  };
  $<HTMLInputElement>('compare').closest('label')!.hidden = !scene.hasReference;
  $<HTMLInputElement>('compare').onchange = (e) => setCompare((e.target as HTMLInputElement).checked ? 'pass1' : 'off');
  $<HTMLInputElement>('compare-palette').onchange = (e) => setCompare((e.target as HTMLInputElement).checked ? 'palette' : 'off');
  const div = $('divider');
  div.onpointerdown = (e) => { div.setPointerCapture(e.pointerId); setSplit(e.clientX / innerWidth * 100); };
  div.onpointermove = (e) => { if (div.hasPointerCapture(e.pointerId)) setSplit(e.clientX / innerWidth * 100); };
  div.onkeydown = (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setSplit(split + (e.key === 'ArrowLeft' ? -2 : 2)); } };
  setSplit(split);
  scene.view.presets.forEach((p, i) => {
    const b = document.createElement('button'); b.textContent = p.name; b.onclick = () => orbit.preset(i);
    $('view-presets').append(b);
  });
  $('rotL').onclick = () => orbit.turn(-1); $('rotR').onclick = () => orbit.turn(1);
  const { triangles, paletteColors } = pixelScene.stats;
  $('stats').textContent = `${(triangles / 1000).toFixed(0)}k tris · ${paletteColors} base colors`;
  // Palette sizes for the two sides of the palette wipe. A new size rebuilds the scene, so it reloads the page.
  for (const [id, key, value] of [['k-left', 'left-k', leftPaletteSize], ['k-right', 'k', paletteSize]] as const) {
    const sel = $<HTMLSelectElement>(id), v = String(value ?? scene.paletteSize ?? DEFAULT_PALETTE_SIZE);
    if (![...sel.options].some((o) => o.value === v)) sel.add(new Option(v, v));
    sel.value = v;
    sel.onchange = () => {
      const q = new URLSearchParams(location.search); q.set(key, sel.value); q.set('compare', 'palette');
      location.search = q.toString();
    };
  }

  // Orbit controls live on the stage, so the divider and both canvases share them.
  orbit.attach($('stage'), () => p3.viewHeight / innerHeight);
  orbit.bindKeys(() => document.body.classList.toggle('clean'));
  // A click (a left press that barely moved, unlike an orbit drag) picks what is under it: the scene's game reacts and
  // the panel shows the art pixel, world position and object. Not while comparing, when the left side is another canvas.
  // Shift-press pans, so it never picks.
  let press: { id: number; x: number; y: number } | null = null;
  $('stage').addEventListener('pointerdown', (e) => { press = e.button === 0 && !e.shiftKey ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null; });
  $('stage').addEventListener('pointercancel', () => { press = null; });
  // Any point of the press more than 4 px out makes it a drag, even one that comes back.
  $('stage').addEventListener('pointermove', (e) => { if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) press = null; });
  $('stage').addEventListener('pointerup', (e) => {
    const p = press; press = null;
    if (!p || p.id !== e.pointerId || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4 || compare !== 'off') return;
    const hit = p3.pick(e.clientX, e.clientY);
    if (!hit) return;
    game?.click?.(hit, time); dirty = true;
    const w = hit.world, f = (v: number) => v.toFixed(2);
    $('pick').textContent = `pixel ${hit.x}, ${hit.y} · ${w ? `world ${f(w.x)}, ${f(w.y)}, ${f(w.z)}` : 'sky'}${hit.object ? ` · object #${hit.object.id}` : ''}`;
  });

  // Hovering a game object highlights it (PixelObject.highlight), as a point-and-click game would. Not while a button
  // is down (orbiting or panning) or while comparing.
  let hovered: PixelObject | null = null;
  const hover = (o: PixelObject | null) => {
    if (o === hovered) return;
    if (hovered) hovered.highlight = false;
    hovered = o; if (o) o.highlight = true;   // style only: the next renderStyle shows it, no redraw needed
  };
  $('stage').addEventListener('pointermove', (e) => { hover(e.buttons || compare !== 'off' ? null : p3.pick(e.clientX, e.clientY)?.object ?? null); });
  $('stage').addEventListener('pointerleave', () => hover(null));

  let last = performance.now(), time = params.has('time') ? num('time', 0) : 0, capturing = false;
  const focus = new THREE.Vector3();
  const render = () => {
    if (dirty || settings.animate) {
      const viewHeight = orbit.viewHeight(p3.width / p3.height);
      orbit.focus(focus);
      game?.update(time); otherGame?.update(time);
      p3.placeCamera(focus, orbit.view.az, orbit.view.el, viewHeight); p3.renderGeometry(time);
      left()?.placeCamera(focus, orbit.view.az, orbit.view.el, viewHeight); left()?.renderGeometry(time);
      dirty = false;
    }
    p3.renderStyle(settings, time);
    left()?.renderStyle(settings, time);
  };
  $('shot').onclick = () => {
    render();
    const c3 = $<HTMLCanvasElement>('p3-view'), out = document.createElement('canvas');
    out.width = c3.width; out.height = c3.height;
    const ctx = out.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c3, 0, 0);
    if (left()) { const w = Math.round(out.width * split / 100); if (w > 0) ctx.drawImage($<HTMLCanvasElement>(compare === 'palette' ? 'pal-view' : 'p1-view'), 0, 0, w, out.height, 0, 0, w, out.height); }
    const a = document.createElement('a'); a.download = `${scene.id}-pass3-${hourLabel(hour).replace(':', '')}.png`; a.href = out.toDataURL('image/png'); a.click();
  };
  const app3 = {
    p3, get p1() { return p1; }, get pOther() { return pOther; }, settings, orbit, scene, pixelScene, render, redraw: () => (dirty = true), get hour() { return hour; },
    setHour: (h: number) => { hour = h; applyLook(); }, setCompare, setSplit,
    // Deterministic frame for tools/timelapse.ts: stops the live loop for good, then draws exactly this clock time,
    // hour and camera (radians, as in `orbit.view`). The caller reads the canvas afterwards.
    capture: (frame: { time: number; hour?: number; view?: Partial<typeof orbit.view> }) => {
      capturing = true; time = frame.time;
      if (frame.hour !== undefined) { hour = frame.hour; applyLook(); }
      if (frame.view) Object.assign(orbit.target, Object.assign(orbit.view, frame.view));
      dirty = true; render();
      // Captures can restore the requested camera after upscaling without moving the art-pixel shading grid.
      return { x: p3.snapShift.x, y: p3.snapShift.y };
    },
  };
  (window as any).app3 = app3;

  applyLook();
  if (compare !== 'off') await setCompare(compare);
  const frame = (now: number) => {
    if (capturing) return;
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (settings.animate && !params.has('time')) time += dt;
    if (cycle) { hour = (hour + dt * 0.45) % 24; applyLook(); }
    if (orbit.step(dt, now)) dirty = true;
    render(); requestAnimationFrame(frame);
  };
  render(); requestAnimationFrame(frame);
  $('loading').classList.add('done'); (window as any).appReady = true;
  return app3;
}

/** The page's `window.app3`, for the tools that drive this page. */
export type ViewerApp = Awaited<ReturnType<typeof main>>;

main().catch((e) => { console.error(e); $('loading').textContent = 'failed: ' + e.message; });
