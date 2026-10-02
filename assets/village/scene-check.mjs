// Runtime captures for modelling QA. Uses the existing dev server without changing its state.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launch, newPage, open } from '../../tools/lib.mjs';
const output=new URL('review/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await launch();
const report=[];
try {
  const {page,errors}=await newPage(browser,{width:1440,height:1000});
  const warnings=[];
  page.on('console',message=>{if(message.type()==='warn'&&/village|lamp|missing|failed/i.test(message.text())) warnings.push(message.text());});
  const requested=process.argv.slice(2);
  for(const view of requested.length?requested:['overview','street','square','stairs','canal','tavern']) {
    await open(page,`pass3.html?scene=village&view=${view}&time=8&anim=0&clean-ui=1`);
    await page.screenshot({path:new URL(`scene-${view}.png`,output).pathname});
    const stats=await page.evaluate(()=>({title:document.title,ready:window.appReady,
      canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height}))}));
    assert(stats.ready && stats.canvases.some(c=>c.width>0&&c.height>0));
    report.push({view,...stats});
    console.log(`${view}: ready, captured`);
  }
  assert.deepEqual(errors,[],'Browser/shader/asset errors');
  assert.deepEqual(warnings,[],'Dropped lamps or missing village assets');
  await writeFile(new URL('scene-check.json',output),JSON.stringify({views:report,errors,warnings},null,2)+'\n');
} finally {
  await browser.close();
}
