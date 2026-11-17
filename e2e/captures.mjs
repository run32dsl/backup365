import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { launchOptions, signInAs } from './browser.mjs';
import { startDemoServer } from './demo-server.mjs';
import { SCREENS, WIDTHS } from './screens.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'captures');

// Construit d'abord : une capture d'une version périmée de l'interface serait trompeuse.
if (process.env['BACKUP365_SKIP_BUILD'] !== '1') {
  execFileSync('pnpm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
}
mkdirSync(outDir, { recursive: true });

// Un serveur par version affichée : « dev » (sans commit) et, pour les écrans qui le demandent,
// celle d'une image construite. Lancés ensemble : l'attente des plans ne s'additionne pas.
const commits = [...new Set(SCREENS.map((screen) => screen.buildCommit))];
const started = await Promise.allSettled(
  commits.map((buildCommit) => startDemoServer({ settled: true, buildCommit })),
);
const servers = new Map();
started.forEach((result, i) => {
  if (result.status === 'fulfilled') servers.set(commits[i], result.value);
});
const stopServers = () => Promise.all([...servers.values()].map((server) => server.stop()));
const failed = started.find((result) => result.status === 'rejected');
if (failed) {
  await stopServers();
  throw failed.reason;
}
const written = [];
let browser;
try {
  browser = await chromium.launch(launchOptions());
  for (const screen of SCREENS) {
    const server = servers.get(screen.buildCommit);
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 800 },
        baseURL: server.baseURL,
        locale: 'fr-FR',
        timezoneId: 'UTC',
        colorScheme: screen.colorScheme ?? 'light',
      });
      try {
        if (screen.role) await signInAs(context, server.baseURL, screen.role);
        const page = await context.newPage();
        await page.goto(`/${screen.hash}`);
        await page.locator('main').waitFor();
        await screen.prepare?.(page);
        const file = join(outDir, `${screen.name}-${width}.png`);
        await page.screenshot({ path: file, fullPage: true });
        written.push(file);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser?.close();
  await stopServers();
}
for (const file of written) console.log(file.replace(`${root}/`, ''));
