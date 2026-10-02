// One fresh Blender process per model; --verify compares every GLB with its existing SHA-256.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const batch2=['house_A','house_B','tavern','clock_tower','house_C','house_D','stair_arch','bakery','house_E',
  'fountain','barrel','crate','bench','flower_box','signpost','closed_stall','festoon'];
const batch3=['bridge_stone','footbridge','watermill','rowboat','barge','jetty','town_hall','chapel','watch_tower',
  'smithy','cottage_thatch','cottage_long','barn','market_hall','guardian_statue','wardstone','ruins',
  'hay_bales','woodpile','laundry_line','notice_board','market_stall_lit','mooring_bollard','windmill_large'];
const requested=process.argv.slice(2).filter(arg=>!arg.startsWith('--'));
const names=requested.length?requested:process.argv.includes('--batch3')?batch3:[...batch2,...batch3];
for(const name of names) assert([...batch2,...batch3].includes(name),`Unknown village model: ${name}`);
const verify=process.argv.includes('--verify');
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
mkdirSync(`${root}assets/village/review`,{recursive:true});
for(const name of names) {
  const output=`${root}public/village/${name}.glb`;
  const before=verify?digest(output):null;
  const result=spawnSync(process.env.BLENDER_PATH||'/opt/homebrew/bin/blender',
    ['-b','--factory-startup','--python',`${root}assets/village/${name}/build.py`],
    {cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
  writeFileSync(`${root}assets/village/review/build-${name}.log`,result.stdout+result.stderr);
  assert.equal(result.status,0,`${name}: Blender process failed; see review/build-${name}.log`);
  assert(result.stdout.includes(`VILLAGE_READY ${name} `),`${name}: Python build failed; see review/build-${name}.log`);
  if(verify) assert.equal(digest(output),before,`${name}: GLB changed on identical rebuild`);
  console.log(result.stdout.split('\n').find(line=>line.startsWith('VILLAGE_READY'))+(verify?' — SHA-256 identical':''));
}
