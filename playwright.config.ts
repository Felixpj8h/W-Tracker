import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './tests',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: { VITE_API_URL: '/api/v1' },
  },
  use: {
    baseURL,
  },
  projects: [
    {
      name: 'iPhone Safari',
      use: {
        ...devices['iPhone 17'],
        browserName: 'webkit',
      },
    },
    {
      name: 'Android Chrome',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
  ],
});
