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
page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
page.on('pageerror', err => console.error('BROWSER PAGE ERROR:', err.message));

async function expectRendered(widget, label) {
  const element = await widget.elementHandle();
  await page.waitForFunction(node => node.classList.contains('plotcat--complete') || node.classList.contains('plotcat--error'), element);
  const status = await widget.locator('.plotcat__status').textContent();
  assert.equal(status, '', `${label} failed: ${status}; failed requests: ${failedRequests.join(' | ') || 'none'}`);
}

try {
  await page.goto(`${server.origin}/example.html`, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => document.querySelectorAll('.plotcat__target-loading').length === 0, null, { timeout: 480000 });
  } catch (err) {
    console.error('TIMED OUT WAITING FOR TARGET LOADING. Failed requests:', failedRequests);
    throw err;
  }
  assert.equal(await page.locator('.plotcat').count(), 8);
  assert.equal(await page.locator('.plotcat__target-loading').count(), 0);
  assert.equal(await page.locator('.plotcat__student svg').count(), 0);
  assert.equal(await page.locator('.plotcat__textarea').count(), 8);
  assert.equal(await page.locator('.plotcat__status[aria-live=polite]').count(), 8);
  assert.equal(await page.locator('[data-plotcat-wipe]').count(), 0);
  assert.equal(await page.locator('[data-plotcat-wipe-handle]').count(), 8);
  assert.equal(await page.locator('canvas').count(), 0);
  assert.ok(requests.some(origin => /webr\.r-wasm\.org/.test(origin)), 'WebR should preload on page load');
  assert.ok(requests.some(origin => /cdn\.jsdelivr\.net/.test(origin)), 'Pyodide should preload on page load');

  const html = await page.content();
  assert.doesNotMatch(html, /ax\.set_title|main = "Stopping distance|theme_minimal\(\)/);
  assert.match(await page.locator('#plotcat-exercise-1 textarea.plotcat__textarea').inputValue(), /bill_len, bill_dep/);
  assert.doesNotMatch(await page.locator('#plotcat-exercise-1 textarea.plotcat__textarea').inputValue(), /palmerpenguins/);
  assert.match(await page.locator('#plotcat-exercise-2 textarea.plotcat__textarea').inputValue(), /tinyplot::tinyplot/);
  assert.match(await page.locator('#plotcat-exercise-3 textarea.plotcat__textarea').inputValue(), /xyplot/);
  assert.match(await page.locator('#plotcat-exercise-4 textarea.plotcat__textarea').inputValue(), /plot_ly/);
  assert.match(await page.locator('#plotcat-exercise-5 textarea.plotcat__textarea').inputValue(), /ax\.scatter/);

  const first = page.locator('#plotcat-exercise-1');
  await first.locator('input[value=overlay]').click();
  assert.ok(await first.evaluate(node => node.classList.contains('plotcat--overlay')));
  await first.locator('input[value=wipe]').click();
  const wipeHandle = first.locator('[data-plotcat-wipe-handle]');
  await wipeHandle.focus(); await wipeHandle.press('ArrowRight');
  assert.equal(await wipeHandle.getAttribute('aria-valuenow'), '51');
  assert.equal(await first.evaluate(node => node.style.getPropertyValue('--plotcat-wipe')), '51%');
  const bodyBox = await first.locator('.plotcat__body').boundingBox();
  const handleBox = await wipeHandle.boundingBox();
  assert.ok(bodyBox && handleBox);
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(bodyBox.x + bodyBox.width * 0.67, bodyBox.y + bodyBox.height / 2);
  await page.mouse.up();
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
  const matplotlib = page.locator('#plotcat-exercise-5');
  await matplotlib.locator('[data-plotcat-run]').click();
  await expectRendered(matplotlib, 'Matplotlib');
  assert.equal(await matplotlib.locator('.plotcat__student svg').count(), 1);
  const matplotlibSvg = await matplotlib.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML);

  const plotnine = page.locator('#plotcat-exercise-6');
  await plotnine.locator('[data-plotcat-run]').click();
  await expectRendered(plotnine, 'Plotnine');
  assert.equal(await plotnine.locator('.plotcat__student svg').count(), 1);
  assert.ok(await plotnine.locator('.plotcat__student svg path').count() > 10);
  assert.notEqual(await plotnine.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML), matplotlibSvg);

  const ggplot = first;
  const ggplotSolution = `ggplot2::ggplot(penguins, ggplot2::aes(colour = species, x = bill_len, y = bill_dep)) +
  ggplot2::geom_point(size = 2.5, alpha = 0.75, na.rm = TRUE) +
  ggplot2::labs(
    title = "Penguin bill dimensions",
    colour = "Species",
    x = "Bill length (mm)",
    y = "Bill depth (mm)"
  ) +
  ggplot2::theme_minimal(base_size = 12) +
  ggplot2::theme(
    legend.position = "bottom",
    panel.grid.minor = ggplot2::element_blank(),
    plot.title.position = "plot"
  )`;
  await ggplot.locator('textarea.plotcat__textarea').fill(ggplotSolution);
  await ggplot.locator('[data-plotcat-run]').click();
  await expectRendered(ggplot, 'ggplot2');
  assert.equal(await ggplot.locator('.plotcat__student svg').count(), 1);
  assert.ok(await ggplot.locator('.plotcat__student svg').locator('path, circle').count() > 10);
  const ggplotComparison = await ggplot.evaluate(async node => {
    const { compareSvg } = await import('./site_libs/quarto-contrib/plotcat-0.1.0/svg.js');
    return compareSvg(node.querySelector('.plotcat__target svg').outerHTML, node.querySelector('.plotcat__student svg').outerHTML);
  });
  assert.equal(await ggplot.locator('.plotcat__score').textContent(), '100%', JSON.stringify(ggplotComparison));
  const ggplotSvg = await ggplot.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML);

  const tinyplot = page.locator('#plotcat-exercise-2');
  await tinyplot.locator('[data-plotcat-run]').click();
  await expectRendered(tinyplot, 'tinyplot');
  assert.equal(await tinyplot.locator('.plotcat__student svg').count(), 1);
  assert.notEqual(await tinyplot.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML), ggplotSvg);
  const tinyplotReferences = await tinyplot.evaluate(node => {
    const target = node.querySelector('.plotcat__target svg');
    const student = node.querySelector('.plotcat__student svg');
    const targetIds = new Set([...target.querySelectorAll('[id]')].map(element => element.id));
    const studentIds = new Set([...student.querySelectorAll('[id]')].map(element => element.id));
    const overlap = [...studentIds].filter(id => targetIds.has(id));
    const uses = [...student.querySelectorAll('use[href^="#"]')];
    const unresolved = uses.filter(use => !student.querySelector(`#${CSS.escape(use.getAttribute('href').slice(1))}`));
    const labels = [...student.querySelectorAll('text')].map(text => text.textContent.trim()).filter(Boolean);
    return { overlap, useCount: uses.length, unresolved: unresolved.map(use => use.getAttribute('href')), labels };
  });
  assert.deepEqual(tinyplotReferences.overlap, []);
  assert.deepEqual(tinyplotReferences.unresolved, []);
  assert.ok(tinyplotReferences.labels.some(label => /speed/i.test(label)), 'tinyplot x-axis text should render');
  assert.ok(tinyplotReferences.labels.some(label => /dist/i.test(label)), 'tinyplot y-axis text should render');

  const lattice = page.locator('#plotcat-exercise-3');
  const latticeSolution = `library(lattice)
xyplot(mpg ~ wt, data = mtcars, main = "MPG vs Weight", xlab = "Weight", ylab = "MPG")`;
  await lattice.locator('textarea.plotcat__textarea').fill(latticeSolution);
  await lattice.locator('[data-plotcat-run]').click();
  await expectRendered(lattice, 'Lattice');
  assert.equal(await lattice.locator('.plotcat__student svg').count(), 1);
  assert.equal(await lattice.locator('.plotcat__score').textContent(), '100%');

  const rPlotly = page.locator('#plotcat-exercise-4');
  
  // R Plotly Red Step: submit ggplotly code against a raw plot_ly target
  const rPlotlyIncorrect = `library(plotly)
library(ggplot2)
p <- ggplot(iris, aes(x = Sepal.Length, y = Petal.Length)) + geom_point()
ggplotly(p)`;
  await rPlotly.locator('textarea.plotcat__textarea').fill(rPlotlyIncorrect);
  await rPlotly.locator('[data-plotcat-run]').click();
  await expectRendered(rPlotly, 'R Plotly (Incorrect - ggplotly vs plot_ly)');
  const incorrectRScoreText = await rPlotly.locator('.plotcat__score').textContent();
  const incorrectRScore = parseInt(incorrectRScoreText);
  assert.ok(incorrectRScore < 100, `R Plotly ggplotly solution should score < 100% against plot_ly target, but got ${incorrectRScore}%`);
  const rFeedback = await rPlotly.locator('.plotcat__feedback').textContent();
  assert.ok(rFeedback.includes('expected') || rFeedback.length > 0, 'Feedback should report trace/layout mismatches');

  // R Plotly Green Step: submit correct plot_ly code
  const rPlotlySolution = `library(plotly)
plot_ly(data = iris, x = ~Sepal.Length, y = ~Petal.Length, type = 'scatter', mode = 'markers')`;
  await rPlotly.locator('textarea.plotcat__textarea').fill(rPlotlySolution);
  await rPlotly.locator('[data-plotcat-run]').click();
  await expectRendered(rPlotly, 'R Plotly (Correct)');
  assert.ok(await rPlotly.locator('.plotcat__student svg').count() >= 1);
  assert.equal(await rPlotly.locator('.plotcat__score').textContent(), '100%');

  const seaborn = page.locator('#plotcat-exercise-7');
  const seabornSolution = `from sklearn.datasets import load_iris
import pandas as pd
import seaborn as sns
iris = load_iris()
df = pd.DataFrame(iris.data, columns=iris.feature_names)
df['species'] = iris.target
sns.scatterplot(data=df, x="sepal length (cm)", y="petal length (cm)", hue="species")`;
  await seaborn.locator('textarea.plotcat__textarea').fill(seabornSolution);
  await seaborn.locator('[data-plotcat-run]').click();
  await expectRendered(seaborn, 'Seaborn');
  assert.equal(await seaborn.locator('.plotcat__student svg').count(), 1);
  assert.equal(await seaborn.locator('.plotcat__score').textContent(), '100%');

  const pyPlotly = page.locator('#plotcat-exercise-8');

  // Python Plotly Red Step: submit incorrect coordinates
  const pyPlotlyIncorrect = `import plotly.graph_objects as go
fig = go.Figure(data=go.Scatter(x=[1, 2, 9], y=[4, 5, 6], mode='markers'))
fig`;
  await pyPlotly.locator('textarea.plotcat__textarea').fill(pyPlotlyIncorrect);
  await pyPlotly.locator('[data-plotcat-run]').click();
  await expectRendered(pyPlotly, 'Python Plotly (Incorrect)');
  const incorrectPyScoreText = await pyPlotly.locator('.plotcat__score').textContent();
  const incorrectPyScore = parseInt(incorrectPyScoreText);
  assert.ok(incorrectPyScore < 100, `Python Plotly incorrect solution should score < 100%, but got ${incorrectPyScore}%`);

  // Python Plotly Green Step: submit correct coordinates
  const pyPlotlySolution = `import plotly.graph_objects as go
fig = go.Figure(data=go.Scatter(x=[1, 2, 3], y=[4, 5, 6], mode='markers'))
fig`;
  await pyPlotly.locator('textarea.plotcat__textarea').fill(pyPlotlySolution);
  await pyPlotly.locator('[data-plotcat-run]').click();
  await expectRendered(pyPlotly, 'Python Plotly (Correct)');
  assert.ok(await pyPlotly.locator('.plotcat__student svg').count() >= 1);
  assert.equal(await pyPlotly.locator('.plotcat__score').textContent(), '100%');

  for (const [label, widget] of [['R Plotly', rPlotly], ['Python Plotly', pyPlotly]]) {
    assert.equal(await widget.locator('input[value=overlay]').isDisabled(), true, `${label} should disable overlay`);
    assert.equal(await widget.locator('input[value=wipe]').isDisabled(), true, `${label} should disable wipe`);
    assert.equal(await widget.evaluate(node => node.classList.contains('plotcat--side-by-side')), true, `${label} should use side-by-side comparison`);
  }
} finally {
  await browser.close();
  await server.close();
}
