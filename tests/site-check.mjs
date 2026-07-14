import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';

const server = await startStaticServer('_site');
const browser = await chromium.launch();
const page = await browser.newPage();
const requests = [];
page.on('request', request => requests.push(new URL(request.url()).origin));

try {
  await page.goto(`${server.origin}/examples.html`, { waitUntil: 'load' });
  assert.equal(await page.locator('.plotcat').count(), 4);
  assert.equal(await page.locator('.plotcat__target svg').count(), 4);
  assert.equal(await page.locator('.plotcat__student svg').count(), 0);
  assert.equal(await page.locator('.plotcat__textarea').count(), 4);
  assert.equal(await page.locator('.plotcat__status[aria-live=polite]').count(), 4);
  assert.equal(await page.locator('.plotcat__slider input[type=range]').count(), 4);
  assert.equal(await page.locator('canvas').count(), 0);
  assert.ok(requests.some(origin => /webr\.r-wasm\.org|cdn\.jsdelivr\.net/.test(origin)), 'Runtimes should preload on page load');

  const html = await page.content();
  assert.doesNotMatch(html, /ax\.set_title|main = "Stopping distance|theme_minimal\(\)/);
  assert.match(await page.locator('#plotcat-exercise-1 textarea').inputValue(), /tinyplot::tinyplot/);
  assert.match(await page.locator('#plotcat-exercise-3 textarea').inputValue(), /ax\.scatter/);

  const first = page.locator('#plotcat-exercise-1');
  await first.locator('input[value=overlay]').click();
  assert.ok(await first.evaluate(node => node.classList.contains('plotcat--overlay')));
  await first.locator('input[value=wipe]').click();
  const slider = first.locator('[data-plotcat-wipe]');
  await slider.focus(); await slider.press('ArrowRight');
  assert.equal(await slider.inputValue(), '51');
  assert.equal(await first.evaluate(node => node.style.getPropertyValue('--plotcat-wipe')), '51%');
  await first.locator('[data-plotcat-toggle]').click();
  assert.equal(await first.locator('[data-plotcat-student]').evaluate(node => node.hidden), true);

  const light = await page.evaluate(() => ({ color: getComputedStyle(document.body).color, background: getComputedStyle(document.body).backgroundColor }));
  await page.evaluate(() => window.quartoToggleColorScheme());
  await page.waitForFunction(() => document.body.classList.contains('quarto-dark'));
  const dark = await page.evaluate(() => ({ color: getComputedStyle(document.body).color, background: getComputedStyle(document.body).backgroundColor }));
  assert.notDeepEqual(light, dark);
} finally {
  await browser.close();
  await server.close();
}
