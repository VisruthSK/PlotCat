import { expect, test, type Locator, type Page } from 'playwright/test';
import { startStaticServer } from '../static-server.mjs';

let server: { origin: string; close: () => Promise<void> };
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  server = await startStaticServer('website/_site');
  page = await browser.newPage();
  await page.goto(`${server.origin}/example.html`, { waitUntil: 'load' });
});

test.afterAll(async () => {
  await page?.close();
  await server?.close();
});

const tinyplotSolution = 'tinyplot::tinyplot(dist ~ speed, data = cars, main = "Stopping distance by speed", xlab = "Speed", ylab = "Stopping distance")';

function exercise(id: number): Locator {
  return page.locator(`#plotcat-exercise-${id}`);
}

async function setCode(widget: Locator, code: string) {
  const content = widget.locator('.cm-content');
  await content.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await content.fill(code);
}

async function run(widget: Locator) {
  await widget.locator('[data-plotcat-run]').click();
  await expect(widget).toHaveClass(/plotcat--(complete|error)/);
}

async function expectScore(widget: Locator, score: string) {
  await expect(widget).toHaveClass(/plotcat--complete/);
  await expect(widget.locator('.plotcat__score')).toHaveText(score);
}

test('Run reads executable code outside the editor viewport', async () => {
  const widget = exercise(2);
  await widget.scrollIntoViewIfNeeded();
  await expect(widget.locator('.plotcat__target-loading')).toHaveCount(0, { timeout: 480_000 });
  const filler = Array.from({ length: 1000 }, () => '# filler');
  await setCode(widget, ['solution <- function() {', tinyplotSolution, '}', ...filler, 'solution()'].join('\n'));
  await expect(widget.locator('.cm-content')).not.toContainText('solution <-');
  await run(widget);
  expect(await widget.locator('.plotcat__status').textContent()).toBe('');
  await expectScore(widget, '100%');
});

test('a second Run reads the edited code, not the code from the first Run', async () => {
  const widget = exercise(2);
  await setCode(widget, 'stop("first run")');
  await run(widget);
  await expect(widget.locator('.plotcat__status')).toContainText('first run');

  await setCode(widget, tinyplotSolution);
  await run(widget);
  await expectScore(widget, '100%');
});

test('Ctrl/Cmd+Enter in the editor runs PlotCat', async () => {
  const widget = exercise(2);
  await setCode(widget, tinyplotSolution);
  await widget.locator('.cm-content').focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  await expectScore(widget, '100%');
});

test("Quarto Live's own Run button exists and is hidden", async () => {
  const runButton = exercise(2).locator('.exercise-editor-btn-run-code');
  await expect(runButton).toHaveCount(1);
  await expect(runButton).toBeHidden();
});

test('the Quarto Live bridge cell does not leak into the page text', async () => {
  await expect(page.locator('body')).not.toContainText('window.plotCat');
});
