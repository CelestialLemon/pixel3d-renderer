import * as THREE from 'three';
import { buildWorld3, GROUND_Y } from './world';
import { PixelPipeline3, type Settings } from './pipeline';
import { lookAt, hourLabel, PRESETS, type Look } from './tod';
import { buildWorld } from '../scene';
import { PixelPipeline as Pass1, type Settings as Settings1 } from '../pass1/pipeline';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => {
  const v = params.get(key);
  return v !== null && Number.isFinite(+v) ? +v : fallback;
};
const DEG = Math.PI / 180;
const settings: Settings = {
  pixel: THREE.MathUtils.clamp(num('px', 3), 1, 8),
  outlines: params.get('outline') !== '0', dither: params.get('dither') !== '0', cleanup: params.get('clean') !== '0',
  contacts: params.get('contacts') !== '0', clouds: params.get('clouds') !== '0', glow: params.get('glow') !== '0',
  vignette: params.get('vignette') !== '0', animate: params.get('anim') !== '0',
};
const view = { az: num('az', 38) * DEG, el: num('el', 38) * DEG, size: num('zoom', 11.5), tx: 0.8, tz: 0.4 };
const target = { ...view };
let hour = num('hour', 17.5), cycle = params.get('cycle') === '1', auto = params.get('auto') === '1', autoPausedUntil = 0, dirty = true;
let compare = params.get('compare') === '1', split = num('split', 50);
if (params.has('clean-ui')) document.body.classList.add('clean');

