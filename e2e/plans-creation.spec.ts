import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { signInAs } from './browser.mjs';

const WIDTHS = [390, 1280];
const EXISTING = 'Messagerie Direction';
const TAKEN = 'Ce nom est déjà utilisé. Choisissez-en un autre.';
const JUSTIFICATION = 'Justification de cette durée (obligatoire)';

async function inViewport(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  const height = page.viewportSize()!.height;
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height);
}

for (const width of WIDTHS) {
  test.describe(`création d’un plan à ${width} px`, () => {
    test.beforeEach(async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await signInAs(context, baseURL!, 'admin');
      await page.goto('/#/plans/nouveau');
      await expect(page.getByText('Étape 1 sur 3 : Quoi protéger')).toBeVisible();
    });

    test('parcours complet : plan visible dans la liste et confirmation', async ({ page }) => {
      const name = `Plan e2e ${width}`;
      await page.getByLabel('Nom du plan').fill(name);
      await page.getByRole('button', { name: 'Continuer' }).click();
      await expect(page.getByText('Étape 2 sur 3 : Objectifs')).toBeVisible();
      await page.getByLabel(JUSTIFICATION).fill('Obligation légale');
      await page.getByRole('button', { name: 'Continuer' }).click();
      await expect(page.getByText('Étape 3 sur 3 : Récapitulatif')).toBeVisible();
      const create = page.getByRole('button', { name: 'Créer le plan' });
      await create.scrollIntoViewIfNeeded();
      await inViewport(page, 'button:has-text("Créer le plan")');
      await create.click();
      const status = page.getByRole('status').filter({ hasText: 'Plan créé.' });
      await expect(status).toBeVisible();
      await expect(status).toBeFocused();
      await expect(page.getByRole('table').getByText(name)).toBeVisible();
      await expect(page).toHaveURL(/#\/plans$/);
    });

    test('nom manquant : message, focus et champ visible', async ({ page }) => {
      await page.getByRole('button', { name: 'Continuer' }).click();
      const field = page.getByLabel('Nom du plan');
      await expect(page.getByText('Saisissez un nom pour le plan.')).toBeVisible();
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await expect(field).toBeFocused();
      await inViewport(page, 'input[aria-invalid="true"]');
      await expect(page.getByRole('alert').first()).toContainText('1 point à corriger');
    });

    test('nom déjà utilisé : message sur le champ Nom dès l’étape 1', async ({ page }) => {
      const field = page.getByLabel('Nom du plan');
      await field.fill(` ${EXISTING.toUpperCase()} `);
      await page.getByRole('button', { name: 'Continuer' }).click();
      await expect(page.getByText(TAKEN)).toBeVisible();
      await expect(field).toBeFocused();
      await expect(page.getByText('Étape 1 sur 3 : Quoi protéger')).toBeVisible();
      await inViewport(page, 'input[aria-invalid="true"]');
    });

    test('périmètre vide : message, focus et champ visible', async ({ page }) => {
      await page.getByLabel('Nom du plan').fill('Plan périmètre');
      await page.getByRole('radio', { name: 'Boîtes et comptes choisis' }).check();
      await page.getByRole('button', { name: 'Continuer' }).click();
      await expect(page.getByText('Choisissez au moins un élément à protéger.')).toBeVisible();
      const first = page.locator('fieldset[aria-describedby="selection-error"] input').first();
      await expect(first).toBeFocused();
      await inViewport(page, 'fieldset[aria-describedby="selection-error"] input');
    });

    test('justification manquante : message, focus et champ visible', async ({ page }) => {
      await page.getByLabel('Nom du plan').fill('Plan justification');
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByRole('button', { name: 'Continuer' }).click();
      await expect(page.getByText('Indiquez pourquoi cette durée est nécessaire.')).toBeVisible();
      await expect(page.getByLabel(JUSTIFICATION)).toBeFocused();
      await inViewport(page, 'input[aria-invalid="true"]');
    });

    test('nom refusé à l’envoi : retour à l’étape 1 avec l’erreur sur le nom', async ({ page }) => {
      const name = `Course ${width}`;
      await page.getByLabel('Nom du plan').fill(name);
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByLabel(JUSTIFICATION).fill('Obligation légale');
      await page.getByRole('button', { name: 'Continuer' }).click();
      // Un autre administrateur prend le nom entre-temps.
      await page.route('**/api/plans', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'plan_name_taken' }),
            })
          : route.fallback(),
      );
      await page.getByRole('button', { name: 'Créer le plan' }).click();
      await expect(page.getByText('Étape 1 sur 3 : Quoi protéger')).toBeVisible();
      await expect(page.getByText(TAKEN)).toBeVisible();
      await expect(page.getByLabel('Nom du plan')).toBeFocused();
    });
  });
}
