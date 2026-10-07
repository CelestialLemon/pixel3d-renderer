import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Lint over the renderer's GLSL source (the shader template strings in src/renderer), for constructs that compile on
// SwiftShader and Vulkan but not on Windows Chrome, where ANGLE translates GLSL to HLSL for Direct3D 11.

const root = join(import.meta.dirname, '..');
const CTOR = /\b(?:vec[234]|mat[234](?:x[234])?)\s*\(/g;
// Comments, and escapes in quoted shader strings ('a;\n  b'): a line comment ends at an escaped newline too.
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/(?:[^\n\\]|\\(?![nr]))*/g, ESCAPE = /\\[nrt]/g;

// An int literal, however it is written: 0, (0), - 1, 0x10, 1u.
const isInt = (arg: string) => /^[-+]*(?:0x[0-9a-f]+|\d+)u?$/i.test(arg.replace(/[\s()]/g, ''));

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await sources(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

// The top-level arguments of the call whose '(' is at `open`, and the index of its ')'; null if it never closes.
function args(text: string, open: number): { list: string[]; close: number } | null {
  const list: string[] = [];
  let depth = 0, start = open + 1;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (--depth === 0) { list.push(text.slice(start, i).trim()); return { list, close: i }; }
    } else if (ch === ',' && depth === 1) { list.push(text.slice(start, i).trim()); start = i + 1; }
  }
  return null;
}

// A float vector or matrix constructor must not mix int literals with other arguments: ANGLE's HLSL output can give two
// such constructors (e.g. vec3(f, 0, 0) and vec3(0, f, 0)) helpers of the same name, and FXC then rejects the pixel
// shader with X3067 "ambiguous function call" (#27). All-int constructors like vec2(1,0) are fine.
function mixedLiteralConstructors(source: string): { line: number; call: string }[] {
  // Blank out comments and escapes, keeping offsets and line numbers.
  const text = source.replace(COMMENT, (c) => c.replace(/[^\n]/g, ' ')).replace(ESCAPE, '  ');
  const found: { line: number; call: string }[] = [];
  for (const m of text.matchAll(CTOR)) {
    const call = args(text, m.index + m[0].length - 1);
    if (!call) continue;
    const ints = call.list.filter(isInt).length;
    if (ints > 0 && ints < call.list.length) {
      found.push({ line: text.slice(0, m.index).split('\n').length, call: text.slice(m.index, call.close + 1).replace(/\s+/g, ' ') });
    }
  }
  return found;
}

test('the lint flags mixed int literals and passes float or all-int constructors', () => {
  assert.equal(mixedLiteralConstructors('F = vec3(sign(v.x), 0, 0);\nU = vec3(0, 1.0, x);').length, 2);
  assert.equal(mixedLiteralConstructors('mat2(c, 0,\n  0, c)')[0]?.line, 1);
  assert.equal(mixedLiteralConstructors('vec3(f, /* x */ 0, (0)) vec3(f, 0x0, - 1) vec2(f, 1u)').length, 3);
  assert.deepEqual(mixedLiteralConstructors('vec2(1,0) vec3(0, (1), - 1) vec3(0) vec3(sign(v.x), 0.0, 0.0) ivec2(t, 0) vec2(f(1, 2), 3.0)'), []);
  assert.deepEqual(mixedLiteralConstructors('// was vec3(sign(v.x), 0, 0)\n/* vec2(f, 0) */ vec2(f, 0.0)'), []);
  // Shader code in quoted strings, where \n is a GLSL line break.
  assert.equal(mixedLiteralConstructors(String.raw`'// cube face\nvec3(sign(v.x), 0, 0)'`).length, 1);
  assert.deepEqual(mixedLiteralConstructors(String.raw`'vec3(0,\n1, 0)'`), []);
});

test('no float vector constructor in the renderer mixes int literals with other arguments (D3D11, #27)', async () => {
  const bad: string[] = [];
  for (const file of await sources(join(root, 'src/renderer'))) {
    for (const { line, call } of mixedLiteralConstructors(await readFile(file, 'utf8'))) {
      bad.push(`${relative(root, file)}:${line}: ${call}`);
    }
  }
  assert.deepEqual(bad, [], 'write these arguments as float literals (0.0, not 0)');
});
