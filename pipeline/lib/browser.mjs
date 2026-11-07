// Headless Chrome с WebGL; открывает studio.html в режиме чистого кадра
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => fs.existsSync(p));

export async function openScene(base, { t, q, aspect = '16:9', width }) {
  const w = width || (aspect === '9:16' ? 1080 : 1920);
  const h = Math.round(aspect === '9:16' ? w * 16 / 9 : w * 9 / 16);
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 120000,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('[page]', e.message));
  await page.goto(`${base}studio.html?render=1&t=${t}&q=${q}&aspect=${aspect}&w=${w}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });
  const duration = await page.evaluate('window.__duration');
  return {
    duration, browser, page,
    async frame(sec, type = 'jpeg') {
      await page.evaluate(s => window.__seek(s), sec);
      return page.screenshot({ type, quality: type === 'jpeg' ? 92 : undefined, optimizeForSpeed: true });
    },
  };
}
