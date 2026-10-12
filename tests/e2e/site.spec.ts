import { expect, test, type Locator, type Page } from 'playwright/test';
import { startStaticServer } from '../static-server.mjs';

let server: { origin: string; close: () => Promise<void> };
let page: Page;
const requests: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  server = await startStaticServer('website/_site');
  page = await browser.newPage();
  page.on('request', request => requests.push(new URL(request.url()).origin));
  await page.goto(`${server.origin}/example.html`, { waitUntil: 'load' });
});

test.afterAll(async () => {
  await page?.close();
  await server?.close();
});

function exercise(id: number): Locator {
  return page.locator(`#plotcat-exercise-${id}`);
}

async function fillEditor(widget: Locator, code: string) {
  const content = widget.locator('.cm-content');
  await content.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await content.fill(code);
}

async function runAndWait(widget: Locator) {
  await widget.locator('[data-plotcat-run]').click();
  await expect(widget).toHaveClass(/plotcat--(complete|error)/);
}

async function expectScore(widget: Locator, score: string) {
  await expect(widget).toHaveClass(/plotcat--complete/);
  await expect(widget.locator('.plotcat__status')).toHaveText('');
  await expect(widget.locator('.plotcat__score')).toHaveText(score);
}

async function outerSvg(widget: Locator, part: 'target' | 'student'): Promise<string> {
  return widget.locator(`.plotcat__${part} svg`).evaluate(svg => svg.outerHTML);
}

test('the first target renders without scrolling and the rest render once scrolled into view', async () => {
  await expect(page.locator('.plotcat')).toHaveCount(8);
  await expect(exercise(1).locator('.plotcat__target-loading')).toHaveCount(0, { timeout: 480_000 });
  for (let id = 2; id <= 8; id++) {
    await exercise(id).scrollIntoViewIfNeeded();
    await expect(exercise(id).locator('.plotcat__target-loading')).toHaveCount(0, { timeout: 480_000 });
  }
  await expect(page.locator('.plotcat__target-loading')).toHaveCount(0);
  await expect(page.locator('.plotcat__student svg')).toHaveCount(0);
  await expect(page.locator('.plotcat__editor .cm-editor')).toHaveCount(8);
  await expect(page.locator('.plotcat__status[aria-live=polite]')).toHaveCount(8);
  await expect(page.locator('[data-plotcat-wipe-handle]')).toHaveCount(8);
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(requests.some(origin => /webr\.r-wasm\.org/.test(origin)), 'WebR should load on page load').toBe(true);
  expect(requests.some(origin => /cdn\.jsdelivr\.net/.test(origin)), 'Pyodide should load on page load').toBe(true);

  const html = await page.content();
  expect(html).not.toMatch(/ax\.set_title|main = "Stopping distance|theme_minimal\(\)/);
  await expect(exercise(1).locator('.plotcat__editor')).toContainText('bill_len, bill_dep');
  await expect(exercise(1).locator('.plotcat__editor')).not.toContainText('palmerpenguins');
  await expect(exercise(2).locator('.plotcat__editor')).toContainText('tinyplot::tinyplot');
  await expect(exercise(3).locator('.plotcat__editor')).toContainText('xyplot');
  await expect(exercise(4).locator('.plotcat__editor')).toContainText('plot_ly');
  await expect(exercise(5).locator('.plotcat__editor')).toContainText('ax.scatter');
});

test('overlay and wipe modes switch and the wipe handle drags', async () => {
  const first = exercise(1);
  await first.locator('input[value=overlay]').click();
  await expect(first).toHaveClass(/plotcat--overlay/);

  await first.locator('input[value=wipe]').click();
  const handle = first.locator('[data-plotcat-wipe-handle]');
  await handle.focus();
  await handle.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '51');
  await expect(first).toHaveAttribute('style', /--plotcat-wipe: 51%/);

  const body = await first.locator('.plotcat__body').boundingBox();
  const grip = await handle.boundingBox();
  expect(body && grip).toBeTruthy();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(body!.x + body!.width * 0.67, body!.y + body!.height / 2);
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '67');
  await expect(first).toHaveAttribute('style', /--plotcat-wipe: 67%/);
});

