import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';

const server = await startStaticServer('.');
const browser = await chromium.launch();
const page = await browser.newPage();
const fixture = `${server.origin}/tests/fixtures/browser.html`;

async function load() {
  await page.goto(fixture);
  await page.waitForFunction(() => window.fixtureReady === true);
}

try {
  await load();
  const sanitized = await page.evaluate(() => window.plotcatSvg.sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><!-- note --><metadata>private</metadata><script>alert(1)</script><foreignObject>bad</foreignObject><rect onclick="bad()" fill="url(https://bad.test/a)"/><image href="data:image/png;base64,abc"/><use href="#safe"/></svg>`));
  assert.doesNotMatch(sanitized, /script|foreignObject|metadata|onclick|https:|data:image|note/);
  assert.match(sanitized, /href="#safe"/);
  const malformed = await page.evaluate(() => {
    try { window.plotcatSvg.sanitizeSvg('<html/>'); return ''; } catch (error) { return error.message; }
  });
  assert.match(malformed, /valid SVG/);

  const normalized = await page.evaluate(() => {
    const element = window.plotcatSvg.normalizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="generated"><rect width="1.23456"/></clipPath></defs><g clip-path="url(#generated)" style="stroke: red; fill: blue"/></svg>`);
    return {
      id: element.querySelector('clipPath').id,
      reference: element.querySelector('g').getAttribute('clip-path'),
      width: element.querySelector('rect').getAttribute('width'),
      style: element.querySelector('g').getAttribute('style')
    };
  });
  assert.deepEqual(normalized, { id: 'id0', reference: 'url(#id0)', width: '1.235', style: 'fill: blue;stroke: red' });

  const comparison = await page.evaluate(() => {
    const target = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle fill="red"/><text x="1" y="2">Speed</text></svg>`;
    const same = window.plotcatSvg.compareSvg(target, target);
    const different = window.plotcatSvg.compareSvg(target, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect fill="blue"/><rect/><text>Distance</text></svg>`);
    return { same, different, features: window.plotcatSvg.extractFeatures(target) };
  });
  assert.equal(comparison.same.score, 1);
  assert.ok(comparison.different.score < comparison.same.score);
  assert.equal(comparison.different.categories.text, 0);
  assert.equal(comparison.features.counts.circle, 1);
  assert.deepEqual(comparison.features.textPlacement, ['Speed|1|2|||']);

  await load();
  const successfulRun = await page.evaluate(async () => {
    const root = document.querySelector('.plotcat');
    root.dataset.plotcatManifest = '{"id":"test","engine":"r","packages":[]}';
    const calls = [];
    const manager = {
      get: async (engine, manifest) => { calls.push({ engine, manifest }); return { renderSvg: async () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>bad()</script><circle fill="red"/></svg>` }; },
      run: async (_engine, task) => task()
    };
    window.plotcatUi.mountPlotCat(root, manager);
    const overlay = root.querySelector('input[value=overlay]'); overlay.click();
    const wipe = root.querySelector('[data-plotcat-wipe]'); wipe.value = '73'; wipe.dispatchEvent(new Event('input'));
    root.querySelector('[data-plotcat-run]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    return {
      engine: calls[0].engine,
      overlay: root.classList.contains('plotcat--overlay'),
      wipe: root.style.getPropertyValue('--plotcat-wipe'),
      student: root.querySelector('[data-plotcat-student]').innerHTML,
      score: root.querySelector('.plotcat__score').textContent,
      status: root.querySelector('.plotcat__status').textContent,
      complete: root.classList.contains('plotcat--complete'),
      enabled: !root.querySelector('[data-plotcat-run]').disabled
    };
  });
  assert.deepEqual(successfulRun, { engine: 'r', overlay: true, wipe: '73%', student: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle fill="red"></circle></svg>', score: '100%', status: 'Plot rendered.', complete: true, enabled: true });

  await load();
  const forEachRun = await page.evaluate(async () => {
    const root = document.querySelector('.plotcat');
    root.dataset.plotcatManifest = '{"id":"test","engine":"r","packages":[]}';
    const { runtimeManager } = await import('../../_extensions/plotcat/runtime-manager.js');
    const calls = [];
    runtimeManager.get = async (engine, manifest) => {
      calls.push({ engine, manifest });
      return { renderSvg: async () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle fill="red"/></svg>` };
    };
    runtimeManager.run = async (_engine, task) => task();

    // Call using forEach to simulate automatic mounting (passes index as second argument)
    [root].forEach(window.plotcatUi.mountPlotCat);

    root.querySelector('[data-plotcat-run]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    return {
      engine: calls[0]?.engine,
      student: root.querySelector('[data-plotcat-student]').innerHTML,
      score: root.querySelector('.plotcat__score').textContent,
      status: root.querySelector('.plotcat__status').textContent,
      complete: root.classList.contains('plotcat--complete')
    };
  });
  assert.deepEqual(forEachRun, { engine: 'r', student: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle fill="red"></circle></svg>', score: '100%', status: 'Plot rendered.', complete: true });

  await load();
  const failedRun = await page.evaluate(async () => {
    const root = document.querySelector('.plotcat'); root.dataset.plotcatManifest = '{"id":"test","engine":"r","packages":[]}';
    window.plotcatUi.mountPlotCat(root, { get: async () => { throw new Error('R package tinyplot is unavailable.'); }, run: async () => {} });
    root.querySelector('[data-plotcat-run]').click(); await new Promise(resolve => setTimeout(resolve, 0));
    return { status: root.querySelector('.plotcat__status').textContent, error: root.classList.contains('plotcat--error'), enabled: !root.querySelector('[data-plotcat-run]').disabled };
  });
  assert.deepEqual(failedRun, { status: 'R package tinyplot is unavailable.', error: true, enabled: true });
} finally {
  await browser.close();
  await server.close();
}
