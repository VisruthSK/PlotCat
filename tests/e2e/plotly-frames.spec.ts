import { expect, test, type Page } from 'playwright/test';
import { startStaticServer } from '../static-server.mjs';

let server: { origin: string; close: () => Promise<void> };

test.beforeAll(async () => {
  server = await startStaticServer('.');
});

test.afterAll(async () => {
  await server?.close();
});

function figure(frames: { name: string; y: number[] }[]) {
  return {
    data: [{ type: 'scatter', mode: 'markers', x: [1, 2, 3], y: [1, 2, 3] }],
    layout: { title: { text: 'Animated' } },
    frames: frames.map(frame => ({ name: frame.name, data: [{ y: frame.y }] })),
    config: {}
  };
}

async function openFixture(page: Page) {
  await page.goto(`${server.origin}/tests/fixtures/plotly-frames.html`);
  await page.waitForFunction(() => (window as any).fixtureReady === true);
}

async function renderFrames(page: Page, frames: { name: string; y: number[] }[]) {
  await page.evaluate(async figureSource => (window as any).renderFigure(figureSource), figure(frames));
}

async function frameNames(page: Page) {
  return page.evaluate(() => {
    const gd = document.querySelector('.plotcat-plotly') as any;
    return (gd?._transitionData?._frames ?? []).map((frame: { name: string }) => frame.name);
  });
}

test('a figure with frames renders them in real Plotly', async ({ page }) => {
  await openFixture(page);
  await renderFrames(page, [{ name: 'step-1', y: [2, 3, 4] }, { name: 'step-2', y: [3, 4, 5] }]);
  expect(await frameNames(page)).toEqual(['step-1', 'step-2']);
});

test('animating to a frame moves the plotted data', async ({ page }) => {
  await openFixture(page);
  await renderFrames(page, [{ name: 'step-1', y: [2, 3, 4] }, { name: 'step-2', y: [9, 8, 7] }]);
  await page.evaluate(async () => {
    const gd = document.querySelector('.plotcat-plotly') as any;
    await (window as any).Plotly.animate(gd, ['step-2'], { transition: { duration: 0 }, frame: { duration: 0, redraw: true }, mode: 'immediate' });
  });
  const y = await page.evaluate(() => (document.querySelector('.plotcat-plotly') as any).data[0].y);
  expect(y).toEqual([9, 8, 7]);
});

test('re-rendering replaces frames instead of appending them', async ({ page }) => {
  await openFixture(page);
  await renderFrames(page, [{ name: 'a', y: [1, 1, 1] }, { name: 'b', y: [2, 2, 2] }]);
  await renderFrames(page, [{ name: 'c', y: [3, 3, 3] }]);
  expect(await frameNames(page)).toEqual(['c']);
});

test('re-rendering without frames clears previous frames', async ({ page }) => {
  await openFixture(page);
  await renderFrames(page, [{ name: 'a', y: [1, 1, 1] }]);
  await renderFrames(page, []);
  expect(await frameNames(page)).toEqual([]);
});
