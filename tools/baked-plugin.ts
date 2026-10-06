import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, sep, basename } from 'node:path';
import type { Plugin } from 'vite';

export interface BakeManifest {
  fingerprint: string;
  scenes: Record<string, { url: string; paletteSize: number; limits: Record<string, number> }>;
}

/** Content hash of every geometry-building input. Docs edits and generated outputs do not invalidate a bake. */
export async function bakeFingerprint(root: string): Promise<string> {
  const files: string[] = [];
  const walk = async (dir: string, accept: (path: string) => boolean) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'baked') await walk(path, accept); }
      else if (accept(path)) files.push(path);
    }
  };
  await walk(resolve(root, 'src/scenes'), (p) => p.endsWith('.ts'));
  await walk(resolve(root, 'src/renderer'), (p) => p.endsWith('.ts') && basename(p) !== 'index.ts');
  await walk(resolve(root, 'public'), (p) => p.endsWith('.glb'));
  // The props gallery reads dimensions and ids here to lay out its geometry and shadow bounds.
  await walk(resolve(root, 'assets/props'), (p) => basename(p) === 'metadata.json');
  const hash = createHash('sha256');
  const three = JSON.parse(await readFile(resolve(root, 'node_modules/three/package.json'), 'utf8')) as { version: string };
  hash.update(`three@${three.version}`);
  const names = files.map((file) => relative(root, file).split(sep).join('/')).sort();
  for (const name of names) { hash.update(name); hash.update(await readFile(resolve(root, name))); }
  return hash.digest('hex');
}

/** Dev stays live. Production requires a fresh bake and bundles only its manifest, never the large geometry files. */
export function bakedScenes(): Plugin {
  let root = '', production = false;
  return {
    name: 'pixel3d-baked-scenes',
    configResolved(config) { root = config.root; production = config.command === 'build'; },
    resolveId(id) { if (id === 'virtual:baked-scenes') return '\0virtual:baked-scenes'; },
    async load(id) {
      if (id !== '\0virtual:baked-scenes') return;
      if (!production) return 'export default {}';
      const path = resolve(root, 'public/baked/manifest.json');
      let content: string;
      try { content = await readFile(path, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'export default {}'; throw error; }
      const manifest = JSON.parse(content) as BakeManifest;
      if (manifest.fingerprint !== await bakeFingerprint(root)) throw new Error('Scene bake is stale. Run npm run bake before building the app.');
      for (const entry of Object.values(manifest.scenes)) await stat(resolve(root, 'public', entry.url.replace(/^\//, '')));
      return `export default ${JSON.stringify(manifest.scenes)}`;
    },
  };
}
