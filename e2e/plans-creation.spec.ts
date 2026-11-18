import { expect, test } from './fixtures.js';
import { WIDTHS } from './screens.mjs';
import { signInAs } from './browser.mjs';

// Issue #240 : l'assistant de création, à 390 et 1280 px. Chaque blocage s'affiche à côté de son
// champ, reçoit le focus et reste dans la fenêtre ; le parcours complet aboutit à la liste.
for (const width of WIDTHS) {
  test.describe(`plans : assistant de création à ${width} px`, () => {
    test.beforeEach(async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
      await signInAs(context, baseURL!, 'admin');
      await page.goto('/#/plans/nouveau');
      await expect(page.getByText('Étape 1 sur 3 : Quoi protéger')).toBeVisible();
    });

    const toStep3 = async (page: import('@playwright/test').Page, name: string) => {
      await page.getByLabel('Nom du plan').fill(name);
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page
        .getByLabel('Justification de cette durée')
        .selectOption({ label: 'Besoin métier' });
      await page.getByRole('button', { name: 'Continuer' }).click();
      await expect(page.getByText('Étape 3 sur 3 : Récapitulatif')).toBeFocused();
    };

    test('nom manquant : message, focus et visibilité', async ({ page }) => {
      await page.getByRole('button', { name: 'Continuer' }).click();
      await expect(page.getByText('Saisissez un nom pour le plan.')).toBeInViewport();
      await expect(page.getByLabel('Nom du plan')).toBeFocused();
      await expect(page.getByLabel('Nom du plan')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('alert')).toHaveText(/1 point à corriger avant de continuer/);
    });

    test('nom déjà utilisé : refusé dès l’étape 1', async ({ page }) => {
      await page.getByLabel('Nom du plan').fill(' messagerie direction ');
      await page.getByRole('button', { name: 'Continuer' }).click();
      await expect(
        page.getByText('Ce nom est déjà utilisé. Choisissez-en un autre.'),
      ).toBeInViewport();
      await expect(page.getByLabel('Nom du plan')).toBeFocused();
      await expect(page.getByText('Étape 1 sur 3 : Quoi protéger')).toBeVisible();
    });

    test('périmètre vide : message, focus et visibilité', async ({ page }) => {
      await page.getByLabel('Nom du plan').fill('Plan périmètre');
      await page.getByLabel('Boîtes et comptes choisis').check();
      await page.getByRole('button', { name: 'Continuer' }).click();
      await expect(page.getByText('Choisissez au moins un élément à protéger.')).toBeInViewport();
      await expect(page.locator('input[aria-invalid="true"]')).toBeFocused();
    });

    test('justification manquante : message, focus et visibilité', async ({ page }) => {
      await page.getByLabel('Nom du plan').fill('Plan justification');
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByRole('button', { name: 'Continuer' }).click();
      await expect(
        page.getByText('Indiquez pourquoi cette durée est nécessaire.'),
      ).toBeInViewport();
      await expect(page.getByLabel('Justification de cette durée')).toBeFocused();
    });

    test('parcours complet : plan visible dans la liste, confirmation focalisée', async ({
      page,
    }) => {
      await toStep3(page, `Plan mobile ${width}`);
      const create = page.getByRole('button', { name: 'Créer le plan' });
      await expect(create).toBeInViewport();
      await create.click();
      await expect(page).toHaveURL(/#\/plans$/);
      await expect(page.getByRole('status').filter({ hasText: 'Plan créé.' })).toBeVisible();
      await expect(page.locator('.flash')).toBeFocused();
      await expect(page.getByText(`Plan mobile ${width}`, { exact: true })).toBeVisible();
    });

    test('nom pris entre-temps : retour à l’étape 1, erreur sur le nom', async ({ page }) => {
      await page.route('**/api/plans', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 409, json: { error: 'plan_name_taken' } })
          : route.fallback(),
      );
      await toStep3(page, 'Plan concurrent');
      await page.getByRole('button', { name: 'Créer le plan' }).click();
      await expect(page.getByText('Étape 1 sur 3 : Quoi protéger')).toBeVisible();
      await expect(
        page.getByText('Ce nom est déjà utilisé. Choisissez-en un autre.'),
      ).toBeInViewport();
      await expect(page.getByLabel('Nom du plan')).toBeFocused();
    });

    test('erreur serveur : message près du bouton, saisie conservée', async ({ page }) => {
      await page.route('**/api/plans', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 500, json: { error: 'boom' } })
          : route.fallback(),
      );
      await toStep3(page, 'Plan en échec');
      await page.getByRole('button', { name: 'Créer le plan' }).click();
      await expect(
        page.getByText('Le plan n’a pas pu être créé. Vos choix sont conservés. Réessayez.'),
      ).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Créer le plan' })).toBeInViewport();
    });
  });
}
