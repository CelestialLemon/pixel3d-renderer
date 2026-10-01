import * as THREE from 'three';
import { buildWorld, GROUND_Y } from './scene';
import { PixelPipeline as Pass0 } from './pass0/pipeline';
import { PixelPipeline as Pass1, type Settings } from './pass1/pipeline';
import { PixelPipeline as Pass2 } from './pass2/pipeline';
import { PixelPipeline3 as Pass3, type Settings as Settings3 } from './pass3/pipeline';
import { buildWorld3 } from './pass3/world';
import { lookAt, hourLabel, PRESETS, type Look } from './pass3/tod';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => {
  const value = params.get(key);
  return value !== null && Number.isFinite(+value) ? +value : fallback;
};
const ids = ['pass0', 'pass1', 'pass2', 'pass3'] as const;
type PassId = typeof ids[number];
type Mode = PassId | 'compare';
type Layout = 'wipe' | 'panels' | 'grid';
type Pipeline = Pass0 | Pass1 | Pass2 | Pass3;
let hour = num('hour', 17.5), cycle = params.get('cycle') === '1';
const initialLook = lookAt(hour);
const defaultLayout = params.get('layout') === 'wipe' || params.get('layout') === 'panels' || params.get('compare') === '0' || params.get('mode') ? 'other' : 'grid';
const settings: Settings & Settings3 = {
  pixel: THREE.MathUtils.clamp(num('px', defaultLayout === 'grid' ? 2 : 3), 1, 8),
  outlines: params.get('outline') !== '0', dither: params.get('dither') !== '0',
  contacts: params.get('contacts') !== '0', cleanup: params.get('clean') !== '0',
  clouds: params.get('clouds') !== '0', sunAz: num('sun', initialLook.sunAz), sunEl: num('sunEl', initialLook.sunEl),
  glow: params.get('glow') !== '0', vignette: params.get('vignette') !== '0', animate: params.get('anim') !== '0',
};
const requested = params.get('mode');
let mode: Mode = params.get('compare') === '0' ? 'pass3' : ids.includes(requested as PassId) ? requested as PassId : 'compare';
let layout: Layout = params.get('layout') === 'wipe' ? 'wipe' : params.get('layout') === 'panels' ? 'panels' : 'grid';
const syncLayout = () => { document.body.dataset.layout = layout === 'wipe' ? 'wipe' : 'panels'; document.body.dataset.cols = layout === 'grid' ? '2' : '4'; };
let splits = [25, 50, 75];
const DEG = Math.PI / 180;
const view = { az: num('az', 38) * DEG, el: num('el', 38) * DEG, size: num('zoom', 11.5), tx: 0.8, tz: 0.4 };
const target = { ...view };
let auto = params.get('auto') === '1', autoPausedUntil = 0, dirty = true;
if (params.has('clean-ui')) document.body.classList.add('clean');