test('light, dark, and custom theme variables restyle the widget', async () => {
  const themeColors = () => exercise(1).evaluate(node => ({
    body: getComputedStyle(document.body).backgroundColor,
    widget: getComputedStyle(node).backgroundColor,
    primary: getComputedStyle(node).getPropertyValue('--bs-primary').trim(),
    accent: getComputedStyle(node).getPropertyValue('--plotcat-accent').trim(),
    text: getComputedStyle(node).color,
    plot: getComputedStyle(node.querySelector('.plotcat__plot')!).backgroundColor,
    editor: getComputedStyle(node.querySelector('.plotcat-editor-container')!).backgroundColor,
    button: getComputedStyle(node.querySelector('.plotcat__button')!).backgroundColor,
    selected: getComputedStyle(node.querySelector('.plotcat__compare label:has(input:checked)')!).backgroundColor,
    wipeLine: getComputedStyle(node.querySelector('.plotcat__wipe-handle')!, '::before').backgroundColor,
    wipeGrip: getComputedStyle(node.querySelector('.plotcat__wipe-handle')!, '::after').backgroundColor,
    status: getComputedStyle(node.querySelector('.plotcat__status')!).color
  }));

  const light = await themeColors();
  await page.evaluate(() => (window as any).quartoToggleColorScheme());
  await expect(page.locator('body')).toHaveClass(/quarto-dark/);
  const dark = await themeColors();
  expect(dark).not.toEqual(light);
  expect(dark.widget).toBe(dark.body);
  expect(dark.plot).toBe(dark.body);
  expect(dark.editor).not.toBe(light.editor);

  const variables = {
    '--bs-body-bg': '#123456',
    '--bs-body-color': '#fedcba',
    '--bs-primary': '#654321',
    '--bs-primary-rgb': '101, 67, 33',
    '--bs-secondary-color': '#abcdef'
  };
  await page.evaluate(values => {
    for (const [name, value] of Object.entries(values)) document.body.style.setProperty(name, value);
  }, variables);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  const custom = await themeColors();
  expect(custom.widget).toBe('rgb(18, 52, 86)');
  expect(custom.plot).toBe(custom.widget);
  expect(custom.text).toBe('rgb(254, 220, 186)');
  expect(custom.primary).toBe('#654321');
  expect(custom.accent).toBe('#654321');
  expect(custom.button).toBe('rgb(101, 67, 33)');
  expect(custom.selected).toBe(custom.button);
  expect(custom.wipeLine).not.toBe(light.wipeLine);
  expect(custom.wipeGrip).not.toBe(light.wipeGrip);
  expect(custom.status).toBe('rgb(171, 205, 239)');

  await page.evaluate(names => {
    for (const name of names) document.body.style.removeProperty(name);
  }, Object.keys(variables));
  await page.evaluate(() => (window as any).quartoToggleColorScheme());
  await expect(page.locator('body')).not.toHaveClass(/quarto-dark/);
});

test('matplotlib solution scores 100%', async () => {
  const widget = exercise(5);
  await fillEditor(widget, `import matplotlib.pyplot as plt
from sklearn.datasets import load_iris
iris = load_iris()
data = iris.data
fig, ax = plt.subplots()
ax.scatter(data[:, 0], data[:, 2])
ax.set_title("Iris sepal and petal length")
ax.set_xlabel("Sepal length (cm)")
ax.set_ylabel("Petal length (cm)")`);
  await runAndWait(widget);
  await expectScore(widget, '100%');
  await expect(widget.locator('.plotcat__student svg')).toHaveCount(1);
});

test('plotnine solution scores 100% and differs from matplotlib', async () => {
  const widget = exercise(6);
  await fillEditor(widget, `from plotnine import ggplot, aes, geom_point, labs, theme_minimal
from plotnine.data import mtcars
plot = (
  ggplot(mtcars, aes("wt", "mpg", color="factor(cyl)"))
  + geom_point(size=3)
  + labs(title="Fuel economy by weight", x="Weight", y="Miles per gallon", color="Cylinders")
  + theme_minimal()
)
plot.show()`);
  await runAndWait(widget);
  await expectScore(widget, '100%');
  await expect(widget.locator('.plotcat__student svg path').first()).toBeAttached();
  expect(await outerSvg(widget, 'student')).not.toBe(await outerSvg(exercise(5), 'student'));
});

test('ggplot2 solution scores 100% and the comparison screenshot is captured', async () => {
  const widget = exercise(1);
  await fillEditor(widget, `library(ggplot2)

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
  )`);
  await runAndWait(widget);
  await expectScore(widget, '100%');
  await widget.screenshot({ path: '.test-output/ggplot-exercise.png' });
});

