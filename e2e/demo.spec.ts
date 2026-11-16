import { readFileSync } from 'node:fs';
import { DEMO_LOGINS } from './demo-server.mjs';
import { expect, test } from './fixtures.js';
import { SCREENS } from './screens.mjs';
import { signInAs } from './browser.mjs';

const BANNER = 'Mode démo : données fictives';

test('connexion, puis retour à la page demandée', async ({ page }) => {
  await page.goto('/#/audit');
  await expect(page.getByRole('heading', { name: 'Connexion à la console' })).toBeVisible();
  await page.getByLabel('Identifiant').fill(DEMO_LOGINS.admin.username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(DEMO_LOGINS.admin.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Journal d’audit' })).toBeVisible();
  await expect(page).toHaveURL(/#\/audit$/);
});

test('recherche, puis export d’un mail avec motif', async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, 'admin');
  await page.goto('/#/search');
  await page.getByLabel('Recherche').fill('devis');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await page.getByRole('table').getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Fiche d’un mail' })).toBeVisible();
  await expect(page.getByText('@exemple.fr').first()).toBeVisible();

  const reason = page.getByLabel('Motif de l’export');
  const exportButton = page.getByRole('button', { name: 'Exporter en EML' });
  await expect(exportButton).toBeDisabled();
  await reason.fill('Ticket INC-20001');
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
  const eml = readFileSync(await download.path(), 'utf8');
  expect(eml).toContain('Message-ID:');
  await expect(page.getByText('Export inscrit au journal.')).toBeVisible();

  // Le motif figure dans le journal d'audit.
  await page.goto('/#/audit');
  await expect(page.getByText('Ticket INC-20001').first()).toBeVisible();
});

test('navigation au clavier du menu replié à 390 px', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signInAs(context, baseURL!, 'admin');
  await page.goto('/#/');
  const toggle = page.getByRole('button', { name: 'Menu' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('link', { name: 'Journal d’audit' })).toBeHidden();

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Tableau de bord' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Journal d’audit' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/audit$/);
  await expect(page.getByRole('heading', { name: 'Journal d’audit' })).toBeVisible();
  // Le menu se referme après la navigation.
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});

test('le bandeau du mode démo est présent sur chaque écran', async ({ browser, baseURL }) => {
  for (const screen of SCREENS) {
    const context = await browser.newContext({ baseURL: baseURL! });
    if (screen.role) await signInAs(context, baseURL!, screen.role);
    const page = await context.newPage();
    await page.goto(`/${screen.hash}`);
    await page.locator('main').waitFor();
    await expect(page.getByText(BANNER), screen.name).toBeVisible();
    await context.close();
  }
});

test('dialogue : focus piégé, Échap, retour du focus', async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, 'admin');
  await page.goto('/#/composants');
  const trigger = page.getByRole('button', { name: 'Ouvrir l’exemple de dialogue' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Exporter cette boîte ?' });
  await expect(dialog.getByLabel('Motif')).toBeFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    await expect(dialog.locator(':focus')).toHaveCount(1);
  }
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
