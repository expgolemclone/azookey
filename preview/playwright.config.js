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
  projects: [{ name: 'production' }, { name: 'development' }],
  webServer: [
    {
      command: 'npm run serve -- --port 0 --strictPort',
      env: { FORCE_COLOR: '0' },
      wait: { stdout: /(?<preview_production_url>http:\/\/127\.0\.0\.1:\d+\/)/ },
    },
    {
      command: 'npm start -- --port 0 --strictPort',
      env: { FORCE_COLOR: '0' },
      wait: { stdout: /(?<preview_development_url>http:\/\/127\.0\.0\.1:\d+\/)/ },
    },
  ],
});
