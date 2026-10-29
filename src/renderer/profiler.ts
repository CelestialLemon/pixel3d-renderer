import type * as THREE from 'three';

/**
 * The renderer's logical passes, in frame order. `shadowMaps`: the sun and moving-object shadow maps and the lamp atlas,
 * whenever one is redrawn; `gbuffer`: the scene into the supersampled G-buffer; `shadowMask`: the scene again into the
 * sun-shadow mask; `resolve`: the supersampled targets down to art pixels; `fluid` and `glass`: their own G-buffers, while
 * drawn; `post0`: lighting, outlines, contacts and clouds; `post1`: the fluids over it, while any are drawn; `cleanup`: the
 * last pass, to the canvas; `pick`: the scene behind a see-through object, rendered by a pick.
 */
export type RenderPass = 'shadowMaps' | 'gbuffer' | 'shadowMask' | 'resolve' | 'fluid' | 'glass' | 'post0' | 'post1' | 'cleanup' | 'pick';

/** What to measure (`PixelRenderer.setProfiling`). Both default to false. */
export interface ProfilingOptions {
  /** Count per frame what the renderer submits (`FrameStats`). */
  counters?: boolean;
  /** Time each pass on the GPU (`GpuTiming`), where `EXT_disjoint_timer_query_webgl2` is available. */
  gpu?: boolean;
}

/** One frame's counters: everything submitted since the previous `renderStyle`, up to the end of this one. */
export interface FrameStats {
  /** Frames (`renderStyle` calls) since profiling was switched on, from 1. A `GpuTiming` of the same frame has the same number. */
  frame: number;
  /** Draw calls, including the shadow maps and the fullscreen passes (three's `info.render.calls`). */
  draws: number;
  /** Triangles those draws submitted (three's `info.render.triangles`). */
  triangles: number;
  /** Meshes three set up a program for (`renderBufferDirect` calls), whether or not they then drew anything. */
  meshVisits: number;
  /** Shadow maps redrawn: the sun's, the moving objects' and the lamp atlas, each counted once per redraw. */
  shadowMapRedraws: number;
  /** `pick`, `pickPixel`, `requestPick` and `requestPickPixel` calls. */
  picks: number;
}

/** One frame's GPU time per pass, in milliseconds, delivered a few frames after it was drawn. */
export interface GpuTiming {
  /** The frame, numbered as `FrameStats.frame`. */
  frame: number;
  /** The passes the frame ran (a frame without `renderGeometry` has only the post passes). */
  passes: Partial<Record<RenderPass, number>>;
  /** Their sum. */
  total: number;
}

/** Frames whose queries may wait for the GPU at once; frames past that go untimed rather than queue more. */
const MAX_PENDING_FRAMES = 8;
/** Finished timings kept for `takeGpuTimings`; older ones are dropped. */
const MAX_TIMINGS = 120;

interface TimerQueryExt { readonly TIME_ELAPSED_EXT: number; readonly GPU_DISJOINT_EXT: number }
interface Segment { pass: RenderPass; query: WebGLQuery }

type ShadowRender = (lights: THREE.Light[], scene: THREE.Scene, camera: THREE.Camera) => void;
type BufferDirect = (...args: unknown[]) => void;

/**
 * The renderer's opt-in diagnostics, alive only while switched on: off, the renderer holds none and three is untouched.
 * GPU time is measured with timer queries that are polled, never waited for. A pass can be several queries (a shadow map
 * three redraws inside the G-buffer render suspends the G-buffer's), summed when all are back; a frame the GPU reports
 * disjoint (`GPU_DISJOINT_EXT`) is dropped.
 */
export class Profiler {
  readonly counters: boolean;
  /** GPU timing was asked for and the context supports it. */
  readonly gpu: boolean;
  private frame = 0;
  private visits = 0;
  private redraws = 0;
  private picks = 0;
  private last: FrameStats | null = null;
  private readonly infoAutoReset: boolean;
  /** What was wrapped, kept to give back: three replaces its info and shadow map when a lost context is restored. */
  private readonly info: THREE.WebGLInfo;
  private readonly shadowMap: THREE.WebGLShadowMap;
  private readonly shadowRender: ShadowRender;
  private readonly bufferDirect?: BufferDirect;

  private readonly gl: WebGL2RenderingContext;
  private readonly ext: TimerQueryExt | null = null;
  /** The passes begun and not yet ended, innermost last: only the innermost has a query running. */
  private stack: RenderPass[] = [];
  private segments: Segment[] = [];
  /** Whether this frame is timed: decided at its first pass, so a frame is timed whole or not at all. */
  private timed: boolean | null = null;
  private pending: { frame: number; segments: Segment[] }[] = [];
  private timings: GpuTiming[] = [];

