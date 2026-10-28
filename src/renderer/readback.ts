import * as THREE from 'three';

type Read = { count: number; sync: WebGLSync; buffer: WebGLBuffer; done: (data: Float32Array | null) => void };

/**
 * Non-blocking readback of one RGBA float pixel from each colour attachment of a render target, through a pixel-pack buffer of
 * its own and one fence per read. Reads are issued at once and delivered by `poll`, in order, once the GPU has passed the
 * fence. Unlike three's `readRenderTargetPixelsAsync`, the pack buffer is unbound again before `read` returns, so a synchronous
 * `readPixels` in the meantime still reads into memory.
 */
export class PixelReadback {
  private reads: Read[] = [];

  constructor(private readonly r: THREE.WebGLRenderer) {}

  private framebuffer(t: THREE.WebGLRenderTarget) { return (this.r.properties.get(t) as { __webglFramebuffer: WebGLFramebuffer }).__webglFramebuffer; }

  /** Start reading pixel (x, y) of the first `count` attachments of `target`; `done` gets 4 floats per attachment, or null if cancelled. */
  read(target: THREE.WebGLRenderTarget, x: number, y: number, count: number, done: Read['done']) {
    const r = this.r, gl = r.getContext() as WebGL2RenderingContext;
    const framebuffer = this.framebuffer(target);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, count * 16, gl.STREAM_READ);
    r.state.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    for (let i = 0; i < count; i++) {
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, i * 16);
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const current = r.getRenderTarget();
    r.setRenderTarget(current, r.getActiveCubeFace(), r.getActiveMipmapLevel());   // three binds the framebuffer it uses for it
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
    gl.flush();
    this.reads.push({ count, sync, buffer, done });
  }

  /** Deliver every read the GPU has finished (in order; one that is not ready holds back those after it). Never waits. */
  poll() {
    const gl = this.r.getContext() as WebGL2RenderingContext;
    while (this.reads.length) {
      const { count, sync, buffer, done } = this.reads[0];
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) return;
      this.reads.shift();
      let data: Float32Array | null = null;
      if (status !== gl.WAIT_FAILED) {
        data = new Float32Array(count * 4);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      }
      gl.deleteSync(sync); gl.deleteBuffer(buffer);
      done(data);
    }
  }

  /** Drop every read in flight; each `done` gets null. */
  cancel() {
    const gl = this.r.getContext() as WebGL2RenderingContext, reads = this.reads;
    this.reads = [];
    for (const { sync, buffer, done } of reads) { gl.deleteSync(sync); gl.deleteBuffer(buffer); done(null); }
  }
}
