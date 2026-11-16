import { readFileSync } from 'node:fs';
import { DEMO_LOGINS } from './demo-server.mjs';
import { expect, test } from './fixtures.js';
import { RESTORE_REASON_LABEL, SCREENS } from './screens.mjs';
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

test('restauration : motif obligatoire, suivi, résultat et journal', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'operator');
  // Point d'entrée : un résultat de recherche.
  await page.goto('/#/search');
  await page.getByLabel('Recherche').fill('devis');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  const trigger = page.getByRole('button', { name: /^Restaurer / }).first();
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Restaurer ce mail' });
  const reason = dialog.getByLabel(RESTORE_REASON_LABEL);
  await expect(reason).toBeFocused();
  await expect(dialog.getByText('Exemple : Ticket #1234 : mail supprimé par erreur')).toBeVisible();
  await expect(
    dialog.getByText(/dossier « Restauré par backup365 \d\d\/\d\d\/\d{4} »/),
  ).toBeVisible();

  // Le motif est obligatoire ; la saisie est bornée à 120 caractères.
  await dialog.getByRole('button', { name: 'Restaurer le mail' }).click();
  await expect(dialog.getByText('Indiquez un motif (120 caractères au plus).')).toBeVisible();
  await expect(reason).toHaveAttribute('aria-invalid', 'true');
  await expect(reason).toHaveAttribute('maxlength', '120');

  await reason.fill('Ticket #4242 : mail supprimé par erreur');
  await dialog.getByRole('button', { name: 'Restaurer le mail' }).click();
  await expect(page.getByRole('dialog', { name: 'Restauration en cours' })).toBeVisible();
  await expect(
    page.getByRole('dialog').getByText('Vous pouvez fermer cette fenêtre'),
  ).toBeVisible();
  // La restauration continue quand on ferme le panneau ; le focus revient au bouton.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(trigger).toBeFocused();

  // Fiche du mail : l'issue de la dernière restauration y figure.
  await page.goto('/#/search');
  await page.getByLabel('Recherche').fill('devis');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await page.getByRole('table').getByRole('link').first().click();
  await expect(page.getByText(/Dernière restauration : (en cours|réussie, \d+ s)/)).toBeVisible();
  await expect(page.getByText(/Dernière restauration : réussie, \d+ s/)).toBeVisible();

  // Le journal garde la demande et le résultat avec le motif, jamais l'objet du mail.
  await page.goto('/#/audit');
  await expect(page.getByRole('cell', { name: 'Demande de restauration' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Résultat de restauration' }).first()).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Ticket #4242 : mail supprimé par erreur' }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: /outcome=succeeded;duration_ms=\d+/ }).first(),
  ).toBeVisible();
});

test('restauration : un échec propose de réessayer', async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, 'admin');
  // Le dernier mail de chaque boîte de démonstration échoue.
  await page.goto(`/#/mail/${encodeURIComponent('paul.moreau@exemple.fr')}/msg-4-025`);
  await page.getByRole('button', { name: /^Restaurer / }).click();
  const dialog = page.getByRole('dialog', { name: 'Restaurer ce mail' });
  await dialog.getByLabel(RESTORE_REASON_LABEL).fill('Ticket #1 : essai');
  await dialog.getByRole('button', { name: 'Restaurer le mail' }).click();
  const failed = page.getByRole('dialog', { name: 'Restauration échouée' });
  await expect(failed.getByRole('alert')).toContainText('La restauration a échoué après');
  await expect(failed.getByText('Rien n’a été modifié dans la boîte.')).toBeVisible();
  // Une nouvelle tentative repasse par la confirmation.
  await failed.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByRole('dialog', { name: 'Restaurer ce mail' })).toBeVisible();
  await expect(page.getByLabel(RESTORE_REASON_LABEL)).toHaveValue('Ticket #1 : essai');
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

test('plans : créer en 3 étapes, lancer avec un motif, supprimer', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'admin');
  await page.goto('/#/plans');
  await expect(page.getByRole('heading', { name: 'Plans de protection', level: 1 })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Messagerie Direction', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Créer un plan' }).click();
  await expect(page.getByText('Étape 1 sur 3 : Quoi protéger')).toBeVisible();
  // Étape 1 : un nom est exigé.
  await page.getByRole('button', { name: 'Suivant' }).click();
  await expect(page.getByRole('alert').getByText('Indiquez un nom pour le plan.')).toBeVisible();
  await page.getByLabel('Nom du plan').fill('Contacts Exemple');
  await page.getByRole('button', { name: 'Suivant' }).click();

  // Étape 2 : le titre prend le focus ; la justification est obligatoire.
  await expect(page.getByText('Étape 2 sur 3 : Objectifs')).toBeFocused();
  await page.getByRole('button', { name: 'Suivant' }).click();
  await expect(
    page.getByRole('alert').getByText('Indiquez la justification de la durée de conservation.'),
  ).toBeVisible();
  await page.getByRole('group', { name: 'Durée de conservation' }).getByLabel('3 ans').check();
  await page.getByLabel('Justification de cette durée').selectOption({ label: 'Besoin métier' });
  await page.getByRole('button', { name: 'Suivant' }).click();

  // Étape 3 : récapitulatif en langage clair, puis création.
  await expect(page.getByText('Étape 3 sur 3 : Récapitulatif')).toBeFocused();
  await expect(
    page.getByText(/seront sauvegardés toutes les 12 h et conservés 3 ans/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Créer le plan' }).click();
  await expect(
    page.getByText(/Plan créé\. Première sauvegarde prévue à \d\d:\d\d\./),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/plans$/);
  await expect(page.getByRole('cell', { name: 'Contacts Exemple', exact: true })).toBeVisible();

  // Lancement manuel : le motif est exigé, puis inscrit au journal d'audit.
  await page.getByRole('button', { name: 'Lancer Contacts Exemple maintenant' }).click();
  const run = page.getByRole('dialog', { name: 'Lancer « Contacts Exemple » maintenant' });
  await run.getByRole('button', { name: 'Lancer la sauvegarde' }).click();
  await expect(run.getByText('Indiquez un motif.')).toBeVisible();
  await run.getByLabel('Motif').selectOption({ label: 'Après un incident' });
  await run.getByRole('button', { name: 'Lancer la sauvegarde' }).click();
  await expect(
    page.getByText('Sauvegarde lancée. Motif enregistré au journal d’audit.'),
  ).toBeVisible();

  // Suppression : la confirmation s'ouvre sur « Annuler ».
  await page.getByRole('button', { name: 'Supprimer Contacts Exemple' }).click();
  const del = page.getByRole('dialog', { name: 'Supprimer « Contacts Exemple » ?' });
  await expect(del.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await del.getByRole('button', { name: 'Supprimer le plan' }).click();
  await expect(page.getByText('Plan supprimé.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Contacts Exemple', exact: true })).toHaveCount(0);

  await page.goto('/#/audit');
  await expect(page.getByText('Après un incident').first()).toBeVisible();
});

test('plans : un opérateur lit la liste sans pouvoir la modifier', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'operator');
  await page.goto('/#/plans');
  await expect(page.getByRole('cell', { name: 'Messagerie Direction', exact: true })).toBeVisible();
  await expect(
    page.getByText('Lecture seule : seul un administrateur peut modifier les plans.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Lancer/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Créer un plan' })).toHaveCount(0);
  await page.goto('/#/plans/nouveau');
  await expect(page.getByText('Action réservée aux administrateurs.')).toBeVisible();
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
