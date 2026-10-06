import * as THREE from 'three';
import { DEFAULT_DAY_CYCLE, hourLabel, type Look, type RenderSettings } from '../../renderer';
import { cookieCo } from '../../scenes/cookie-co';
import { Orbit } from '../orbit';
import { $, num, params, settingsFromParams } from '../params';
import { loadAssets, PASSES, type PassView } from '../passes';

// The comparison page: every pass in PASSES draws the same Cookie Co. view with one shared camera, sun,
// art-pixel size and clock, side by side (grid) or stacked with draggable boundaries (wipe).

type Mode = string; // a pass id, or 'compare'
type Layout = 'grid' | 'wipe';
const ids = PASSES.map((p) => p.id);
const requested = params.get('mode');
let mode: Mode = ids.includes(requested!) ? requested! : 'compare';
let layout: Layout = params.get('layout') === 'wipe' ? 'wipe' : 'grid';
const day = cookieCo.look ?? DEFAULT_DAY_CYCLE;
let hour = num('hour', cookieCo.hour ?? 17.5), cycle = params.get('cycle') === '1', dirty = true;
const initialLook = day.lookAt(hour);
const settings: RenderSettings & { pixel: number; animate: boolean; sunAz: number; sunEl: number } = {
  ...settingsFromParams(),
  pixel: THREE.MathUtils.clamp(num('px', mode === 'compare' && layout === 'grid' ? 2 : 3), 1, 8), animate: params.get('anim') !== '0',
  sunAz: num('sun', initialLook.sunAz), sunEl: num('sunEl', initialLook.sunEl),
};
const splits = PASSES.slice(1).map((_, i) => Math.round(((i + 1) * 100) / PASSES.length));
const orbit = new Orbit(cookieCo.view);
if (params.has('clean-ui')) document.body.classList.add('clean');

// ---- DOM for each pass: pane + canvas + label, mode button, wipe divider and slider ----
const canvases: Record<string, HTMLCanvasElement> = {};
PASSES.forEach((p, i) => {
  const pane = document.createElement('section');
  pane.id = `${p.id}-pane`; pane.className = 'pane'; pane.setAttribute('aria-label', `${p.label} — ${p.subtitle}`);
  pane.style.zIndex = String(PASSES.length - i);
  const canvas = canvases[p.id] = document.createElement('canvas');
  canvas.id = `${p.id}-view`; canvas.setAttribute('aria-label', `${p.label} interactive scene`);
  const label = document.createElement('div'); label.className = 'pass-label';
  label.innerHTML = `<b>${p.label}</b><span>${p.subtitle}</span>`;
  pane.append(canvas, label); $('stage').append(pane);
  const button = document.createElement('button'); button.id = `mode-${p.id}`; button.textContent = p.label;
  $('modes').insertBefore(button, $('mode-compare'));
  if (i === 0) return;
  const k = i - 1, next = PASSES[i - 1];
  const divider = document.createElement('button');
  divider.id = `divider${k}`; divider.className = 'divider'; divider.setAttribute('role', 'slider');
  divider.setAttribute('aria-label', `Boundary between ${next.label} and ${p.label}`);
  divider.setAttribute('aria-valuemin', '0'); divider.setAttribute('aria-valuemax', '100');
  divider.innerHTML = '<span>↔</span>';
  document.body.append(divider);
  const slider = document.createElement('label'); slider.htmlFor = `split${k}`;
  slider.innerHTML = `${next.label} / ${p.label}<input id="split${k}" type="range" min="0" max="100" />`;
  $('wipe-controls').append(slider);
});

