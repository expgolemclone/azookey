import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.js',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    headless: true,
  },
  projects: [
    { name: 'production', use: { baseURL: 'http://127.0.0.1:4173' } },
    { name: 'development', use: { baseURL: 'http://127.0.0.1:5173' } },
  ],
  webServer: [
    {
      command: 'npm run serve -- --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
    },
    {
      command: 'npm start -- --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173',
    },
  ],
});