async function main() {
  const [world, world3] = await Promise.all([buildWorld('/cookie_factory.glb', num('k', 44)), buildWorld3('/cookie_factory.glb', num('k3', 56))]);
  const canvases = Object.fromEntries(ids.map((id) => [id, $<HTMLCanvasElement>(`${id}-view`)])) as Record<PassId, HTMLCanvasElement>;
  const passes: Partial<Record<PassId, Pipeline>> = {};
  // Pass 2 owns the atmosphere settings, even when a historical pass is displayed.
  const atmospherePipe = new Pass2(canvases.pass2, world.geometry);
  passes.pass2 = atmospherePipe;
  const atmosphere = atmospherePipe.atmosphere;
  atmosphere.enabled = params.get('fog') !== '0';
  atmosphere.start = THREE.MathUtils.clamp(num('fogStart', atmosphere.start), -10, 10);
  atmosphere.end = THREE.MathUtils.clamp(num('fogEnd', atmosphere.end), 11, 40);
  atmosphere.strength = THREE.MathUtils.clamp(num('haze', atmosphere.strength), 0, 1);
  atmosphere.ink = THREE.MathUtils.clamp(num('ink', atmosphere.ink), 0, 1);
  if (/^#[0-9a-f]{6}$/i.test(params.get('fogColor') ?? '')) atmosphere.color = params.get('fogColor')!;
  const activeIds = () => mode === 'compare' ? [...ids] : [mode];
  // One shared sun for every pass; Pass 3 also derives its grade, sky and lamps from the hour.
  const currentLook = (): Look => { const l = lookAt(hour); l.sunAz = settings.sunAz; l.sunEl = settings.sunEl; return l; };
  const applySun = (id: PassId) => {
    const pipe = passes[id]; if (!pipe) return;
    if (id === 'pass3') (pipe as Pass3).setLook(currentLook()); else (pipe as Pass0).setSun(settings.sunAz, settings.sunEl);
  };
  const ensure = (id: PassId) => {
    if (!passes[id]) {
      passes[id] = id === 'pass0' ? new Pass0(canvases[id], world.geometry)
        : id === 'pass1' ? new Pass1(canvases[id], world.geometry)
        : new Pass3(canvases[id], world3.staticGeo, world3.dynamicGeo);
    }
    applySun(id);
    return passes[id]!;
  };
  applySun('pass2');

  const fit = () => {
    const active = activeIds();
    // CSS grids can round neighboring columns to different pixel widths. Use one
    // shared buffer size so all three projections remain identical at odd sizes.
    const panes = active.map((id) => $(`${id}-pane`));
    const w = Math.max(1, Math.ceil(Math.min(...panes.map((pane) => pane.clientWidth)) / settings.pixel));
    const h = Math.max(1, Math.ceil(Math.min(...panes.map((pane) => pane.clientHeight)) / settings.pixel));
    for (const id of active) {
      const canvas = canvases[id];
      const pipe = passes[id]!;
      if (pipe.width !== w || pipe.height !== h) pipe.resize(w, h);
      canvas.style.width = `${w * settings.pixel}px`; canvas.style.height = `${h * settings.pixel}px`;
    }
    dirty = true;
  };
  const syncControls = () => {
    const hasAtmosphere = mode === 'pass2' || mode === 'compare';
    $('atmosphere-controls').classList.toggle('inactive', !hasAtmosphere);
    $('atmosphere-controls').querySelectorAll<HTMLInputElement>('input').forEach((el) => (el.disabled = !hasAtmosphere));
    const hasPass3 = mode === 'pass3' || mode === 'compare';
    $('pass3-controls').classList.toggle('inactive', !hasPass3);
    $('pass3-controls').querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach((el) => (el.disabled = !hasPass3));
    $<HTMLInputElement>('contacts').disabled = mode === 'pass0';
    $('contacts').closest('label')!.classList.toggle('inactive', mode === 'pass0');
    $('cleanup-note').textContent = hasAtmosphere && atmosphere.enabled ? 'Pass 2 keeps haze smooth; clean-up applies to Pass 0 / 1.' : 'Shared controls; atmosphere and softer lighting belong to Pass 2.';
  };
  const setMode = (next: Mode) => {
    mode = next;
    document.body.dataset.mode = mode; syncLayout();
    activeIds().forEach(ensure);
    for (const id of [...ids, 'compare']) $(`mode-${id}`).setAttribute('aria-pressed', String(mode === id));
    syncControls(); fit();
  };
  const setSplit = (index: number, value: number) => {
    splits[index] = THREE.MathUtils.clamp(value, index === 0 ? 0 : splits[index - 1], index === splits.length - 1 ? 100 : splits[index + 1]);
    splits.forEach((v, i) => {
      document.body.style.setProperty(`--split${i}`, `${v}%`);
      $<HTMLInputElement>(`split${i}`).value = String(v);
      $(`divider${i}`).setAttribute('aria-valuenow', String(Math.round(v)));
    });
  };
  for (const id of [...ids, 'compare'] as const) $(`mode-${id}`).onclick = () => setMode(id);
  $<HTMLSelectElement>('layout').value = layout;
  $('layout').onchange = () => {
    layout = $<HTMLSelectElement>('layout').value as Layout;
    syncLayout(); fit();
  };
  for (let i = 0; i < 3; i++) {
    $<HTMLInputElement>(`split${i}`).oninput = (e) => setSplit(i, +(e.target as HTMLInputElement).value);
    const divider = $(`divider${i}`);
    divider.onpointerdown = (e) => { divider.setPointerCapture(e.pointerId); setSplit(i, e.clientX / innerWidth * 100); };
    divider.onpointermove = (e) => { if (divider.hasPointerCapture(e.pointerId)) setSplit(i, e.clientX / innerWidth * 100); };
    divider.onkeydown = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setSplit(i, splits[i] + (e.key === 'ArrowLeft' ? -2 : 2)); }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setSplit(i, e.key === 'Home' ? 0 : 100); }
    };
  }
  splits.forEach((v, i) => setSplit(i, v)); setMode(mode);
  addEventListener('resize', fit);

  const bind = (id: string, key: 'outlines' | 'dither' | 'cleanup' | 'clouds' | 'contacts') => {
    const el = $<HTMLInputElement>(id); el.checked = settings[key];
    el.onchange = () => { settings[key] = el.checked; };
  };
  bind('outlines', 'outlines'); bind('dither', 'dither'); bind('cleanup', 'cleanup'); bind('clouds', 'clouds'); bind('contacts', 'contacts');
  const fog = $<HTMLInputElement>('fog'); fog.checked = atmosphere.enabled;
  fog.onchange = () => { atmosphere.enabled = fog.checked; syncControls(); };
  for (const [id, key] of [['fog-start', 'start'], ['fog-end', 'end'], ['haze', 'strength'], ['ink', 'ink']] as const) {
    const el = $<HTMLInputElement>(id); el.value = String(atmosphere[key]);
    const update = () => { atmosphere[key] = +el.value; $<HTMLOutputElement>(`${id}-value`).value = key === 'strength' || key === 'ink' ? `${Math.round(+el.value * 100)}%` : el.value; };
    el.oninput = update; update();
  }
  const fogColor = $<HTMLInputElement>('fog-color'); fogColor.value = atmosphere.color;
  fogColor.oninput = () => { atmosphere.color = fogColor.value; };
  const autoEl = $<HTMLInputElement>('auto'); autoEl.checked = auto; autoEl.onchange = () => (auto = autoEl.checked);
  const px = $<HTMLSelectElement>('pixel');
  if (![...px.options].some((o) => +o.value === settings.pixel)) px.add(new Option(String(settings.pixel), String(settings.pixel)));
  px.value = String(settings.pixel); px.onchange = () => { settings.pixel = +px.value; fit(); };
  const sun = $<HTMLInputElement>('sun'); sun.value = String(settings.sunAz);
  const applyAllSuns = () => { ids.forEach(applySun); dirty = true; };
  sun.oninput = () => { settings.sunAz = +sun.value; applyAllSuns(); };
  // The hour drives Pass 3's grade, and moves the sun for every pass so lighting stays comparable.
  const setHour = (h: number, moveSun = true) => {
    hour = ((h % 24) + 24) % 24;
    if (moveSun) { const l = lookAt(hour); settings.sunAz = l.sunAz; settings.sunEl = l.sunEl; sun.value = String(Math.round(l.sunAz)); }
    const nearest = Object.entries(PRESETS).sort((a, b) => Math.abs(a[1] - hour) - Math.abs(b[1] - hour))[0];
    $<HTMLOutputElement>('hour-value').value = `${nearest[0]} ${hourLabel(hour)}`;
    $<HTMLInputElement>('hour').value = String(hour);
    applyAllSuns();
  };
  for (const [name, h] of Object.entries(PRESETS)) {
    const b = document.createElement('button'); b.textContent = name;
    b.onclick = () => { cycle = false; $<HTMLInputElement>('cycle').checked = false; setHour(h); };
    $('presets').append(b);
  }
  $<HTMLInputElement>('hour').oninput = (e) => setHour(+(e.target as HTMLInputElement).value);
  const cyc = $<HTMLInputElement>('cycle'); cyc.checked = cycle; cyc.onchange = () => (cycle = cyc.checked);
  for (const key of ['animate', 'glow', 'vignette'] as const) {
    const el = $<HTMLInputElement>(key); el.checked = settings[key]; el.onchange = () => { settings[key] = el.checked; dirty = true; };
  }
  setHour(hour, false);
  const turn = (delta: number) => { target.az = Math.round(target.az / (45 * DEG)) * 45 * DEG + delta * 45 * DEG; autoPausedUntil = performance.now() + 4000; };
  $('rotL').onclick = () => turn(-1); $('rotR').onclick = () => turn(1);
  $('close-view').onclick = () => { target.size = 11.5; target.el = 38 * DEG; };
  $('landscape').onclick = () => { target.size = 23; target.el = 32 * DEG; };
  $('stats').textContent = `Passes 0–2: ${(world.triangles / 1000).toFixed(0)}k tris · ${world.paletteColors} base colors. Pass 3: ${(world3.triangles / 1000).toFixed(0)}k tris · ${world3.paletteColors} base colors (adds pond, leaf-clump trees, motion).`;

  let drag: { x: number; y: number; pan: boolean; height: number } | null = null;
  for (const id of ids) {
    const canvas = canvases[id];
    canvas.oncontextmenu = (e) => e.preventDefault();
    canvas.onpointerdown = (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2, height: $(`${id}-pane`).clientHeight }; autoPausedUntil = performance.now() + 4000; };
    canvas.onpointerup = canvas.onpointercancel = () => (drag = null);
    canvas.onpointermove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        const k = passes[id]!.viewHeight / drag.height, sn = Math.max(Math.sin(view.el), 0.3), ca = Math.cos(view.az), sa = Math.sin(view.az);
        target.tx = THREE.MathUtils.clamp(target.tx + (-ca * dx - sa * dy / sn) * k, -9, 10);
        target.tz = THREE.MathUtils.clamp(target.tz + (sa * dx - ca * dy / sn) * k, -8, 8);
      } else { target.az -= dx * 0.0075; target.el = THREE.MathUtils.clamp(target.el + dy * 0.005, 28 * DEG, 76 * DEG); }
    };
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); target.size = THREE.MathUtils.clamp(target.size * Math.exp(e.deltaY * 0.0012), 5, 30); }, { passive: false });
  }
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input, select, button')) return;
    if (e.key === 'ArrowLeft' || e.key === 'a') turn(-1);
    if (e.key === 'ArrowRight' || e.key === 'd') turn(1);
    if (e.key === 'h') { document.body.classList.toggle('clean'); fit(); }
  });

  let last = performance.now(), time = 0;
  const focus = new THREE.Vector3();
  const render = () => {
    const active = activeIds();
    const clock = params.has('time') ? num('time', 0) : time;
    const first = passes[active[0]]!;
    const viewHeight = view.size * Math.max(1, 1.15 / (first.width / first.height));
    focus.set(view.tx, GROUND_Y + 1.3, view.tz);
    for (const id of active) {
      // Pass 3's world moves, so it re-rasterises every frame while "Living world" is on.
      if (!dirty && !(id === 'pass3' && settings.animate)) continue;
      passes[id]!.placeCamera(focus, view.az, view.el, viewHeight);
      if (id === 'pass3') (passes[id] as Pass3).renderGeometry(clock); else (passes[id] as Pass0).renderGeometry();
    }
    dirty = false;
    for (const id of active) passes[id]!.renderStyle(settings, clock);
  };
  $('shot').onclick = () => {
    render();
    const output = document.createElement('canvas');
    const active = activeIds(), first = canvases[active[0]];
    const panels = mode === 'compare' && layout !== 'wipe';
    const stacked = panels && innerWidth <= 700;
    const cols = stacked ? 1 : layout === 'grid' ? 2 : ids.length, rows = Math.ceil(ids.length / cols);
    output.width = first.width * (panels ? cols : 1);
    output.height = first.height * (panels ? rows : 1);
    const ctx = output.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    if (mode !== 'compare') ctx.drawImage(first, 0, 0);
    else if (panels) ids.forEach((id, i) => ctx.drawImage(canvases[id], (i % cols) * first.width, Math.floor(i / cols) * first.height, first.width, first.height));
    else {
      ctx.drawImage(canvases.pass3, 0, 0);
      for (const [id, end] of [['pass2', splits[2]], ['pass1', splits[1]], ['pass0', splits[0]]] as const) {
        const w = Math.round(output.width * end / 100);
        if (w > 0) ctx.drawImage(canvases[id], 0, 0, w, output.height, 0, 0, w, output.height);
      }
    }
    // Label exported comparisons so the three renderers remain identifiable.
    if (mode === 'compare') {
      ctx.font = '10px monospace';
      ids.forEach((_id, i) => {
        const x = panels ? (i % cols) * first.width + 4 : Math.round(output.width * (i === 0 ? 0 : splits[i - 1]) / 100) + 4;
        const y = panels ? Math.floor(i / cols) * first.height + 4 : 4;
        ctx.fillStyle = '#fff9e9'; ctx.fillRect(x, y, 48, 17); ctx.fillStyle = '#493c32'; ctx.fillText(`Pass ${i}`, x + 4, y + 12);
      });
    }
    const a = document.createElement('a'); a.download = `cookie-co-${mode}${mode === 'compare' ? '-' + layout : ''}.png`; a.href = output.toDataURL('image/png'); a.click();
  };
  (window as any).app = { passes, atmosphere, settings, view, target, world, world3, setHour, get mode() { return mode; }, get layout() { return layout; }, setMode, render, redraw: () => (dirty = true) };
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (settings.animate) time += dt;
    if (cycle) setHour(hour + dt * 0.45);
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
