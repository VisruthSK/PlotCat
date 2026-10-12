import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 900_000,
  expect: { timeout: 180_000 },
  reporter: 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 1100, height: 800 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
    screenshot: 'only-on-failure'
  }
});
