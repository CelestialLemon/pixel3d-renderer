import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pkg from 'pixel3d-renderer';

test('the package entry point loads in Node and exports the public API', () => {
  for (const name of ['PixelRenderer', 'PixelObject', 'GeometryCollector', 'FluidCollector', 'quantizePalette', 'dayCycle', 'lookAt', 'resolveLimits', 'motion', 'loadGltf']) {
    assert.ok(name in pkg, `missing export ${name}`);
  }
  for (const internal of ['buildFluidMap', 'atlasLayout', 'POOL_NORMAL_Y']) assert.ok(!(internal in pkg), `${internal} should stay internal`);
});
