import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { DEFAULT_LANG, launchOptions, requestedLang, signInAs } from './browser.mjs';
import { startDemoServer } from './demo-server.mjs';
import { reportCapturesDuration } from './durees.mjs';
import { SCREENS, WIDTHS } from './screens.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'captures');
// `pnpm run captures --lang=en-US` : même rendu attendu, quelle que soit la langue du navigateur.
const lang = requestedLang();
// La durée relevée couvre toute la commande, construction comprise quand elle a lieu.
const startedAt = performance.now();

// Construit d'abord : une capture d'une version périmée de l'interface serait trompeuse.
if (process.env['BACKUP365_SKIP_BUILD'] !== '1') {
  execFileSync('pnpm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
}
mkdirSync(outDir, { recursive: true });

const server = await startDemoServer({ settled: true });
const browser = await chromium.launch(launchOptions(process.env, lang));
const written = [];
try {
  for (const screen of SCREENS) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 800 },
        baseURL: server.baseURL,
        locale: lang ?? DEFAULT_LANG,
        timezoneId: 'UTC',
        colorScheme: screen.scheme ?? 'light',
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
  await browser.close();
  await server.stop();
}
for (const file of written) console.log(file.replace(`${root}/`, ''));
console.log(`${written.length} captures, navigateur en ${lang ?? DEFAULT_LANG}`);
reportCapturesDuration(performance.now() - startedAt, written.length);
