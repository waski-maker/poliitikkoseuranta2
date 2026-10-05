import { defineConfig, devices } from '@playwright/test';

// Starts the API (Node) and the web UI against the database in DATABASE_URL.
// Uses the dev auth adapter; CI provides a disposable PostgreSQL service.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } }],
  webServer: [
    {
      command: 'pnpm --filter @ps/api exec tsx --env-file-if-exists=../../.env src/node.ts',
      url: 'http://localhost:8787/api/v1/health',
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @ps/web exec vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 60_000,
    },
  ],
});
