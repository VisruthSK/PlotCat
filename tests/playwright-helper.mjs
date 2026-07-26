import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';

export async function setupBrowserTest(dir = '.') {
  const server = await startStaticServer(dir);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  return {
    server,
    browser,
    page,
    async teardown() {
      await browser.close();
      await server.close();
    }
  };
}
