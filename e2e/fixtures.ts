import { test as base, expect } from '@playwright/test';
import { startDemoServer } from './demo-server.mjs';

/** Un serveur de démonstration par worker ; `baseURL` pointe dessus. */
export const test = base.extend<object, { demo: { baseURL: string } }>({
  demo: [
    // Playwright exige la forme destructurée, même vide.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = await startDemoServer();
      await use({ baseURL: server.baseURL });
      await server.stop();
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ demo }, use) => {
    await use(demo.baseURL);
  },
});

export { expect };
