// Downloads the pinned Chromium build (CHROMIUM in lib.ts) into .browsers/, where the tools find it without CHROME_PATH.
import { install } from '@puppeteer/browsers';
import { CHROMIUM } from './lib.ts';

const { executablePath } = await install({ ...CHROMIUM, downloadProgressCallback: 'default' });
console.log('Chromium', CHROMIUM.buildId, 'at', executablePath);
