import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';

const server = await startStaticServer('_site');
const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(180_000);
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
  assert.match(await page.locator('#plotcat-exercise-2 textarea').inputValue(), /aes\(Sepal\.Length, Petal\.Length/);

  const first = page.locator('#plotcat-exercise-1');
  await first.locator('input[value=overlay]').click();
  assert.ok(await first.evaluate(node => node.classList.contains('plotcat--overlay')));
  await first.locator('input[value=wipe]').click();
  const slider = first.locator('[data-plotcat-wipe]');
  await slider.focus(); await slider.press('ArrowRight');
  assert.equal(await slider.inputValue(), '51');
  assert.equal(await first.evaluate(node => node.style.getPropertyValue('--plotcat-wipe')), '51%');

  const themeColors = () => page.locator('#plotcat-exercise-1').evaluate(node => ({
    body: getComputedStyle(document.body).backgroundColor,
    widget: getComputedStyle(node).backgroundColor,
    plot: getComputedStyle(node.querySelector('.plotcat__plot')).backgroundColor,
    editor: getComputedStyle(node.querySelector('.plotcat-editor-container')).backgroundColor
  }));
  const light = await themeColors();
  await page.evaluate(() => window.quartoToggleColorScheme());
  await page.waitForFunction(() => document.body.classList.contains('quarto-dark'));
  const dark = await themeColors();
  assert.notDeepEqual(light, dark);
  assert.equal(dark.body, 'rgb(34, 34, 34)');
  assert.equal(dark.widget, dark.body);
  assert.equal(dark.plot, dark.body);
  assert.notEqual(dark.editor, 'rgb(248, 249, 250)');
  assert.notEqual(dark.editor, light.editor);

  // Exercise the real browser runtimes, not mocks: a final ggplot expression
  // must auto-print, and Plotnine must draw its own object after another cell.
  await first.locator('[data-plotcat-run]').click();
  await first.locator('.plotcat__status').filter({ hasText: 'Plot rendered.' }).waitFor();
  assert.equal(await first.locator('.plotcat__student svg').count(), 1);
  const tinyplotSvg = await first.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML);

  const ggplot = page.locator('#plotcat-exercise-2');
  await ggplot.locator('[data-plotcat-run]').click();
  await ggplot.locator('.plotcat__status').filter({ hasText: 'Plot rendered.' }).waitFor();
  assert.equal(await ggplot.locator('.plotcat__student svg').count(), 1);
  assert.ok(await ggplot.locator('.plotcat__student svg path').count() > 10);
  assert.notEqual(await ggplot.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML), tinyplotSvg);

  const matplotlib = page.locator('#plotcat-exercise-3');
  await matplotlib.locator('[data-plotcat-run]').click();
  await matplotlib.locator('.plotcat__status').filter({ hasText: 'Plot rendered.' }).waitFor();
  assert.equal(await matplotlib.locator('.plotcat__student svg').count(), 1);
  const matplotlibSvg = await matplotlib.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML);

  const plotnine = page.locator('#plotcat-exercise-4');
  await plotnine.locator('[data-plotcat-run]').click();
  await plotnine.locator('.plotcat__status').filter({ hasText: 'Plot rendered.' }).waitFor();
  assert.equal(await plotnine.locator('.plotcat__student svg').count(), 1);
  assert.ok(await plotnine.locator('.plotcat__student svg path').count() > 10);
  assert.notEqual(await plotnine.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML), matplotlibSvg);

  // Verify the styling page renders correctly with custom CSS classes
  await page.goto(`${server.origin}/styling.html`, { waitUntil: 'load' });
  assert.equal(await page.locator('.plotcat').count(), 1);
  assert.equal(await page.locator('.fancy-plotcat').count(), 1);
} finally {
  await browser.close();
  await server.close();
}
