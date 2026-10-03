// Globals of the demo pages, as the page.evaluate callbacks (which run in the browser) see them.
import type { CompareApp } from '../src/app/compare/main.ts';
import type { ViewerApp } from '../src/app/viewer/main.ts';

declare global {
  var appReady: boolean | undefined;
  var app: CompareApp;     // index.html, the comparison page
  var app3: ViewerApp;     // pass3.html, the viewer
  var __texel: number;     // set by thin-check
}
export {};
