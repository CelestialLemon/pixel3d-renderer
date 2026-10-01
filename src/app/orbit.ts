import * as THREE from 'three';
import type { SceneView } from '../scenes';
import { num, params } from './params';

const DEG = Math.PI / 180;
type ViewState = { az: number; el: number; size: number; tx: number; tz: number };

/**
 * Damped orbit camera shared by the demo pages: drag to orbit, wheel to zoom, shift/right-drag to pan,
 * 45-degree turns, optional auto-orbit. `view` eases towards `target` every frame.
 * Query parameters: `view` (a scene preset name), then `az`, `el` (degrees), `zoom` (visible world height), `tx`, `tz`
 * (orbit target) override it; `auto=1`.
 */
export class Orbit {
  readonly view: ViewState;
  readonly target: ViewState;
  auto = params.get('auto') === '1';
  dragging = false;
  private pausedUntil = 0;

  constructor(readonly scene: SceneView) {
    const name = params.get('view')?.toLowerCase();
    const first = scene.presets.find((p) => p.name.toLowerCase() === name) ?? scene.presets[0];
    this.view = {
      az: num('az', first.az ?? scene.azimuth) * DEG, el: num('el', first.el) * DEG, size: num('zoom', first.size),
      tx: num('tx', first.tx ?? scene.target.x), tz: num('tz', first.tz ?? scene.target.z),
    };
    this.target = { ...this.view };
  }

  /** Point the camera looks at. */
  focus(out = new THREE.Vector3()) { return out.set(this.view.tx, this.scene.groundY + this.scene.target.height, this.view.tz); }

  /** Visible world height for a viewport of the given aspect: tall viewports widen the view so the scene still fits. */
  viewHeight(aspect: number) { return this.view.size * Math.max(1, 1.15 / aspect); }

  /** Snap to the nearest 45 degrees, then turn `delta` steps. */
  turn(delta: number) { this.target.az = Math.round(this.target.az / (45 * DEG)) * 45 * DEG + delta * 45 * DEG; this.pause(); }

  preset(index: number) {
    const p = this.scene.presets[index], t = this.target;
    t.size = p.size; t.el = p.el * DEG;
    if (p.tx !== undefined) t.tx = p.tx;
    if (p.tz !== undefined) t.tz = p.tz;
    if (p.az !== undefined) t.az = p.az * DEG;
  }

  /** Jump straight to the target (no easing). */
  snap() { Object.assign(this.view, this.target); }

  private pause() { this.pausedUntil = performance.now() + 4000; }

  /** Advance the easing (and auto-orbit) by `dt` seconds. Returns true if the view moved. */
  step(dt: number, now: number) {
    if (this.auto && now > this.pausedUntil && !this.dragging) this.target.az += dt * 0.22;
    const k = 1 - Math.exp(-dt * 14);
    let moved = false;
    for (const key of ['az', 'el', 'size', 'tx', 'tz'] as const) {
      const change = (this.target[key] - this.view[key]) * k;
      if (Math.abs(change) > 1e-6) moved = true;
      this.view[key] += change;
    }
    return moved;
  }

  /**
   * Pointer and wheel controls on `el`. `worldPerPixel(e)` converts screen pixels to world units for panning,
   * for the view under the pointer. Pointer-downs inside `.divider` elements are ignored.
   */
  attach(el: HTMLElement, worldPerPixel: (e: PointerEvent) => number) {
    let drag: { x: number; y: number; pan: boolean; k: number } | null = null;
    el.oncontextmenu = (e) => e.preventDefault();
    el.onpointerdown = (e) => {
      if ((e.target as HTMLElement).closest('.divider')) return;
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2, k: worldPerPixel(e) };
      this.dragging = true; this.pause();
    };
    el.onpointerup = el.onpointercancel = () => { drag = null; this.dragging = false; };
    el.onpointermove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      const t = this.target, pan = this.scene.pan;
      if (drag.pan) {
        const sn = Math.max(Math.sin(this.view.el), 0.3), ca = Math.cos(this.view.az), sa = Math.sin(this.view.az);
        t.tx = THREE.MathUtils.clamp(t.tx + (-ca * dx - sa * dy / sn) * drag.k, pan.minX, pan.maxX);
        t.tz = THREE.MathUtils.clamp(t.tz + (sa * dx - ca * dy / sn) * drag.k, pan.minZ, pan.maxZ);
      } else { t.az -= dx * 0.0075; t.el = THREE.MathUtils.clamp(t.el + dy * 0.005, 28 * DEG, 76 * DEG); }
    };
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.target.size = THREE.MathUtils.clamp(this.target.size * Math.exp(e.deltaY * 0.0012), 5, 30); }, { passive: false });
  }

  /** A/D or arrow keys turn 45 degrees; H calls `onToggleUi`. Ignored while a form control has focus. */
  bindKeys(onToggleUi: () => void) {
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).matches('input, select, button')) return;
      if (e.key === 'ArrowLeft' || e.key === 'a') this.turn(-1);
      if (e.key === 'ArrowRight' || e.key === 'd') this.turn(1);
      if (e.key === 'h') onToggleUi();
    });
  }
}
