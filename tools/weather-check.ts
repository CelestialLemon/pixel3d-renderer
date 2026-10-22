// Weather (PixelRenderer.setWeather): the defaults draw exactly what the renderer drew before, rain and snow follow the
// clock and nothing else, a change of cloud speed doesn't move the clouds, the cover and the wind change the image, and
// out-of-range values are rejected without changing anything. Requires the dev server and pinned browser.
import assert from 'node:assert/strict';
import type { ViewerApp } from '../src/app/viewer/main.ts';
import { launch, newPage, open } from './lib.ts';

const browser = await launch();
try {
  const { page, errors } = await newPage(browser, { width: 480, height: 300 });
  await open(page, 'pass3.html?auto=0&anim=0&time=8&hour=12&clean-ui=1&px=3');
  const result = await page.evaluate(async () => {
    const { DEFAULT_WEATHER } = await import('/src/renderer/index.ts');
    const app = (window as unknown as { app3: ViewerApp }).app3, p3 = app.p3;
    const canvas = document.getElementById('p3-view') as HTMLCanvasElement;
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
    const frame = (time: number) => {
      app.capture({ time });
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
      const ctx = c.getContext('2d')!; ctx.drawImage(canvas, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const differing = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
      return n;
    };
    const pixels = canvas.width * canvas.height, out: Record<string, number> = {};

    const base = frame(8);
    check(JSON.stringify(p3.weather) === JSON.stringify(DEFAULT_WEATHER), 'A new renderer has the default weather');
    p3.setWeather({ ...DEFAULT_WEATHER });
    check(differing(frame(8), base) === 0, 'Setting the default weather changes nothing');
    p3.setWeather({ precipitation: 'rain', intensity: 0 });
    check(differing(frame(8), base) === 0, 'Rain at intensity 0 draws nothing');

    for (const [kind, intensity] of [['rain', 0.2], ['rain', 1], ['snow', 0.2], ['snow', 1]] as const) {
      p3.setWeather({ precipitation: kind, intensity });
      const a = frame(8), n = out[`${kind}${intensity}`] = differing(a, base) / pixels;
      check(n > 0.002, `${kind} at ${intensity} draws something (${n})`);
      check(n < 0.12, `${kind} at ${intensity} leaves most of the farm in view (${n})`);
      check(differing(frame(8), a) === 0, `${kind} is a function of the clock`);
      check(differing(frame(8.25), a) > 0, `${kind} falls as the clock runs`);
    }
    check(out.rain1 > 2 * out['rain0.2'] && out.snow1 > 2 * out['snow0.2'], 'Heavier precipitation draws more');
    p3.setWeather({ precipitation: 'none', intensity: 0.5 });
    check(differing(frame(8), base) === 0, 'Turning precipitation off restores the image');

    // Rejected values change nothing.
    const before = JSON.stringify(p3.weather);
    for (const bad of [{ intensity: 2 }, { cloudCover: -0.1 }, { cloudSpeed: Number.NaN }, { wind: 4 }, { gusts: -1 }, { precipitation: 'hail' }, { wind: 1, gusts: 9 }, { haze: 1.5 }, { haze: -1 }, { hazeTop: Number.NaN }, { hazeColor: 0x1000000 }, { hazeColor: 1.5 }]) {
      let threw = false;
      try { p3.setWeather(bad as never); } catch (e) { threw = e instanceof RangeError; }
      check(threw, `setWeather(${JSON.stringify(bad)}) throws a RangeError`);
      check(JSON.stringify(p3.weather) === before, `setWeather(${JSON.stringify(bad)}) changes nothing`);
    }

    // Clouds: cover changes the shading; speed changes how fast they move, never where they are.
    p3.setWeather({ cloudCover: 0 }); out.clear = differing(frame(8), base) / pixels;
    p3.setWeather({ cloudCover: 1 }); out.overcast = differing(frame(8), base) / pixels;
    check(out.clear > 0.01 && out.overcast > out.clear, `Cloud cover changes the cloud shadows (${out.clear}, ${out.overcast})`);
    p3.setWeather({ cloudCover: 0.5 });
    const t50 = frame(50);
    p3.setWeather({ cloudSpeed: 6 });
    check(differing(frame(50), t50) === 0, 'A new cloud speed does not move the clouds');
    const fast = differing(frame(54), t50);
    // The other ambient motion runs on with the clock, so compare where the clouds shade: the pixels that cover changes.
    const shaded = (time: number) => {
      p3.setWeather({ cloudCover: 0 }); const clear = frame(time);
      p3.setWeather({ cloudCover: 0.5 }); const cloudy = frame(time);
      return Array.from({ length: pixels }, (_, i) => clear[4 * i] !== cloudy[4 * i] || clear[4 * i + 1] !== cloudy[4 * i + 1] || clear[4 * i + 2] !== cloudy[4 * i + 2]);
    };
    // Butterflies and swaying grass pass over shaded ground too, so a few pixels differ even when the clouds hold still.
    const moved = (a: boolean[], b: boolean[]) => a.filter((v, i) => v !== b[i]).length;
    p3.setWeather({ cloudSpeed: 0 });
    out.heldMoved = moved(shaded(54), shaded(90));
    p3.setWeather({ cloudSpeed: 1 });
    out.driftMoved = moved(shaded(54), shaded(90));
    check(out.heldMoved < 0.1 * out.driftMoved, `At speed 0 the clouds hold still (${out.heldMoved} vs ${out.driftMoved} pixels)`);
    check(fast > 0, 'The clouds move with the clock');
    p3.setWeather({ cloudCover: DEFAULT_WEATHER.cloudCover });

    // Wind: the sway leans with the steady wind (at the same clock, so the other ambient motion is the same).
    p3.setWeather({ gusts: 0 });
    const still = frame(8);
    p3.setWeather({ wind: 2 });
    out.wind = differing(frame(8), still) / pixels;
    check(out.wind > 0.002, `A steady wind leans the sway (${out.wind})`);

    // Haze: none by default, a veil over the ground that follows the clock and thins with height and with the amount, and
    // never hides the farm. The ground is the cookie shop's lawn at y = 0, the roof peaks near 4.5 m.
    // (The clouds' drift remembers the speeds above, so the baseline is taken again.)
    p3.setWeather({ ...DEFAULT_WEATHER });
    const clear = frame(8);
    p3.setWeather({ haze: 0 });
    check(differing(frame(8), clear) === 0, 'No haze draws nothing');
    p3.setWeather({ haze: 0.5, hazeTop: 0 });
    check(differing(frame(8), clear) === 0, 'Haze that ends at the ground draws nothing');
    let last = 0;
    for (const haze of [0.2, 0.5, 1]) {
      p3.setWeather({ haze, hazeTop: 3.5 });
      const f = frame(8), n = differing(f, clear) / pixels;
      check(n > last, `More haze veils more of the picture (${haze}: ${n})`);
      check(differing(frame(8), f) === 0, 'Haze is a function of the clock');
      last = out[`haze${haze}`] = n;
    }
    check(out.haze1 > 0.5, `Thick haze veils most of the picture (${out.haze1})`);
    p3.setWeather({ haze: 1, hazeTop: 3.5 });
    const thick = frame(8), thick40 = frame(40);
    p3.setWeather({ haze: 0 }); const bare40 = frame(40);
    p3.setWeather({ haze: 1, hazeTop: 3.5 });
    check(differing(thick, thick40) > differing(clear, bare40), 'The haze drifts with the clock');
    // It never hides the farm: even a black haze at its thickest, over everything, leaves a fifth of each surface's own colour
    // (in linear light, so at least a third of its sRGB value), and the picture still has its detail.
    p3.setWeather({ haze: 1, hazeTop: 100, hazeColor: 0x000000 });
    const black = frame(8);
    let hidden = 0, dark = 0;
    for (let i = 0; i < pixels; i++) for (let c = 0; c < 3; c++) {
      if (clear[4 * i + c] < 60) continue;
      dark++;
      if (black[4 * i + c] < 0.3 * clear[4 * i + c]) hidden++;
    }
    check(dark > 0 && hidden < 0.01 * dark, `Even the thickest haze keeps the farm in view (${hidden} of ${dark} channels darker than a fifth)`);
    // The haze colour is the colour: a dust haze pulls the picture towards brown.
    p3.setWeather({ haze: 0.8, hazeTop: 3.5, hazeColor: 0xc49a62 });
    const dust = frame(8);
    let r = 0, b = 0;
    for (let i = 0; i < pixels; i++) { r += dust[4 * i] - clear[4 * i]; b += dust[4 * i + 2] - clear[4 * i + 2]; }
    check(r > b, `A warm haze warms the picture (red ${r}, blue ${b})`);
    p3.setWeather({ ...DEFAULT_WEATHER });
    check(differing(frame(8), clear) === 0, 'Turning the haze off restores the image');
    return out;
  });
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log('PASS: default weather unchanged, rain and snow by the clock, cloud cover and speed, wind, haze, validation.', result);
} finally { await browser.close(); }
