import * as THREE from 'three';
import { PixelPipeline as Pass0 } from '../reference/pass0/pipeline';
import { PixelPipeline as Pass1, type Settings as RefSettings } from '../reference/pass1/pipeline';
import { buildWorld, type World } from '../reference/world';
import { DEFAULT_PALETTE_SIZE, PixelRenderer, type Look, type PixelScene, type RenderSettings } from '../renderer';
import { cookieCo } from '../scenes/cookie-co';
import { num, paletteSize } from './params';

/** One renderer as the demo pages drive it. Wraps the frozen reference pipelines and the current renderer alike. */
export interface PassView {
  readonly width: number; readonly height: number; readonly viewHeight: number;
  readonly sun: THREE.Vector3; readonly camera: THREE.OrthographicCamera;
  /** True if the geometry moves with the clock and must be re-rasterised every frame while animating. */
  readonly animated: boolean;
  resize(w: number, h: number): void;
  placeCamera(target: THREE.Vector3, azimuth: number, elevation: number, viewHeight: number): void;
  setLook(look: Look): void;
  renderGeometry(time: number): void;
  renderStyle(s: RenderSettings, time: number): void;
}

/** Scenes the passes draw, built once per page. */
export interface PassAssets { reference: World; scene: PixelScene }

export const loadAssets = async (): Promise<PassAssets> => {
  const [reference, scene] = await Promise.all([buildWorld('/cookie_factory.glb', num('k', 44)), cookieCo.build(paletteSize('k3', DEFAULT_PALETTE_SIZE))]);
  return { reference, scene };
};

/** The frozen reference pipelines only know a sun direction; they ignore the rest of the look. */
class ReferenceView implements PassView {
  readonly animated = false;
  constructor(private pipe: Pass0 | Pass1) {}
  get width() { return this.pipe.width; } get height() { return this.pipe.height; } get viewHeight() { return this.pipe.viewHeight; }
  get sun() { return this.pipe.sun; } get camera() { return this.pipe.camera; }
  resize(w: number, h: number) { this.pipe.resize(w, h); }
  placeCamera(target: THREE.Vector3, az: number, el: number, viewHeight: number) { this.pipe.placeCamera(target, az, el, viewHeight); }
  setLook(look: Look) { this.pipe.setSun(look.sunAz, look.sunEl); }
  renderGeometry() { this.pipe.renderGeometry(); }
  renderStyle(s: RenderSettings, time: number) {
    const settings: RefSettings = { pixel: 1, outlines: s.outlines, dither: s.dither, cleanup: s.cleanup, clouds: s.clouds, contacts: s.contacts, sunAz: 0, sunEl: 0 };
    this.pipe.renderStyle(settings, time);
  }
}

class CurrentView implements PassView {
  readonly animated = true;
  constructor(readonly pipe: PixelRenderer) {}
  get width() { return this.pipe.width; } get height() { return this.pipe.height; } get viewHeight() { return this.pipe.viewHeight; }
  get sun() { return this.pipe.sun; } get camera() { return this.pipe.camera; }
  resize(w: number, h: number) { this.pipe.resize(w, h); }
  placeCamera(target: THREE.Vector3, az: number, el: number, viewHeight: number) { this.pipe.placeCamera(target, az, el, viewHeight); }
  setLook(look: Look) { this.pipe.setLook(look); }
  renderGeometry(time: number) { this.pipe.renderGeometry(time); }
  renderStyle(s: RenderSettings, time: number) { this.pipe.renderStyle(s, time); }
}

export interface PassDef {
  id: string;
  label: string;
  subtitle: string;
  /** One line for exported comparison sheets. */
  summary: string;
  create(canvas: HTMLCanvasElement, assets: PassAssets): PassView;
}

/** The passes in the comparison page, oldest first. Pass 2 (Atmosphere) is archived in archive/pass2-atmosphere/. */
export const PASSES: PassDef[] = [
  { id: 'pass0', label: 'Pass 0', subtitle: 'Original', summary: 'Original renderer, preserved',
    create: (canvas, a) => new ReferenceView(new Pass0(canvas, a.reference.geometry)) },
  { id: 'pass1', label: 'Pass 1', subtitle: 'Refined', summary: 'Refined shadows, colors, contacts and edges',
    create: (canvas, a) => new ReferenceView(new Pass1(canvas, a.reference.geometry)) },
  { id: 'pass3', label: 'Pass 3', subtitle: 'Golden Hour', summary: 'Living world, time of day, lamp light, leaf clumps',
    create: (canvas, a) => new CurrentView(new PixelRenderer(canvas, a.scene)) },
];
