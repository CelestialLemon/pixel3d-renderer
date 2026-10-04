// Prepare review images without changing golden/ reference images.
import assert from 'node:assert/strict';
import {launch,newPage,open,canvasPng,writePng} from '../../tools/lib.ts';
const view='auto=0&clean-ui=1&time=8&px=3';
const shots=[...[22,17.5].map(hour=>({name:`village-street-hour${hour}`,query:`scene=village&hour=${hour}`})),
  ...['overview','square','canal'].map(view=>({name:`village-${view}`,query:`scene=village&view=${view}&hour=22`}))];
const browser=await launch();
try {
  const {page,errors}=await newPage(browser);
  for(const shot of shots) {
    await open(page,`pass3.html?${view}&${shot.query}`);
    await writePng(new URL(`review/proposed-${shot.name}.png`,import.meta.url).pathname,await canvasPng(page,'p3-view'));
    console.log('proposed',shot.name);
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
