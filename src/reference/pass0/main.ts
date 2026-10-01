import * as THREE from 'three';
import { buildWorld, GROUND_Y } from '../world';
import { PixelPipeline, type Settings } from './pipeline';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? +params.get(k)! : d);

const canvas = $<HTMLCanvasElement>('view');
const settings: Settings = {
  pixel: num('px', 3), outlines: params.get('outline') !== '0', dither: params.get('dither') !== '0',
  cleanup: params.get('clean') !== '0', clouds: params.get('clouds') !== '0', sunAz: num('sun', -62), sunEl: 42,
};
if (params.has('clean-ui')) document.body.classList.add('clean');

// camera state (radians); damped orbit with inertia
const DEG = Math.PI / 180;
const view = { az: num('az', 38) * DEG, el: num('el', 38) * DEG, size: num('zoom', 11.5), tx: 0.8, tz: 0.4 };
const target = { az: view.az, el: view.el, size: view.size, tx: view.tx, tz: view.tz };
let auto = params.get('auto') !== '0', autoPausedUntil = 0, dirty = true;

async function main() {
  const world = await buildWorld('/cookie_factory.glb', num('k', 44));
  const pipe = new PixelPipeline(canvas, world.geometry);
  pipe.setSun(settings.sunAz, settings.sunEl);
  (window as any).app = { pipe, settings, view, target, world, redraw: () => (dirty = true) };

  const fit = () => {
    const s = settings.pixel, w = Math.ceil(innerWidth / s), h = Math.ceil(innerHeight / s);
    pipe.resize(w, h);
    canvas.style.width = `${w * s}px`; canvas.style.height = `${h * s}px`;
    dirty = true;
  };
  addEventListener('resize', fit);
  fit();

  // ---- UI ----
  const bind = (id: string, key: 'outlines' | 'dither' | 'cleanup' | 'clouds') => {
    const el = $<HTMLInputElement>(id); el.checked = settings[key];
    el.onchange = () => { settings[key] = el.checked; dirty = true; };
  };
  bind('outlines', 'outlines'); bind('dither', 'dither'); bind('cleanup', 'cleanup'); bind('clouds', 'clouds');
  const autoEl = $<HTMLInputElement>('auto'); autoEl.checked = auto; autoEl.onchange = () => (auto = autoEl.checked);
  const px = $<HTMLSelectElement>('pixel'); px.value = String(settings.pixel); px.onchange = () => { settings.pixel = +px.value; fit(); };
  const sun = $<HTMLInputElement>('sun'); sun.value = String(settings.sunAz);
  sun.oninput = () => { settings.sunAz = +sun.value; pipe.setSun(settings.sunAz, settings.sunEl); dirty = true; };
  const turn = (d: number) => { target.az = Math.round(target.az / (45 * DEG)) * 45 * DEG + d * 45 * DEG; autoPausedUntil = performance.now() + 4000; };
  $('rotL').onclick = () => turn(-1); $('rotR').onclick = () => turn(1);
  $('shot').onclick = () => { pipe.renderStyle(settings, time); const a = document.createElement('a'); a.download = 'cookie-co-pixel.png'; a.href = canvas.toDataURL('image/png'); a.click(); };
  $('stats').textContent = `${(world.triangles / 1000).toFixed(0)}k tris · ${world.paletteColors} base colours`;

  // ---- orbit controls ----
  let drag: { x: number; y: number; pan: boolean } | null = null;
  let vAz = 0, vEl = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 }; autoPausedUntil = performance.now() + 4000; });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const k = target.size / innerHeight, sn = Math.max(Math.sin(view.el), 0.3), ca = Math.cos(view.az), sa = Math.sin(view.az);
      target.tx += (-ca * dx - sa * dy / sn) * k;
      target.tz += (sa * dx - ca * dy / sn) * k;
      target.tx = THREE.MathUtils.clamp(target.tx, -9, 10); target.tz = THREE.MathUtils.clamp(target.tz, -8, 8);
    } else { vAz = -dx * 0.0075; vEl = dy * 0.005; target.az += vAz; target.el = THREE.MathUtils.clamp(target.el + vEl, 28 * DEG, 76 * DEG); }
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); target.size = THREE.MathUtils.clamp(target.size * Math.exp(e.deltaY * 0.0012), 5, 30); }, { passive: false });
  addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'a') turn(-1); if (e.key === 'ArrowRight' || e.key === 'd') turn(1); if (e.key === 'h') document.body.classList.toggle('clean'); });

  const gnd = new THREE.Vector3();
  let last = performance.now(), time = 0;
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1); last = now; time += dt;
    if (auto && now > autoPausedUntil && !drag) target.az += dt * 0.22;
    const k = 1 - Math.exp(-dt * 14);
    const prev = [view.az, view.el, view.size, view.tx, view.tz];
    view.az += (target.az - view.az) * k; view.el += (target.el - view.el) * k; view.size += (target.size - view.size) * k;
    view.tx += (target.tx - view.tx) * k; view.tz += (target.tz - view.tz) * k;
    if ([view.az, view.el, view.size, view.tx, view.tz].some((v, i) => Math.abs(v - prev[i]) > 1e-6)) dirty = true;
    if (dirty) {
      pipe.placeCamera(gnd.set(view.tx, GROUND_Y + 1.3, view.tz), view.az, view.el, view.size);
      pipe.renderGeometry(); dirty = false;
    }
    pipe.renderStyle(settings, time);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  $('loading').classList.add('done');
  (window as any).appReady = true;
}
main().catch((e) => { console.error(e); $('loading').textContent = 'failed: ' + e.message; });
