import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';

const server = await startStaticServer('_site');
const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(180_000);
const requests = [];
const failedRequests = [];
page.on('request', request => requests.push(new URL(request.url()).origin));
page.on('requestfailed', request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText || 'failed'}`));

async function expectRendered(widget, label) {
  const element = await widget.elementHandle();
  await page.waitForFunction(node => node.classList.contains('plotcat--complete') || node.classList.contains('plotcat--error'), element);
  const status = await widget.locator('.plotcat__status').textContent();
  assert.equal(status, 'Plot rendered.', `${label} failed: ${status}; failed requests: ${failedRequests.join(' | ') || 'none'}`);
}

try {
  await page.goto(`${server.origin}/examples.html`, { waitUntil: 'load' });
  assert.equal(await page.locator('.plotcat').count(), 4);
  assert.equal(await page.locator('.plotcat__target svg').count(), 4);
  assert.equal(await page.locator('.plotcat__student svg').count(), 0);
  assert.equal(await page.locator('.plotcat__textarea').count(), 4);
  assert.equal(await page.locator('.plotcat__status[aria-live=polite]').count(), 4);
  assert.equal(await page.locator('.plotcat__slider input[type=range]').count(), 4);
  assert.equal(await page.locator('canvas').count(), 0);
  assert.ok(requests.some(origin => /webr\.r-wasm\.org/.test(origin)), 'WebR should preload on page load');
  assert.ok(!requests.some(origin => /cdn\.jsdelivr\.net/.test(origin)), 'Pyodide should stay lazy until a Python cell runs');

  const html = await page.content();
  assert.doesNotMatch(html, /ax\.set_title|main = "Stopping distance|theme_minimal\(\)/);
  assert.match(await page.locator('#plotcat-exercise-1 textarea').inputValue(), /bill_length_mm, bill_depth_mm/);
  assert.match(await page.locator('#plotcat-exercise-2 textarea').inputValue(), /tinyplot::tinyplot/);
  assert.match(await page.locator('#plotcat-exercise-3 textarea').inputValue(), /ax\.scatter/);

  const first = page.locator('#plotcat-exercise-1');
  await first.locator('input[value=overlay]').click();
  assert.ok(await first.evaluate(node => node.classList.contains('plotcat--overlay')));
  await first.locator('input[value=wipe]').click();
  const slider = first.locator('[data-plotcat-wipe]');
  await slider.focus(); await slider.press('ArrowRight');
  assert.equal(await slider.inputValue(), '51');
  assert.equal(await first.evaluate(node => node.style.getPropertyValue('--plotcat-wipe')), '51%');
  const wipeHandle = first.locator('[data-plotcat-wipe-handle]');
  assert.equal(await wipeHandle.getAttribute('aria-valuenow'), '51');
  const bodyBox = await first.locator('.plotcat__body').boundingBox();
  const handleBox = await wipeHandle.boundingBox();
  assert.ok(bodyBox && handleBox);
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(bodyBox.x + bodyBox.width * 0.67, bodyBox.y + bodyBox.height / 2);
  await page.mouse.up();
  assert.equal(await slider.inputValue(), '67');
  assert.equal(await wipeHandle.getAttribute('aria-valuenow'), '67');
  assert.equal(await first.evaluate(node => node.style.getPropertyValue('--plotcat-wipe')), '67%');

  const themeColors = () => page.locator('#plotcat-exercise-1').evaluate(node => ({
    body: getComputedStyle(document.body).backgroundColor,
    widget: getComputedStyle(node).backgroundColor,
    primary: getComputedStyle(node).getPropertyValue('--bs-primary').trim(),
    accent: getComputedStyle(node).getPropertyValue('--plotcat-accent').trim(),
    text: getComputedStyle(node).color,
    plot: getComputedStyle(node.querySelector('.plotcat__plot')).backgroundColor,
    editor: getComputedStyle(node.querySelector('.plotcat-editor-container')).backgroundColor,
    button: getComputedStyle(node.querySelector('.plotcat__button')).backgroundColor,
    selected: getComputedStyle(node.querySelector('.plotcat__compare label:has(input:checked)')).backgroundColor,
    wipeLine: getComputedStyle(node.querySelector('.plotcat__wipe-handle'), '::before').backgroundColor,
    wipeGrip: getComputedStyle(node.querySelector('.plotcat__wipe-handle'), '::after').backgroundColor,
    status: getComputedStyle(node.querySelector('.plotcat__status')).color
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

  const customVariables = {
    '--bs-body-bg': '#123456',
    '--bs-body-color': '#fedcba',
    '--bs-primary': '#654321',
    '--bs-primary-rgb': '101, 67, 33',
    '--bs-secondary-color': '#abcdef'
  };
  await page.evaluate(variables => {
    for (const [name, value] of Object.entries(variables)) document.body.style.setProperty(name, value);
  }, customVariables);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  const custom = await themeColors();
  assert.equal(custom.widget, 'rgb(18, 52, 86)');
  assert.equal(custom.plot, custom.widget);
  assert.equal(custom.text, 'rgb(254, 220, 186)');
  assert.equal(custom.primary, '#654321');
  assert.equal(custom.accent, '#654321');
  assert.equal(custom.button, 'rgb(101, 67, 33)');
  assert.equal(custom.selected, custom.button);
  assert.notEqual(custom.wipeLine, light.wipeLine);
  assert.notEqual(custom.wipeGrip, light.wipeGrip);
  assert.equal(custom.status, 'rgb(171, 205, 239)');
  await page.evaluate(names => {
    for (const name of names) document.body.style.removeProperty(name);
  }, Object.keys(customVariables));

  // Exercise the real browser runtimes, not mocks. Run the Python pair first
  // so its lazy runtime is validated independently of later R package memory.
  const matplotlib = page.locator('#plotcat-exercise-3');
  await matplotlib.locator('[data-plotcat-run]').click();
  await expectRendered(matplotlib, 'Matplotlib');
  assert.equal(await matplotlib.locator('.plotcat__student svg').count(), 1);
  const matplotlibSvg = await matplotlib.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML);

  const plotnine = page.locator('#plotcat-exercise-4');
  await plotnine.locator('[data-plotcat-run]').click();
  await expectRendered(plotnine, 'Plotnine');
  assert.equal(await plotnine.locator('.plotcat__student svg').count(), 1);
  assert.ok(await plotnine.locator('.plotcat__student svg path').count() > 10);
  assert.notEqual(await plotnine.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML), matplotlibSvg);

  const ggplot = first;
  await ggplot.locator('[data-plotcat-run]').click();
  await expectRendered(ggplot, 'ggplot2');
  assert.equal(await ggplot.locator('.plotcat__student svg').count(), 1);
  assert.ok(await ggplot.locator('.plotcat__student svg path').count() > 10);
  const ggplotSvg = await ggplot.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML);

  const tinyplot = page.locator('#plotcat-exercise-2');
  await tinyplot.locator('[data-plotcat-run]').click();
  await expectRendered(tinyplot, 'tinyplot');
  assert.equal(await tinyplot.locator('.plotcat__student svg').count(), 1);
  assert.notEqual(await tinyplot.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML), ggplotSvg);

  // Verify the styling page renders correctly with custom CSS classes
  await page.goto(`${server.origin}/styling.html`, { waitUntil: 'load' });
  assert.equal(await page.locator('.plotcat').count(), 1);
  assert.equal(await page.locator('.fancy-plotcat').count(), 1);
} finally {
  await browser.close();
  await server.close();
}
