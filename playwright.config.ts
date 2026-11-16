import { defineConfig } from '@playwright/test';
import { launchOptions } from './e2e/browser.mjs';

// Le serveur de démonstration est lancé par les tests (e2e/fixtures.ts), sur un port libre.
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    locale: 'fr-FR',
    trace: 'retain-on-failure',
    launchOptions: launchOptions(),
  },
});
