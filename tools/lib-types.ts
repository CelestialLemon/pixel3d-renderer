// Part of `npm run build:lib`: adds `.js` to the relative imports in lib/types/*.d.ts. The renderer's sources import without
// extensions (Vite resolves them), but a game whose TypeScript uses "moduleResolution": "nodenext" needs them in the declarations.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fix = (dir: string): number => readdirSync(dir).reduce((n, name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return n + fix(path);
  if (!name.endsWith('.d.ts')) return n;
  const src = readFileSync(path, 'utf8');
  const out = src.replace(/((?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"]+?)(?<!\.js)(['"])/g, '$1$2.js$3');
  if (out !== src) writeFileSync(path, out);
  return n + 1;
}, 0);

console.log(`lib-types: ${fix('lib/types')} declaration files`);