test('tinyplot solution scores 100% with resolvable references', async () => {
  const widget = exercise(2);
  await fillEditor(widget, 'tinyplot::tinyplot(dist ~ speed, data = cars, main = "Stopping distance by speed", xlab = "Speed", ylab = "Stopping distance")');
  await runAndWait(widget);
  await expectScore(widget, '100%');

  const references = await widget.evaluate(node => {
    const target = node.querySelector('.plotcat__target svg')!;
    const student = node.querySelector('.plotcat__student svg')!;
    const targetIds = new Set([...target.querySelectorAll('[id]')].map(element => element.id));
    const overlap = [...student.querySelectorAll('[id]')].filter(element => targetIds.has(element.id)).map(element => element.id);
    const uses = [...student.querySelectorAll('use[href^="#"]')];
    const unresolved = uses
      .filter(use => !student.querySelector(`#${CSS.escape(use.getAttribute('href')!.slice(1))}`))
      .map(use => use.getAttribute('href'));
    const labels = [...student.querySelectorAll('text')].map(text => text.textContent!.trim()).filter(Boolean);
    return { overlap, unresolved, labels };
  });
  expect(references.overlap).toEqual([]);
  expect(references.unresolved).toEqual([]);
  expect(references.labels.some(label => /speed/i.test(label))).toBe(true);
  expect(references.labels.some(label => /dist/i.test(label))).toBe(true);
});

test('lattice solution scores 100%', async () => {
  const widget = exercise(3);
  await fillEditor(widget, `library(lattice)
xyplot(mpg ~ wt, data = mtcars, main = "MPG vs Weight", xlab = "Weight", ylab = "MPG")`);
  await runAndWait(widget);
  await expectScore(widget, '100%');
});

test('R plotly solution scores 100% and keeps only side-by-side comparison', async () => {
  const widget = exercise(4);
  await fillEditor(widget, `library(plotly)
plot_ly(
  data = iris,
  x = ~Sepal.Length,
  y = ~Petal.Length,
  type = 'scatter',
  mode = 'markers',
  hovertemplate = '<b>Sepal length:</b> %{x}<br><b>Petal length:</b> %{y}<extra></extra>'
)`);
  await runAndWait(widget);
  await expectScore(widget, '100%');
  await expect(widget.locator('input[value=overlay]')).toBeDisabled();
  await expect(widget.locator('input[value=wipe]')).toBeDisabled();
  await expect(widget).toHaveClass(/plotcat--side-by-side/);
});

test('seaborn solution scores 100%', async () => {
  const widget = exercise(7);
  await fillEditor(widget, `from sklearn.datasets import load_iris
import pandas as pd
import seaborn as sns
iris = load_iris()
df = pd.DataFrame(iris.data, columns=iris.feature_names)
df['species'] = iris.target
sns.scatterplot(data=df, x="sepal length (cm)", y="petal length (cm)", hue="species")`);
  await runAndWait(widget);
  await expectScore(widget, '100%');
});

test('Python plotly solution scores 100% and keeps only side-by-side comparison', async () => {
  const widget = exercise(8);
  await fillEditor(widget, `import plotly.graph_objects as go
from sklearn.datasets import load_iris

iris = load_iris(as_frame=True).frame
fig = go.Figure(data=go.Scatter(
    x=iris['sepal length (cm)'],
    y=iris['petal length (cm)'],
    mode='markers',
    hovertemplate='<b>Sepal length:</b> %{x}<br><b>Petal length:</b> %{y}<extra></extra>'
))
fig`);
  await runAndWait(widget);
  await expectScore(widget, '100%');
  await expect(widget.locator('input[value=overlay]')).toBeDisabled();
  await expect(widget.locator('input[value=wipe]')).toBeDisabled();
});

test('broken code reports the error and re-enables Run', async () => {
  const widget = exercise(1);
  await fillEditor(widget, 'ggplot(penguins, aes(bill_len, bill_dep)) +');
  await runAndWait(widget);
  await expect(widget).toHaveClass(/plotcat--error/);
  await expect(widget.locator('.plotcat__status')).not.toBeEmpty();
  await expect(widget.locator('[data-plotcat-run]')).toBeEnabled();
});

test('code that draws nothing reports a plot hint', async () => {
  const widget = exercise(1);
  await fillEditor(widget, '1 + 1');
  await runAndWait(widget);
  await expect(widget).toHaveClass(/plotcat--error/);
  await expect(widget.locator('.plotcat__status')).toContainText('Code did not produce a plot');
});