  constructor(private readonly renderer: THREE.WebGLRenderer, options: ProfilingOptions) {
    this.counters = options.counters ?? false;
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    if (options.gpu) this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
    this.gpu = this.ext !== null;
    const r = renderer as THREE.WebGLRenderer & { renderBufferDirect: BufferDirect };
    this.info = r.info; this.infoAutoReset = r.info.autoReset;
    if (this.counters) {
      // Three resets its counts at each render, after it has drawn the shadow maps: count the whole frame instead.
      r.info.autoReset = false; r.info.reset();
      const bufferDirect = this.bufferDirect = r.renderBufferDirect;
      r.renderBufferDirect = (...args) => { this.visits++; bufferDirect.apply(r, args); };
    }
    // A shadow map is redrawn inside a scene render, so it is counted and timed from three's call.
    const sm = this.shadowMap = r.shadowMap, shadowRender = this.shadowRender = sm.render as ShadowRender;
    sm.render = (lights, scene, camera) => {
      if (!sm.enabled || (!sm.autoUpdate && !sm.needsUpdate) || !lights.length) return shadowRender.call(sm, lights, scene, camera);
      for (const l of lights) { const s = (l as THREE.DirectionalLight).shadow; if (s && (s.autoUpdate || s.needsUpdate)) this.redraws++; }
      this.begin('shadowMaps');
      try { shadowRender.call(sm, lights, scene, camera); } finally { this.end(); }
    };
  }

  /** Give three back what was wrapped and free the queries (`lost`: the context is lost, and its queries with it). */
  dispose(lost = false) {
    const r = this.renderer as THREE.WebGLRenderer & { renderBufferDirect: BufferDirect };
    if (this.bufferDirect) { r.renderBufferDirect = this.bufferDirect; this.info.autoReset = this.infoAutoReset; }
    this.shadowMap.render = this.shadowRender;
    if (lost) { this.stack = []; this.segments = []; this.pending = []; return; }
    if (this.stack.length) { this.gl.endQuery(this.ext!.TIME_ELAPSED_EXT); this.stack = []; }
    this.dropQueries();
  }

  /** A shadow map the renderer draws itself (the lamp atlas). */
  countShadowMap() { this.redraws++; }
  countPick() { this.picks++; }

  /** Start timing `pass` (suspending the pass it runs inside). Every `begin` needs an `end`. */
  begin(pass: RenderPass) {
    if (!this.ext) return;
    this.timed ??= this.pending.length < MAX_PENDING_FRAMES;
    if (!this.timed) return;
    if (this.stack.length) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.stack.push(pass);
    this.start(pass);
  }

  end() {
    if (!this.ext || !this.timed || !this.stack.length) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.stack.pop();
    if (this.stack.length) this.start(this.stack[this.stack.length - 1]);
  }

  private start(pass: RenderPass) {
    const query = this.gl.createQuery();
    if (!query) return;   // a lost context
    this.gl.beginQuery(this.ext!.TIME_ELAPSED_EXT, query);
    this.segments.push({ pass, query });
  }

  /** The frame ends (after `renderStyle`'s last pass): close its counters and queue its queries. */
  endFrame() {
    this.frame++;
    if (this.counters) {
      const info = this.info.render;
      this.last = { frame: this.frame, draws: info.calls, triangles: info.triangles, meshVisits: this.visits, shadowMapRedraws: this.redraws, picks: this.picks };
      this.info.reset();
    }
    this.visits = this.redraws = this.picks = 0;
    if (this.ext && this.stack.length) { this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.stack = []; }   // a pass that threw
    if (this.segments.length) this.pending.push({ frame: this.frame, segments: this.segments });
    this.segments = []; this.timed = null;
  }

  get stats(): FrameStats | null { return this.last; }

  /** Collect the frames whose queries are all back, oldest first, without waiting. */
  poll() {
    const gl = this.gl, ext = this.ext;
    if (!ext || !this.pending.length) return;
    // Disjoint: some timing in flight may be wrong (a clock change, a context switch). Drop everything not yet read,
    // the frame being drawn included.
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { this.dropQueries(); return; }
    while (this.pending.length) {
      const { frame, segments } = this.pending[0];
      if (!segments.every((s) => gl.getQueryParameter(s.query, gl.QUERY_RESULT_AVAILABLE))) break;
      const passes: Partial<Record<RenderPass, number>> = {};
      let total = 0;
      for (const { pass, query } of segments) {
        const ms = (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6;
        passes[pass] = (passes[pass] ?? 0) + ms; total += ms;
        gl.deleteQuery(query);
      }
      this.pending.shift();
      this.timings.push({ frame, passes, total });
      if (this.timings.length > MAX_TIMINGS) this.timings.shift();
    }
  }

  takeTimings(): GpuTiming[] { const t = this.timings; this.timings = []; return t; }

  /** Delete every query not yet read, the running frame's too: the rest of that frame goes untimed. */
  private dropQueries() {
    for (const s of [...this.segments, ...this.pending.flatMap((p) => p.segments)]) this.gl.deleteQuery(s.query);
    this.segments = []; this.pending = [];
    if (this.timed) this.timed = false;
  }
}
