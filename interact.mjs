import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); await page.setViewport({ width: 1200, height: 800 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(`${process.env.DEMO_URL || 'http://127.0.0.1:5180'}/?auto=0&clean-ui=1`); await page.waitForFunction('window.appReady', { timeout: 120000 });
const st = () => page.evaluate(() => ({ az: +(app.target.az * 180 / Math.PI).toFixed(1), el: +(app.target.el * 180 / Math.PI).toFixed(1), size: +app.target.size.toFixed(2), tx: +app.target.tx.toFixed(2), tz: +app.target.tz.toFixed(2) }));
console.log('start ', JSON.stringify(await st()));
await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(800, 340, { steps: 8 }); await page.mouse.up();
console.log('drag  ', JSON.stringify(await st()));
await page.mouse.wheel({ deltaY: -400 }); console.log('wheel ', JSON.stringify(await st()));
await page.keyboard.down('Shift'); await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(700, 400, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift');
console.log('pan   ', JSON.stringify(await st()));
await new Promise((r) => setTimeout(r, 2000)); await page.screenshot({ path: 'out/pass2-interaction.png' });
console.log('errors:', errs.length ? errs : 'none'); await browser.close();