async function main() {
  const world = await buildWorld3('/cookie_factory.glb', num('k', 56));
  const p3 = new PixelPipeline3($<HTMLCanvasElement>('p3-view'), world.staticGeo, world.dynamicGeo);
  let p1: Pass1 | null = null, p1Geo: THREE.BufferGeometry | null = null;
  let look: Look = lookAt(hour);
  const applyLook = () => {
    look = lookAt(hour);
    p3.setLook(look); p1?.setSun(look.sunAz, Math.max(look.sunEl, 12));
    $<HTMLOutputElement>('clock').value = hourLabel(hour);
    const name = Object.entries(PRESETS).sort((a, b) => Math.abs(a[1] - hour) - Math.abs(b[1] - hour))[0];
    $('clock-title').textContent = `${name[0]} · ${hourLabel(hour)}`;
    $<HTMLInputElement>('hour').value = String(hour);
    dirty = true;
  };

  const ensureP1 = async () => {
    if (p1) return;
    p1Geo = (await buildWorld('/cookie_factory.glb', 44)).geometry;
    p1 = new Pass1($<HTMLCanvasElement>('p1-view'), p1Geo);
    p1.setSun(look.sunAz, Math.max(look.sunEl, 12));
    fit();
  };
  const fit = () => {
    const w = Math.max(1, Math.ceil(innerWidth / settings.pixel)), h = Math.max(1, Math.ceil(innerHeight / settings.pixel));
    for (const [pipe, el] of [[p3, 'p3-view'], [p1, 'p1-view']] as const) {
      if (!pipe) continue;
      if (pipe.width !== w || pipe.height !== h) pipe.resize(w, h);
      const c = $<HTMLCanvasElement>(el); c.style.width = `${w * settings.pixel}px`; c.style.height = `${h * settings.pixel}px`;
    }
    dirty = true;
  };
  addEventListener('resize', fit);
  fit();

  // ---- UI ----
  const bind = (id: string, key: keyof Settings) => {
    const el = $<HTMLInputElement>(id); el.checked = settings[key] as boolean;
    el.onchange = () => { (settings as any)[key] = el.checked; dirty = true; };
  };
  (['outlines', 'dither', 'cleanup', 'contacts', 'clouds', 'glow', 'vignette', 'animate'] as const).forEach((k) => bind(k, k));
  const presets = $('presets');
  for (const [name, h] of Object.entries(PRESETS)) {
    const b = document.createElement('button'); b.textContent = name; b.onclick = () => { hour = h; cycle = false; $<HTMLInputElement>('cycle').checked = false; applyLook(); };
    presets.append(b);
  }
  $<HTMLInputElement>('hour').oninput = (e) => { hour = +(e.target as HTMLInputElement).value; applyLook(); };
  const cyc = $<HTMLInputElement>('cycle'); cyc.checked = cycle; cyc.onchange = () => (cycle = cyc.checked);
  const autoEl = $<HTMLInputElement>('auto'); autoEl.checked = auto; autoEl.onchange = () => (auto = autoEl.checked);
  const px = $<HTMLSelectElement>('pixel');
  if (![...px.options].some((o) => +o.value === settings.pixel)) px.add(new Option(String(settings.pixel), String(settings.pixel)));
  px.value = String(settings.pixel); px.onchange = () => { settings.pixel = +px.value; fit(); };
  const setSplit = (v: number) => { split = THREE.MathUtils.clamp(v, 0, 100); document.body.style.setProperty('--split', `${split}%`); $('divider').setAttribute('aria-valuenow', String(Math.round(split))); };
  const setCompare = async (on: boolean) => {
    compare = on; $<HTMLInputElement>('compare').checked = on;
    if (on) await ensureP1();
    document.body.classList.toggle('compare', on); dirty = true;
  };
  $<HTMLInputElement>('compare').onchange = (e) => setCompare((e.target as HTMLInputElement).checked);
  const div = $('divider');
  div.onpointerdown = (e) => { div.setPointerCapture(e.pointerId); setSplit(e.clientX / innerWidth * 100); };
  div.onpointermove = (e) => { if (div.hasPointerCapture(e.pointerId)) setSplit(e.clientX / innerWidth * 100); };
  div.onkeydown = (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setSplit(split + (e.key === 'ArrowLeft' ? -2 : 2)); } };
  setSplit(split);
  const turn = (delta: number) => { target.az = Math.round(target.az / (45 * DEG)) * 45 * DEG + delta * 45 * DEG; autoPausedUntil = performance.now() + 4000; };
  $('rotL').onclick = () => turn(-1); $('rotR').onclick = () => turn(1);
  $('close-view').onclick = () => { target.size = 11.5; target.el = 38 * DEG; };
  $('landscape').onclick = () => { target.size = 23; target.el = 32 * DEG; };
  $('stats').textContent = `${(world.triangles / 1000).toFixed(0)}k tris · ${world.paletteColors} base colors`;

  // ---- orbit controls (on the stage, so the divider and canvases share them) ----
  const stage = $('stage');
  let drag: { x: number; y: number; pan: boolean } | null = null;
  stage.oncontextmenu = (e) => e.preventDefault();
  stage.onpointerdown = (e) => { if ((e.target as HTMLElement).closest('.divider')) return; stage.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 }; autoPausedUntil = performance.now() + 4000; };
  stage.onpointerup = stage.onpointercancel = () => (drag = null);
  stage.onpointermove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const k = p3.viewHeight / innerHeight, sn = Math.max(Math.sin(view.el), 0.3), ca = Math.cos(view.az), sa = Math.sin(view.az);
      target.tx = THREE.MathUtils.clamp(target.tx + (-ca * dx - sa * dy / sn) * k, -9, 10);
      target.tz = THREE.MathUtils.clamp(target.tz + (sa * dx - ca * dy / sn) * k, -8, 8);
    } else { target.az -= dx * 0.0075; target.el = THREE.MathUtils.clamp(target.el + dy * 0.005, 28 * DEG, 76 * DEG); }
  };
  stage.addEventListener('wheel', (e) => { e.preventDefault(); target.size = THREE.MathUtils.clamp(target.size * Math.exp(e.deltaY * 0.0012), 5, 30); }, { passive: false });
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input, select, button')) return;
    if (e.key === 'ArrowLeft' || e.key === 'a') turn(-1);
    if (e.key === 'ArrowRight' || e.key === 'd') turn(1);
    if (e.key === 'h') document.body.classList.toggle('clean');
  });

  const s1 = (): Settings1 => ({ pixel: settings.pixel, outlines: settings.outlines, dither: settings.dither, cleanup: settings.cleanup, clouds: settings.clouds, contacts: settings.contacts, sunAz: look.sunAz, sunEl: look.sunEl });
  let last = performance.now(), time = params.has('time') ? num('time', 0) : 0;
  const focus = new THREE.Vector3();
  const render = () => {
    const p3w = p3.width, p3h = p3.height;
    if (dirty || settings.animate) {
      const viewHeight = view.size * Math.max(1, 1.15 / (p3w / p3h));
      focus.set(view.tx, GROUND_Y + 1.3, view.tz);
      p3.placeCamera(focus, view.az, view.el, viewHeight); p3.renderGeometry(time);
      if (compare && p1) { p1.placeCamera(focus, view.az, view.el, viewHeight); p1.renderGeometry(); }
      dirty = false;
    }
    p3.renderStyle(settings, time);
    if (compare && p1) p1.renderStyle(s1(), time);
  };
  $('shot').onclick = () => {
    render();
    const c3 = $<HTMLCanvasElement>('p3-view'), out = document.createElement('canvas');
    out.width = c3.width; out.height = c3.height;
    const ctx = out.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c3, 0, 0);
    if (compare && p1) { const w = Math.round(out.width * split / 100); if (w > 0) ctx.drawImage($<HTMLCanvasElement>('p1-view'), 0, 0, w, out.height, 0, 0, w, out.height); }
    const a = document.createElement('a'); a.download = `cookie-co-pass3-${hourLabel(hour).replace(':', '')}.png`; a.href = out.toDataURL('image/png'); a.click();
  };
  (window as any).app3 = { p3, get p1() { return p1; }, settings, view, target, world, render, setHour: (h: number) => { hour = h; applyLook(); }, setCompare, setSplit, redraw: () => (dirty = true) };

  applyLook();
  if (compare) await setCompare(true);
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (settings.animate && !params.has('time')) time += dt;
    if (cycle) { hour = (hour + dt * 0.45) % 24; applyLook(); }
    if (auto && now > autoPausedUntil && !drag) target.az += dt * 0.22;
    const k = 1 - Math.exp(-dt * 14);
    for (const key of ['az', 'el', 'size', 'tx', 'tz'] as const) {
      const change = (target[key] - view[key]) * k;
      if (Math.abs(change) > 1e-6) dirty = true;
      view[key] += change;
    }
    render(); requestAnimationFrame(frame);
  };
  render(); requestAnimationFrame(frame);
  $('loading').classList.add('done'); (window as any).appReady = true;
}
main().catch((e) => { console.error(e); $('loading').textContent = 'failed: ' + e.message; });
