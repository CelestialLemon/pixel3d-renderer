// Run each deterministic model script in a fresh Blender process.
// node assets/props/build-all.mjs [--verify] [prop-id ...]
// --verify requires existing GLBs and compares SHA-256 before/after each rebuild.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = fileURLToPath(new URL('./', import.meta.url));
const blender = process.env.BLENDER_PATH || '/opt/homebrew/bin/blender';
const verify = process.argv.includes('--verify');
const requested = process.argv.slice(2).filter(s => !s.startsWith('--'));
const names = requested.length ? requested : readdirSync(source, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !entry.name.startsWith('_') && entry.name !== 'review')
  .map(entry => entry.name).sort();
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
for (const name of names) {
  assert(/^[a-z][a-z0-9_]*$/.test(name), 'Invalid prop id');
  const glb = `${root}/public/props/${name}.glb`;
  const before = verify ? hash(glb) : null;
  let stdout;
  try {
    stdout = execFileSync(blender, ['-b', '--python-exit-code', '1', '--python', `${source}/${name}/build.py`],
      { cwd: root, encoding: 'utf8', maxBuffer: 10*1024*1024 });
  } catch (error) {
    console.error(error.stdout?.toString() ?? '', error.stderr?.toString() ?? '');
    throw error;
  }
  const ready = stdout.split('\n').find(line => line.startsWith('PROP_READY'));
  assert(ready, `${name}: Blender completed the export and preview`);
  if (verify) assert.equal(hash(glb), before, `${name}: deterministic GLB rebuild`);
  console.log(ready, verify ? '(identical GLB SHA-256)' : '');
}
