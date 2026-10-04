import { defineConfig, devices } from '@playwright/test';

// Uses the system Chromium when PLAYWRIGHT_CHROMIUM is set (CI images often
// ship one); otherwise Playwright's own download.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Pixel 7'],
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
