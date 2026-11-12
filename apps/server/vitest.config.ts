import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const core = (file: string): string =>
  fileURLToPath(new URL(`../../packages/core/src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: '@backup365/core/testing', replacement: core('testing.ts') },
      { find: '@backup365/core', replacement: core('index.ts') },
    ],
  },
});