async function main() {
  const assets = await loadAssets();
  const passes: Record<string, PassView> = {};
  const activeIds = () => (mode === 'compare' ? ids : [mode]);
  // One shared sun for every pass; the current renderer also takes its grade, sky and lamps from the hour.
  const currentLook = (): Look => ({ ...day.lookAt(hour), sunAz: settings.sunAz, sunEl: settings.sunEl });
  const ensure = (id: string) => {
    passes[id] ??= PASSES.find((p) => p.id === id)!.create(canvases[id], assets);
    passes[id].setLook(currentLook());
    return passes[id];
  };

  // Columns that give each pane the most usable picture (wide panes show more of the scene).
  const chooseColumns = (n: number, w: number, h: number) => {
    let best = 1, bestScore = -1;
    for (let c = 1; c <= n; c++) {
      const score = Math.min(h / Math.ceil(n / c), w / c / 1.15);
      if (score > bestScore + 1) { best = c; bestScore = score; }
    }
    return best;
  };
  let cols = 1;
  const fit = () => {
    const active = activeIds(), stage = $('stage');
    if (mode === 'compare' && layout === 'grid') {
      cols = chooseColumns(active.length, stage.clientWidth, stage.clientHeight);
      // Each pane spans two half-columns, so an incomplete last row can be centred.
      stage.style.gridTemplateColumns = `repeat(${cols * 2}, minmax(0, 1fr))`;
      stage.style.gridTemplateRows = `repeat(${Math.ceil(active.length / cols)}, minmax(0, 1fr))`;
      const rest = active.length % cols;
      active.forEach((id, i) => { $(`${id}-pane`).style.gridColumnStart = rest && i === active.length - rest ? String(cols - rest + 1) : ''; });
    }
    // Panes can differ by a pixel when the grid rounds; one shared buffer size keeps the projections identical.
    const panes = active.map((id) => $(`${id}-pane`));
    const w = Math.max(1, Math.ceil(Math.min(...panes.map((p) => p.clientWidth)) / settings.pixel));
    const h = Math.max(1, Math.ceil(Math.min(...panes.map((p) => p.clientHeight)) / settings.pixel));
    for (const id of active) {
      const pipe = passes[id];
      if (pipe.width !== w || pipe.height !== h) pipe.resize(w, h);
      canvases[id].style.width = `${w * settings.pixel}px`; canvases[id].style.height = `${h * settings.pixel}px`;
    }
    dirty = true;
  };
  const setMode = (next: Mode) => {
    mode = next;
    document.body.dataset.mode = mode === 'compare' ? 'compare' : 'single';
    for (const id of ids) $(`${id}-pane`).classList.toggle('shown', mode === 'compare' || mode === id);
    activeIds().forEach(ensure);
    for (const id of [...ids, 'compare']) $(`mode-${id}`).setAttribute('aria-pressed', String(mode === id));
    fit();
  };
  const setLayout = (next: Layout) => {
    layout = next; document.body.dataset.layout = layout; $<HTMLSelectElement>('layout').value = layout;
    fit();
  };
  const setSplit = (index: number, value: number) => {
    splits[index] = THREE.MathUtils.clamp(value, index === 0 ? 0 : splits[index - 1], index === splits.length - 1 ? 100 : splits[index + 1]);
    splits.forEach((v, i) => {
      $(`${ids[i]}-pane`).style.setProperty('--clip', `${100 - v}%`);
      $(`${ids[i + 1]}-pane`).style.setProperty('--label-left', `${v}%`);
      $(`divider${i}`).style.left = `${v}%`;
      $<HTMLInputElement>(`split${i}`).value = String(v);
      $(`divider${i}`).setAttribute('aria-valuenow', String(Math.round(v)));
    });
  };

  // ---- controls ----
  for (const id of [...ids, 'compare']) $(`mode-${id}`).onclick = () => setMode(id);
  $('layout').onchange = () => setLayout($<HTMLSelectElement>('layout').value as Layout);
  splits.forEach((_, i) => {
    $<HTMLInputElement>(`split${i}`).oninput = (e) => setSplit(i, +(e.target as HTMLInputElement).value);
    const divider = $(`divider${i}`);
    divider.onpointerdown = (e) => { divider.setPointerCapture(e.pointerId); setSplit(i, e.clientX / innerWidth * 100); };
    divider.onpointermove = (e) => { if (divider.hasPointerCapture(e.pointerId)) setSplit(i, e.clientX / innerWidth * 100); };
    divider.onkeydown = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setSplit(i, splits[i] + (e.key === 'ArrowLeft' ? -2 : 2)); }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setSplit(i, e.key === 'Home' ? 0 : 100); }
    };
  });
  splits.forEach((v, i) => setSplit(i, v));
  document.body.dataset.layout = layout; $<HTMLSelectElement>('layout').value = layout;
  setMode(mode);
  addEventListener('resize', fit);

  for (const key of ['outlines', 'dither', 'cleanup', 'clouds', 'contacts', 'animate', 'glow', 'vignette'] as const) {
    const el = $<HTMLInputElement>(key); el.checked = settings[key];
    el.onchange = () => { settings[key] = el.checked; dirty = true; };
  }
  const autoEl = $<HTMLInputElement>('auto'); autoEl.checked = orbit.auto; autoEl.onchange = () => (orbit.auto = autoEl.checked);
  const px = $<HTMLSelectElement>('pixel');
  if (![...px.options].some((o) => +o.value === settings.pixel)) px.add(new Option(String(settings.pixel), String(settings.pixel)));
  px.value = String(settings.pixel); px.onchange = () => { settings.pixel = +px.value; fit(); };
  const sun = $<HTMLInputElement>('sun'); sun.value = String(settings.sunAz);
  const applyLooks = () => { for (const id of Object.keys(passes)) passes[id].setLook(currentLook()); dirty = true; };
  sun.oninput = () => { settings.sunAz = +sun.value; applyLooks(); };
  // The hour drives the current renderer's grade, and moves the sun for every pass so the lighting stays comparable.
  const setHour = (h: number, moveSun = true) => {
    hour = ((h % 24) + 24) % 24;
    if (moveSun) { const l = day.lookAt(hour); settings.sunAz = l.sunAz; settings.sunEl = l.sunEl; sun.value = String(Math.round(l.sunAz)); }
    $<HTMLOutputElement>('hour-value').value = `${day.nearestPreset(hour)} ${hourLabel(hour)}`;
    $<HTMLInputElement>('hour').value = String(hour);
    applyLooks();
  };
  for (const [name, h] of Object.entries(day.presets)) {
    const b = document.createElement('button'); b.textContent = name;
    b.onclick = () => { cycle = false; $<HTMLInputElement>('cycle').checked = false; setHour(h); };
    $('presets').append(b);
  }
  $<HTMLInputElement>('hour').oninput = (e) => setHour(+(e.target as HTMLInputElement).value);
  const cyc = $<HTMLInputElement>('cycle'); cyc.checked = cycle; cyc.onchange = () => (cycle = cyc.checked);
  setHour(hour, false);
  cookieCo.view.presets.forEach((p, i) => {
    const b = document.createElement('button'); b.textContent = p.name; b.onclick = () => orbit.preset(i);
    $('view-presets').append(b);
  });
  $('rotL').onclick = () => orbit.turn(-1); $('rotR').onclick = () => orbit.turn(1);
  const ref = assets.reference, cur = assets.scene.stats;
  $('stats').textContent = `Passes 0–1: ${(ref.triangles / 1000).toFixed(0)}k tris · ${ref.paletteColors} base colors. Pass 3: ${(cur.triangles / 1000).toFixed(0)}k tris · ${cur.paletteColors} base colors (adds pond, leaf-clump trees, motion).`;

  orbit.attach($('stage'), (e) => {
    const pane = (e.target as HTMLElement).closest('.pane') as HTMLElement | null;
    const id = pane?.id.replace(/-pane$/, '') ?? activeIds()[0];
    return passes[id].viewHeight / (pane?.clientHeight ?? innerHeight);
  });
  orbit.bindKeys(() => { document.body.classList.toggle('clean'); fit(); });

  let last = performance.now(), time = 0;
  const focus = new THREE.Vector3();
  const render = () => {
    const active = activeIds();
    const clock = params.has('time') ? num('time', 0) : time;
    const first = passes[active[0]];
    const viewHeight = orbit.viewHeight(first.width / first.height);
    orbit.focus(focus);
    for (const id of active) {
      // The current renderer's world moves, so it re-rasterises every frame while animating.
      if (!dirty && !(passes[id].animated && settings.animate)) continue;
      passes[id].placeCamera(focus, orbit.view.az, orbit.view.el, viewHeight);
      passes[id].renderGeometry(clock);
    }
    dirty = false;
    for (const id of active) passes[id].renderStyle(settings, clock);
  };

  $('shot').onclick = () => {
    render();
    const active = activeIds(), first = canvases[active[0]], W = first.width, H = first.height;
    const out = document.createElement('canvas'), ctx = out.getContext('2d')!;
    const tiles: { id: string; x: number; y: number }[] = [];
    if (mode !== 'compare') tiles.push({ id: mode, x: 0, y: 0 });
    else if (layout === 'grid') {
      // Same arrangement as on screen, including the centred last row.
      const rest = active.length % cols;
      active.forEach((id, i) => {
        const offset = rest && i >= active.length - rest ? Math.round(((cols - rest) * W) / 2) : 0;
        tiles.push({ id, x: (i % cols) * W + offset, y: Math.floor(i / cols) * H });
      });
    }
    out.width = tiles.length ? W * (mode === 'compare' ? cols : 1) : W;
    out.height = tiles.length ? H * (Math.max(...tiles.map((t) => t.y)) / H + 1) : H;
    ctx.imageSmoothingEnabled = false;
    if (tiles.length) tiles.forEach((t) => ctx.drawImage(canvases[t.id], t.x, t.y));
    else {
      // wipe: last pass underneath, each earlier pass drawn up to its boundary
      ctx.drawImage(canvases[ids[ids.length - 1]], 0, 0);
      for (let i = splits.length - 1; i >= 0; i--) {
        const w = Math.round(W * splits[i] / 100);
        if (w > 0) ctx.drawImage(canvases[ids[i]], 0, 0, w, H, 0, 0, w, H);
      }
    }
    // Label comparisons so the passes stay identifiable.
    if (mode === 'compare') {
      ctx.font = '10px monospace';
      active.forEach((id, i) => {
        const t = tiles[i], x = t ? t.x + 4 : Math.round(W * (i === 0 ? 0 : splits[i - 1]) / 100) + 4, y = t ? t.y + 4 : 4;
        ctx.fillStyle = '#fff9e9'; ctx.fillRect(x, y, 48, 17); ctx.fillStyle = '#493c32'; ctx.fillText(PASSES[i].label, x + 4, y + 12);
      });
    }
    const a = document.createElement('a'); a.download = `cookie-co-${mode}${mode === 'compare' ? '-' + layout : ''}.png`; a.href = out.toDataURL('image/png'); a.click();
  };

  const app = {
    passes, settings, orbit, assets, setHour, setMode, setLayout, render, redraw: () => (dirty = true),
    get mode() { return mode; }, get layout() { return layout; }, get splits() { return [...splits]; },
  };
  (window as any).app = app;
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (settings.animate) time += dt;
    if (cycle) setHour(hour + dt * 0.45);
    if (orbit.step(dt, now)) dirty = true;
    render(); requestAnimationFrame(frame);
  };
  render(); requestAnimationFrame(frame);
  $('loading').classList.add('done'); (window as any).appReady = true;
  return app;
}

/** The page's `window.app`, for the tools that drive this page. */
export type CompareApp = Awaited<ReturnType<typeof main>>;

main().catch((e) => { console.error(e); $('loading').textContent = 'failed: ' + e.message; });
