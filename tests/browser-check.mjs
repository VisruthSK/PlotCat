import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setupBrowserTest } from './playwright-helper.mjs';

const { server, page, teardown } = await setupBrowserTest('.');
const fixture = `${server.origin}/tests/fixtures/browser.html`;

async function load() {
  await page.goto(fixture);
  await page.waitForFunction(() => window.fixtureReady === true);
}

async function runWithDifferentOutputTypes(targetResult, studentResult) {
  await load();
  return page.evaluate(async ({ targetResult, studentResult }) => {
    const root = document.querySelector('.plotcat');
    root.dataset.plotcatManifest = '{"id":"test","engine":"r"}';
    root.dataset.plotcatTargetCode = btoa('target');
    window.Plotly = { newPlot: async () => {}, addFrames: async () => {}, purge: () => {} };
    const results = [targetResult, studentResult];
    window.plotcatUi.mountPlotCat(root, {
      get: async () => ({ renderSvg: async () => results.shift() }),
      run: async (_engine, task) => task()
    });
    const run = root.querySelector('[data-plotcat-run]');
    await new Promise(resolve => {
      const poll = () => run.disabled ? setTimeout(poll, 0) : resolve();
      poll();
    });
    run.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    return {
      status: root.querySelector('.plotcat__status').textContent,
      complete: root.classList.contains('plotcat--complete')
    };
  }, { targetResult, studentResult });
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

  const scoped = await page.evaluate(() => window.plotcatSvg.scopeSvgIds('<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="glyph"/><clipPath id="clip"><rect/></clipPath></defs><use href="#glyph"/><g clip-path="url(#clip)"/></svg>', 'student'));
  assert.match(scoped, /id="student-glyph"/);
  assert.match(scoped, /href="#student-glyph"/);
  assert.match(scoped, /url\(#student-clip\)/);

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

  const preparedReferences = await page.evaluate(() => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <path id="marker" d="M0 0h1v1z"/>
        <clipPath id="clip"><rect width="1" height="1"/></clipPath>
      </defs>
      <use href="#marker"/>
      <g clip-path="url('#clip')"/>
    </svg>`;
    const prepared = window.plotcatSvg.prepareSvg(source, 'plot');
    const doc = new DOMParser().parseFromString(prepared.svg, 'image/svg+xml');
    return {
      ids: [...doc.querySelectorAll('[id]')].map(node => node.id),
      href: doc.querySelector('use').getAttribute('href'),
      clip: doc.querySelector('g').getAttribute('clip-path')
    };
  });
  assert.deepEqual(preparedReferences, {
    ids: ['plot-id0', 'plot-id1'],
    href: '#plot-id0',
    clip: 'url(#plot-id1)'
  });

  const rendererFixtures = [
    {
      name: 'matplotlib',
      file: 'tests/fixtures/renderers/matplotlib-scatter.svg',
      minimumUses: 150,
      labels: []
    },
    {
      name: 'seaborn',
      file: 'tests/fixtures/renderers/seaborn-scatter.svg',
      minimumUses: 100,
      labels: ['bill_length_mm', 'Penguin bills']
    },
    {
      name: 'plotnine',
      file: 'tests/fixtures/renderers/plotnine-scatter.svg',
      minimumUses: 50,
      labels: ['Plotnine labels', 'Horizontal label', 'Vertical label']
    }
  ];

  for (const fixture of rendererFixtures) {
    const source = await fs.readFile(fixture.file, 'utf8');
    const result = await page.evaluate(({ source, fixture }) => {
      const parser = new DOMParser();
      const sourceDoc = parser.parseFromString(source, 'image/svg+xml');
      const sourceGroups = [...sourceDoc.querySelectorAll('g')];
      const labelGroupIndexes = {};
      const comments = sourceDoc.createTreeWalker(sourceDoc, NodeFilter.SHOW_COMMENT);

      while (comments.nextNode()) {
        const label = comments.currentNode.textContent.trim();
        if (fixture.labels.includes(label)) {
          labelGroupIndexes[label] = sourceGroups.indexOf(comments.currentNode.parentElement);
        }
      }

      const prepared = window.plotcatSvg.prepareSvg(source, `fixture-${fixture.name}`);
      const preparedDoc = parser.parseFromString(prepared.svg, 'image/svg+xml');
      const svg = document.importNode(preparedDoc.documentElement, true);
      svg.style.width = '700px';
      svg.style.height = '500px';
      document.body.append(svg);

      const ids = new Set([...svg.querySelectorAll('[id]')].map(node => node.id));
      const references = [];
      const unresolved = [];
      const fragmentUrl = /url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g;

      for (const node of svg.querySelectorAll('*')) {
        for (const attr of node.attributes) {
          const direct = attr.value.match(/^#(.+)$/);
          if (direct) references.push(direct[1]);
          for (const match of attr.value.matchAll(fragmentUrl)) references.push(match[1]);
        }
      }

      for (const id of references) {
        if (!ids.has(id)) unresolved.push(id);
      }

      const uses = [...svg.querySelectorAll('use')];
      const laidOutUses = uses.filter(node => {
        try {
          const box = node.getBBox();
          return box.width > 0 && box.height > 0;
        } catch {
          return false;
        }
      }).length;

      const preparedGroups = [...svg.querySelectorAll('g')];
      const labelBoxes = {};
      for (const [label, index] of Object.entries(labelGroupIndexes)) {
        const box = preparedGroups[index]?.getBBox();
        labelBoxes[label] = box ? { width: box.width, height: box.height } : null;
      }

      svg.remove();
      return {
        ids: [...ids],
        references,
        unresolved,
        useCount: uses.length,
        laidOutUses,
        labelGroupIndexes,
        labelBoxes
      };
    }, { source, fixture });

    assert.ok(result.useCount >= fixture.minimumUses, `${fixture.name} fixture must exercise real glyph and marker references`);
    assert.equal(result.unresolved.length, 0, `${fixture.name} must not contain stale SVG fragment references`);
    assert.ok(
      result.references.every(id => id.startsWith(`fixture-${fixture.name}-`)),
      `${fixture.name} references must point at normalized, scoped IDs`
    );
    assert.ok(
      result.laidOutUses / result.useCount >= 0.8,
      `${fixture.name} glyphs and markers must produce browser layout boxes`
    );
    assert.deepEqual(
      Object.keys(result.labelGroupIndexes).sort(),
      [...fixture.labels].sort(),
      `${fixture.name} label fixtures must retain their expected label groups`
    );
    for (const label of fixture.labels) {
      const box = result.labelBoxes[label];
      assert.ok(box && box.width > 1 && box.height > 1, `${fixture.name} label "${label}" must be visible`);
    }
  }

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

  const rendererTolerance = await page.evaluate(() => {
    const target = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="20.1" cy="40.1" r="2" fill="red"/><text x="10" y="90">Speed</text></svg>';
    const equivalent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500pt" height="500pt"><circle cx="100.4" cy="200.4" r="10" fill="red"/><text x="48" y="451">Speed</text></svg>';
    const changed = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="80" cy="10" r="20" fill="blue"/><text x="10" y="90">Distance</text></svg>';
    return { equivalent: window.plotcatSvg.compareSvg(target, equivalent), changed: window.plotcatSvg.compareSvg(target, changed) };
  });
  assert.equal(rendererTolerance.equivalent.score, 1);
  assert.ok(rendererTolerance.changed.score < 1);

  const swappedScore = await page.evaluate(() => {
    const target = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="10" cy="10" r="5" fill="red"/><circle cx="90" cy="90" r="5" fill="blue"/></svg>';
    const swapped = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="10" cy="90" r="5" fill="red"/><circle cx="90" cy="10" r="5" fill="blue"/></svg>';
    return window.plotcatSvg.compareSvg(target, swapped);
  });
  assert.ok(swappedScore.score < 0.6, 'swapped positions should score below 0.6');

  const scatteredWrong = await page.evaluate(() => {
    const target = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="1" cy="1" r="0.2" fill="red"/><circle cx="2" cy="3" r="0.2" fill="red"/><circle cx="4" cy="5" r="0.2" fill="red"/></svg>';
    const wrong = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="8" cy="8" r="0.2" fill="red"/><circle cx="7" cy="6" r="0.2" fill="red"/><circle cx="5" cy="4" r="0.2" fill="red"/></svg>';
    return window.plotcatSvg.compareSvg(target, wrong);
  });
  assert.ok(scatteredWrong.score < 0.6, 'wrong positions should score below 0.6');

  await load();
  const successfulRun = await page.evaluate(async () => {
    const root = document.querySelector('.plotcat');
    root.dataset.plotcatManifest = '{"id":"test","engine":"r"}';
    const { runtimeManager } = await import('../../_extensions/plotcat/runtime-manager.js');
    const calls = [];
    runtimeManager.get = async engine => { calls.push({ engine }); return { renderSvg: async () => ({ kind: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>bad()</script><circle fill="red"/></svg>' }) }; };
    runtimeManager.run = async (_engine, task) => task();
    window.plotcatUi.mountPlotCat(root);
    const wipeMode = root.querySelector('input[value=wipe]'); wipeMode.click();
    const handle = root.querySelector('[data-plotcat-wipe-handle]');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    const overlay = root.querySelector('input[value=overlay]'); overlay.click();
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
  assert.deepEqual(successfulRun, { engine: 'r', overlay: true, wipe: '100%', student: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle fill="red"></circle></svg>', score: '100%', status: '', complete: true, enabled: true });

  await load();
  const forEachRun = await page.evaluate(async () => {
    const root = document.querySelector('.plotcat');
    root.dataset.plotcatManifest = '{"id":"test","engine":"r"}';
    const { runtimeManager } = await import('../../_extensions/plotcat/runtime-manager.js');
    const calls = [];
    runtimeManager.get = async engine => {
      calls.push({ engine });
      return { renderSvg: async () => ({ kind: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle fill="red"/></svg>' }) };
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
  assert.deepEqual(forEachRun, { engine: 'r', student: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle fill="red"></circle></svg>', score: '100%', status: '', complete: true });

  await load();
  const plotlyRendering = await page.evaluate(async () => {
    const root = document.querySelector('.plotcat');
    root.dataset.plotcatManifest = '{"id":"test","engine":"python"}';
    root.dataset.plotcatTargetCode = btoa('fig');
    const calls = [];
    window.Plotly = {
      purge: () => {},
      newPlot: async (_div, data, layout, config) => calls.push({ type: 'newPlot', data, layout, config }),
      addFrames: async (_div, frames) => calls.push({ type: 'addFrames', frames })
    };
    const figure = {
      data: [{ type: 'scatter', x: [1], y: [2] }],
      layout: { title: { text: 'Animated' } },
      frames: [{ name: 'step-1', data: [{ y: [3] }] }],
      config: { scrollZoom: true, displayModeBar: true }
    };
    const adapter = { renderSvg: async () => ({ kind: 'plotly', figure }) };
    const manager = { get: async () => adapter, run: async (_engine, task) => task() };
    window.plotcatUi.mountPlotCat(root, manager);
    await new Promise(resolve => {
      const poll = () => root.querySelector('[data-plotcat-run]').disabled ? setTimeout(poll, 0) : resolve();
      poll();
    });
    return calls;
  });
  assert.deepEqual(plotlyRendering, [
    {
      type: 'newPlot',
      data: [{ type: 'scatter', x: [1], y: [2] }],
      layout: {
        title: { text: 'Animated' },
        autosize: true,
        margin: { l: 40, r: 10, t: 30, b: 40 }
      },
      config: { scrollZoom: true, displayModeBar: false, responsive: true }
    },
    { type: 'addFrames', frames: [{ name: 'step-1', data: [{ y: [3] }] }] }
  ]);

  await load();
  const failedRun = await page.evaluate(async () => {
    const root = document.querySelector('.plotcat'); root.dataset.plotcatManifest = '{"id":"test","engine":"r"}';
    window.plotcatUi.mountPlotCat(root, { get: async () => { throw new Error('R package tinyplot is unavailable.'); }, run: async () => {} });
    root.querySelector('[data-plotcat-run]').click(); await new Promise(resolve => setTimeout(resolve, 0));
    return { status: root.querySelector('.plotcat__status').textContent, error: root.classList.contains('plotcat--error'), enabled: !root.querySelector('[data-plotcat-run]').disabled };
  });
  assert.deepEqual(failedRun, { status: 'R package tinyplot is unavailable.', error: true, enabled: true });

  await load();
  const failedTarget = await page.evaluate(async () => {
    const root = document.querySelector('.plotcat');
    root.dataset.plotcatManifest = '{"id":"test","engine":"r"}';
    root.dataset.plotcatTargetCode = btoa('target');
    window.plotcatUi.mountPlotCat(root, {
      get: async () => { throw new Error('target failed'); },
      run: async () => {}
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    return {
      status: root.querySelector('.plotcat__status').textContent,
      enabled: !root.querySelector('[data-plotcat-run]').disabled
    };
  });
  assert.deepEqual(failedTarget, { status: 'Error rendering target: target failed', enabled: true });

  const svg = { kind: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>' };
  const plotly = { kind: 'plotly', figure: { data: [] } };
  for (const [target, student] of [[svg, plotly], [plotly, svg]]) {
    assert.deepEqual(
      await runWithDifferentOutputTypes(target, student),
      { status: 'Student output must use the same plot type as the target.', complete: false }
    );
  }
} finally {
  await teardown();
}
