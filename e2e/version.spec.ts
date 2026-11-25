import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { DEMO_LOGINS, startDemoServer } from './demo-server.mjs';
import { IMAGE_COMMIT } from './screens.mjs';

const { version: packageVersion } = JSON.parse(
  readFileSync(new URL('../apps/server/package.json', import.meta.url), 'utf8'),
) as { version: string };

/** Serveur lancé comme dans une image : `commit` est le commit court reçu au build, s'il existe. */
const test = base.extend<{ commit: string | undefined }>({
  commit: [undefined, { option: true }],
  baseURL: async ({ commit }, use) => {
    const server = await startDemoServer({ buildCommit: commit });
    await use(server.baseURL);
    await server.stop();
  },
});

// Chaque test lance son serveur : son démarrage compte dans le délai du test.
test.describe.configure({ timeout: 60_000 });

test.describe('serveur lancé avec le commit d’une image', () => {
  test.use({ commit: IMAGE_COMMIT });

  test('version du paquet et commit, jamais 0.0.0, avant et après connexion', async ({
    page,
    request,
  }) => {
    const expected = `${packageVersion} · ${IMAGE_COMMIT}`;
    expect(packageVersion).not.toBe('0.0.0');
    const health = (await (await request.get('/api/health')).json()) as { version: string };
    expect(health.version).toBe(expected);

    // Avant connexion : la version seule, sans le lien de démonstration.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Connexion à la console' })).toBeVisible();
    const footer = page.getByRole('contentinfo');
    await expect(footer).toHaveText(`Version ${expected}`);
    await expect(footer.getByRole('link')).toHaveCount(0);

    // Après connexion : la même version, suivie du lien de démonstration.
    await page.getByLabel('Identifiant').fill(DEMO_LOGINS.operator.username);
    await page.getByLabel('Mot de passe', { exact: true }).fill(DEMO_LOGINS.operator.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('heading', { name: 'Accueil' })).toBeVisible();
    await expect(footer).toContainText(`Version ${expected}`);
    await expect(footer.getByRole('link', { name: 'Composants' })).toBeVisible();
  });
});

test('serveur lancé sans commit : « Version dev » dès la page de connexion', async ({
  page,
  request,
}) => {
  const health = (await (await request.get('/api/health')).json()) as { version: string };
  expect(health.version).toBe('dev');
  await page.goto('/');
  await expect(page.getByRole('contentinfo')).toHaveText('Version dev');
});
