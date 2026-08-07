import assert from 'node:assert/strict';
import { setupBrowserTest } from './playwright-helper.mjs';

const { server, page, teardown } = await setupBrowserTest('website/_site');
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

async function fillEditor(widget, code) {
  const content = widget.locator('.cm-content');
  await content.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await content.fill(code);
}

try {
  const suiteStarted = performance.now();
  const secondsSince = started => ((performance.now() - started) / 1000).toFixed(1);
  await page.goto(`${server.origin}/example.html`, { waitUntil: 'load' });
  const targetsStarted = performance.now();
  try {
    await page.waitForFunction(() => document.querySelectorAll('.plotcat__target-loading').length === 0, null, { timeout: 480000 });
  } catch (err) {
    console.error('TIMED OUT WAITING FOR TARGET LOADING. Failed requests:', failedRequests);
    throw err;
  }
  assert.equal(await page.locator('.plotcat').count(), 8);
  assert.equal(await page.locator('.plotcat__target-loading').count(), 0);
  assert.equal(await page.locator('.plotcat__student svg').count(), 0);
  await page.waitForFunction(() => document.querySelectorAll('.plotcat__editor .cm-editor').length === 8);
  assert.equal(await page.locator('.plotcat__editor .cm-editor').count(), 8);
  assert.equal(await page.locator('.plotcat__status[aria-live=polite]').count(), 8);
  assert.equal(await page.locator('[data-plotcat-wipe]').count(), 0);
  assert.equal(await page.locator('[data-plotcat-wipe-handle]').count(), 8);
  assert.equal(await page.locator('canvas').count(), 0);
  assert.ok(requests.some(origin => /webr\.r-wasm\.org/.test(origin)), 'WebR should preload on page load');
  assert.ok(requests.some(origin => /cdn\.jsdelivr\.net/.test(origin)), 'Pyodide should preload on page load');

  console.log(`TIMING: initial target renders ${secondsSince(targetsStarted)}s`);

  const html = await page.content();
  assert.doesNotMatch(html, /ax\.set_title|main = "Stopping distance|theme_minimal\(\)/);
  assert.match(await page.locator('#plotcat-exercise-1 .plotcat__editor').textContent(), /bill_len, bill_dep/);
  assert.doesNotMatch(await page.locator('#plotcat-exercise-1 .plotcat__editor').textContent(), /palmerpenguins/);
  assert.match(await page.locator('#plotcat-exercise-2 .plotcat__editor').textContent(), /tinyplot::tinyplot/);
  assert.match(await page.locator('#plotcat-exercise-3 .plotcat__editor').textContent(), /xyplot/);
  assert.match(await page.locator('#plotcat-exercise-4 .plotcat__editor').textContent(), /plot_ly/);
  assert.match(await page.locator('#plotcat-exercise-5 .plotcat__editor').textContent(), /ax\.scatter/);

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
  assert.equal(dark.body, 'rgb(10, 10, 10)');
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

  // Matplotlib
  const tk1 = performance.now();
  const matplotlib = page.locator('#plotcat-exercise-5');
  const matplotlibSolution = `import matplotlib.pyplot as plt
from sklearn.datasets import load_iris
iris = load_iris()
data = iris.data
fig, ax = plt.subplots()
ax.scatter(data[:, 0], data[:, 2])
ax.set_title("Iris sepal and petal length")
ax.set_xlabel("Sepal length (cm)")
ax.set_ylabel("Petal length (cm)")`;
  await fillEditor(matplotlib, matplotlibSolution);
  await matplotlib.locator('[data-plotcat-run]').click();
  await expectRendered(matplotlib, 'Matplotlib');
  assert.equal(await matplotlib.locator('.plotcat__student svg').count(), 1);
  const matplotlibSvg = await matplotlib.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML);
  assert.equal(await matplotlib.locator('.plotcat__score').textContent(), '100%');
  console.log(`TIMING: matplotlib ${secondsSince(tk1)}s`);

  // Plotnine
  const tk2 = performance.now();
  const plotnine = page.locator('#plotcat-exercise-6');
  const plotnineSolution = `from plotnine import ggplot, aes, geom_point, labs, theme_minimal
from plotnine.data import mtcars
plot = (
  ggplot(mtcars, aes("wt", "mpg", color="factor(cyl)"))
  + geom_point(size=3)
  + labs(title="Fuel economy by weight", x="Weight", y="Miles per gallon", color="Cylinders")
  + theme_minimal()
)
plot.show()`;
  await fillEditor(plotnine, plotnineSolution);
  await plotnine.locator('[data-plotcat-run]').click();
  await expectRendered(plotnine, 'Plotnine');
  assert.equal(await plotnine.locator('.plotcat__student svg').count(), 1);
  assert.ok(await plotnine.locator('.plotcat__student svg path').count() > 10);
  assert.notEqual(await plotnine.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML), matplotlibSvg);
  assert.equal(await plotnine.locator('.plotcat__score').textContent(), '100%');
  console.log(`TIMING: plotnine ${secondsSince(tk2)}s`);

  // ggplot2
  const tk3 = performance.now();
  const ggplot = first;
  const ggplotSolution = `library(ggplot2)

ggplot(penguins, aes(bill_len, bill_dep, colour = species)) +
  geom_point(size = 2, na.rm = TRUE) +
  labs(
    title = "Penguin bill dimensions",
    x = "Bill length (mm)",
    y = "Bill depth (mm)",
    colour = "Species"
  ) +
  theme_minimal() +
  theme(
    panel.grid.minor = element_blank(),
    legend.position = "bottom"
  )`;
  await fillEditor(ggplot, ggplotSolution);
  await ggplot.locator('[data-plotcat-run]').click();
  await expectRendered(ggplot, 'ggplot2');
  assert.equal(await ggplot.locator('.plotcat__student svg').count(), 1);
  assert.ok(await ggplot.locator('.plotcat__student svg').locator('path, circle').count() > 10);
  const ggplotComparison = await ggplot.evaluate(async node => {
    const script = document.querySelector('script[src*="plotcat.js"]');
    const svgUrl = script ? script.src.replace('plotcat.js', 'svg.js') : './site_libs/quarto-contrib/plotcat-0.3.0/svg.js';
    const { compareSvg } = await import(svgUrl);
    return compareSvg(node.querySelector('.plotcat__target svg').outerHTML, node.querySelector('.plotcat__student svg').outerHTML);
  });
  assert.equal(await ggplot.locator('.plotcat__score').textContent(), '100%', JSON.stringify(ggplotComparison));
  const ggplotSvg = await ggplot.locator('.plotcat__student svg').evaluate(svg => svg.outerHTML);
  console.log(`TIMING: ggplot2 ${secondsSince(tk3)}s`);

  // tinyplot
  const tk4 = performance.now();
  const tinyplot = page.locator('#plotcat-exercise-2');
  const tinyplotSolution = `tinyplot::tinyplot(dist ~ speed, data = cars, main = "Stopping distance by speed", xlab = "Speed", ylab = "Stopping distance")`;
  await fillEditor(tinyplot, tinyplotSolution);
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
  assert.equal(await tinyplot.locator('.plotcat__score').textContent(), '100%');
  console.log(`TIMING: tinyplot ${secondsSince(tk4)}s`);

  // lattice
  const tk5 = performance.now();
  const lattice = page.locator('#plotcat-exercise-3');
  const latticeSolution = `library(lattice)
xyplot(mpg ~ wt, data = mtcars, main = "MPG vs Weight", xlab = "Weight", ylab = "MPG")`;
  await fillEditor(lattice, latticeSolution);
  await lattice.locator('[data-plotcat-run]').click();
  await expectRendered(lattice, 'Lattice');
  assert.equal(await lattice.locator('.plotcat__student svg').count(), 1);
  assert.equal(await lattice.locator('.plotcat__score').textContent(), '100%');
  console.log(`TIMING: lattice ${secondsSince(tk5)}s`);

  // R Plotly
  const tk6 = performance.now();
  const rPlotly = page.locator('#plotcat-exercise-4');
  const rPlotlySolution = `library(plotly)
plot_ly(
  data = iris,
  x = ~Sepal.Length,
  y = ~Petal.Length,
  type = 'scatter',
  mode = 'markers',
  hovertemplate = '<b>Sepal length:</b> %{x}<br><b>Petal length:</b> %{y}<extra></extra>'
)`;
  await fillEditor(rPlotly, rPlotlySolution);
  await rPlotly.locator('[data-plotcat-run]').click();
  await expectRendered(rPlotly, 'R Plotly');
  assert.ok(await rPlotly.locator('.plotcat__student svg').count() >= 1);
  assert.equal(await rPlotly.locator('.plotcat__score').textContent(), '100%');
  console.log(`TIMING: R Plotly ${secondsSince(tk6)}s`);

  // seaborn
  const tk7 = performance.now();
  const seaborn = page.locator('#plotcat-exercise-7');
  const seabornSolution = `from sklearn.datasets import load_iris
import pandas as pd
import seaborn as sns
iris = load_iris()
df = pd.DataFrame(iris.data, columns=iris.feature_names)
df['species'] = iris.target
sns.scatterplot(data=df, x="sepal length (cm)", y="petal length (cm)", hue="species")`;
  await fillEditor(seaborn, seabornSolution);
  await seaborn.locator('[data-plotcat-run]').click();
  await expectRendered(seaborn, 'Seaborn');
  assert.equal(await seaborn.locator('.plotcat__student svg').count(), 1);
  assert.equal(await seaborn.locator('.plotcat__score').textContent(), '100%');
  console.log(`TIMING: seaborn ${secondsSince(tk7)}s`);

  // Python Plotly
  const tk8 = performance.now();
  const pyPlotly = page.locator('#plotcat-exercise-8');
  const pyPlotlySolution = `import plotly.graph_objects as go
from sklearn.datasets import load_iris

iris = load_iris(as_frame=True).frame
fig = go.Figure(data=go.Scatter(
    x=iris['sepal length (cm)'],
    y=iris['petal length (cm)'],
    mode='markers',
    hovertemplate='<b>Sepal length:</b> %{x}<br><b>Petal length:</b> %{y}<extra></extra>'
))
fig`;
  await fillEditor(pyPlotly, pyPlotlySolution);
  await pyPlotly.locator('[data-plotcat-run]').click();
  await expectRendered(pyPlotly, 'Python Plotly');
  assert.ok(await pyPlotly.locator('.plotcat__student svg').count() >= 1);
  assert.equal(await pyPlotly.locator('.plotcat__score').textContent(), '100%');
  console.log(`TIMING: Python Plotly ${secondsSince(tk8)}s`);

  // Plotly UI assertions: overlay/wipe disabled, side-by-side mode
  for (const [label, widget] of [['R Plotly', rPlotly], ['Python Plotly', pyPlotly]]) {
    assert.equal(await widget.locator('input[value=overlay]').isDisabled(), true, `${label} should disable overlay`);
    assert.equal(await widget.locator('input[value=wipe]').isDisabled(), true, `${label} should disable wipe`);
    assert.equal(await widget.evaluate(node => node.classList.contains('plotcat--side-by-side')), true, `${label} should use side-by-side comparison`);
  }
  console.log(`TIMING: total ${secondsSince(suiteStarted)}s`);
} finally {
  await teardown();
}
