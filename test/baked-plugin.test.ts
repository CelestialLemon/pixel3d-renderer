import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bakeFingerprint } from '../tools/baked-plugin.ts';

test('prop metadata edits, additions and removals invalidate a scene bake', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pixel3d-bake-fingerprint-'));
  try {
    for (const dir of ['src/scenes', 'src/renderer', 'public', 'assets/props/box', 'node_modules/three']) {
      await mkdir(join(root, dir), { recursive: true });
    }
    await writeFile(join(root, 'node_modules/three/package.json'), JSON.stringify({ version: '0.180.0' }));
    const metadata = join(root, 'assets/props/box/metadata.json');
    const original = JSON.stringify({ id: 'box', dimensionsMetres: [1, 1, 1] });
    await writeFile(metadata, original);
    const baked = await bakeFingerprint(root);
    await writeFile(metadata, JSON.stringify({ id: 'box', dimensionsMetres: [2, 1, 1] }));
    assert.notEqual(await bakeFingerprint(root), baked, 'changing placement dimensions makes the bake stale');
    await writeFile(metadata, original);
    assert.equal(await bakeFingerprint(root), baked, 'restoring the input restores its fingerprint');
    const added = join(root, 'assets/props/lantern');
    await mkdir(added);
    await writeFile(join(added, 'metadata.json'), JSON.stringify({ id: 'lantern', dimensionsMetres: [1, 2, 1] }));
    assert.notEqual(await bakeFingerprint(root), baked, 'adding a gallery prop invalidates the bake');
    await rm(added, { recursive: true });
    assert.equal(await bakeFingerprint(root), baked);
    await rm(metadata);
    assert.notEqual(await bakeFingerprint(root), baked, 'removing a gallery prop invalidates the bake');
  } finally { await rm(root, { recursive: true, force: true }); }
});
