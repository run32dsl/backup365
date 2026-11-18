import { readFileSync } from 'node:fs';
import { DEMO_LOGINS } from './demo-server.mjs';
import { expect, test } from './fixtures.js';
import { RESTORE_REASON_LABEL, SCREENS, SITES } from './screens.mjs';
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
  await expect(page.getByRole('heading', { level: 2, name: 'Exporter en EML' })).toBeVisible();
  await expect(page.getByText('@exemple.fr').first()).toBeVisible();

  const reason = page.getByLabel('Motif de l’export (obligatoire)');
  const exportButton = page.getByRole('button', { name: 'Exporter en EML' });
  await expect(exportButton).toBeDisabled();
  await reason.fill('Ticket INC-20001');
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
  const eml = readFileSync(await download.path(), 'utf8');
  expect(eml).toContain('Message-ID:');
  await expect(page.getByText('Export inscrit au journal d’audit.')).toBeVisible();

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
  await expect(dialog.getByText('Ce motif sera inscrit au journal d’audit.')).toBeVisible();
  await expect(
    dialog.getByText(/dossier « Restauré par backup365 \d\d\/\d\d\/\d{4} »/),
  ).toBeVisible();

  // Le motif est obligatoire ; la saisie est bornée à 120 caractères.
  await dialog.getByRole('button', { name: 'Restaurer', exact: true }).click();
  await expect(dialog.getByText('Indiquez un motif pour continuer.')).toBeVisible();
  await expect(reason).toHaveAttribute('aria-invalid', 'true');
  await expect(reason).toHaveAttribute('maxlength', '120');

  await reason.fill('Ticket #4242 : mail supprimé par erreur');
  await dialog.getByRole('button', { name: 'Restaurer', exact: true }).click();
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
  await expect(page.getByRole('cell', { name: /Réussie, \d+ (ms|s)/ }).first()).toBeVisible();
});

test('restauration : un échec propose de réessayer', async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!, 'admin');
  // Le dernier mail de chaque boîte de démonstration échoue.
  await page.goto(`/#/mail/${encodeURIComponent('paul.moreau@exemple.fr')}/msg-4-025`);
  await page.getByRole('button', { name: /^Restaurer / }).click();
  const dialog = page.getByRole('dialog', { name: 'Restaurer ce mail' });
  await dialog.getByLabel(RESTORE_REASON_LABEL).fill('Ticket #1 : essai');
  await dialog.getByRole('button', { name: 'Restaurer', exact: true }).click();
  const failed = page.getByRole('dialog', { name: 'Restauration échouée' });
  await expect(failed.getByRole('alert')).toContainText('La restauration a échoué après');
  await expect(failed.getByText('Rien n’a été modifié dans la boîte.')).toBeVisible();
  // Une nouvelle tentative repasse par la confirmation.
  await failed.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByRole('dialog', { name: 'Restaurer ce mail' })).toBeVisible();
  await expect(page.getByLabel(RESTORE_REASON_LABEL)).toHaveValue('Ticket #1 : essai');
});

test('OneDrive : parcourir, choisir une version, motif, remplacement confirmé, suivi et journal', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'operator');
  await page.goto('/#/');
  await page.getByRole('link', { name: 'OneDrive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Restaurer depuis OneDrive' })).toBeVisible();
  await expect(page.getByText('Étape 1 sur 3 : Choisir')).toBeVisible();
  await expect(
    page.getByText(/Chaque consultation, export ou restauration est inscrite/),
  ).toBeVisible();

  // Navigation par dossiers : le fil d'Ariane suit, les versions sont datées.
  await page
    .getByRole('link', { name: /Documents/ })
    .first()
    .click();
  await page
    .getByRole('link', { name: /Budget/ })
    .first()
    .click();
  const path = page.getByRole('navigation', { name: 'Chemin' });
  await expect(path.getByText('Budget')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('columnheader', { name: 'Version du' })).toBeVisible();
  await expect(
    page.getByRole('cell', { name: /\d\d\/\d\d\/\d{4} \d\d:\d\d/ }).first(),
  ).toBeVisible();

  // Sélection annoncée ; le panneau des versions rend le focus à son bouton.
  await page.getByRole('radio', { name: 'budget.xlsx' }).check();
  await expect(page.getByText('1 élément sélectionné')).toBeVisible();
  const versions = page.getByRole('button', { name: 'Versions de budget.xlsx' });
  await versions.click();
  const panel = page.getByRole('dialog', { name: 'Versions de budget.xlsx' });
  await expect(panel.getByText(/Actuelle sauvegardée/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(versions).toBeFocused();

  // Une version antérieure : récapitulatif en copie, motif obligatoire.
  await versions.click();
  await panel.getByRole('radio').nth(1).check();
  await panel.getByRole('button', { name: 'Restaurer cette version' }).click();
  await expect(page.getByRole('heading', { name: 'Restaurer depuis OneDrive' })).toBeVisible();
  await expect(page.getByText(/Étape 2 sur 3 : Motif/)).toBeVisible();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Indiquez un motif pour continuer.')).toBeVisible();
  await expect(page.getByLabel(RESTORE_REASON_LABEL)).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel(RESTORE_REASON_LABEL).fill('Ticket #7 : version erronée');
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Confirmation : récapitulatif ; remplacer exige une confirmation explicite.
  await expect(page.getByText('Étape 3 sur 3 : Confirmation')).toBeVisible();
  await expect(page.getByText('Version du', { exact: true })).toBeVisible();
  await expect(page.getByText(/^\d\d\/\d\d\/\d{4} \d\d:\d\d$/)).toBeVisible();
  await expect(page.getByText('Nom choisi par OneDrive')).toBeVisible();
  await page.getByLabel('Remplacer le fichier actuel').check();
  await expect(page.getByText(/il reste dans l’historique OneDrive/)).toBeVisible();
  const replaceGo = page.getByRole('button', { name: 'Restaurer', exact: true });
  await expect(replaceGo).toHaveAttribute('aria-disabled', 'true');
  // Le bouton grisé reste cliquable : le clic affiche l’erreur.
  await replaceGo.click({ force: true });
  await expect(page.getByRole('alert').getByText(/Cochez la case/)).toBeVisible();
  // Une fois la case cochée, le bouton devient actif.
  await page.getByLabel('Je confirme le remplacement du fichier actuel.').check();
  await expect(replaceGo).not.toHaveAttribute('aria-disabled', 'true');
  // Revenir à la copie défait la confirmation et le mode.
  await page.getByLabel('Restaurer en copie (recommandé)').check();
  await expect(replaceGo).not.toHaveAttribute('aria-disabled', 'true');
  await replaceGo.click();

  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('status').getByText('Restauration en cours')).toBeVisible();
  await expect(page.getByText(/Restauration terminée en \d+ s\./)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Restauration terminée' })).toBeVisible();
  await expect(page.getByText('Emplacement', { exact: true })).toBeVisible();
  await expect(page.getByText('Documents > Budget', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Voir dans le journal d’audit' }).click();
  await expect(
    page.getByRole('cell', { name: 'Ticket #7 : version erronée' }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: /Réussie, \d+ (ms|s), copie/ }).first(),
  ).toBeVisible();
});

test('OneDrive : un échec propose de réessayer, rien n’est modifié', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'admin');
  await page.goto(`/#/onedrive/${encodeURIComponent('paul.moreau@exemple.fr')}/Documents/Budget`);
  await page.getByRole('radio', { name: 'previsions.xlsx' }).check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel(RESTORE_REASON_LABEL).fill('Ticket #8 : essai');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Restaurer', exact: true }).click();
  const failed = page.getByRole('alert').getByText(/La restauration a échoué/);
  await expect(failed).toBeVisible();
  await expect(page.getByText(/Rien n’a été modifié/)).toBeVisible();
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByText('Étape 3 sur 3 : Confirmation')).toBeVisible();
});

test('SharePoint : choisir une bibliothèque, motif, récapitulatif, suivi et journal', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'operator');
  await page.goto('/#/');
  await page.getByRole('link', { name: 'SharePoint', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Restaurer depuis SharePoint' })).toBeVisible();
  await expect(page.getByText(/Étape 1 sur 3 : Choisir/)).toBeVisible();
  await expect(
    page.getByText(/Chaque consultation, export ou restauration est inscrite/),
  ).toBeVisible();

  // Un opérateur ne peut pas restaurer le site entier : l'option dit pourquoi, en texte.
  await expect(page.getByLabel('Le site entier')).toBeDisabled();
  await expect(page.getByText('(Réservé aux administrateurs)')).toBeVisible();

  // Bibliothèque : « Continuer » reste inactif tant qu'aucune n'est ouverte.
  await page.getByLabel('Une bibliothèque').check();
  const next = page.getByRole('button', { name: 'Continuer' });
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('Ouvrez la bibliothèque à restaurer pour continuer.')).toBeVisible();
  // Le lien d'une bibliothèque ouvre le niveau et la choisit.
  await page.getByRole('link', { name: 'Documents partagés', exact: true }).click();
  await expect(page.getByText('Sélection : Documents partagés')).toBeVisible();
  await next.click();

  // Motif : la précision est obligatoire.
  await expect(page.getByRole('heading', { name: 'Restaurer depuis SharePoint' })).toBeVisible();
  await expect(page.getByText('Étape 2 sur 3')).toBeVisible();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Indiquez un motif pour continuer.')).toBeVisible();
  await page.getByLabel(RESTORE_REASON_LABEL).fill('Ticket #9 : essai trimestriel');
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Récapitulatif en langage clair, sans écrasement.
  await expect(page.getByText('Étape 3 sur 3 : Confirmation')).toBeVisible();
  await expect(page.getByText('Bibliothèque : Documents partagés', { exact: true })).toBeVisible();
  await expect(page.getByText(/Les fichiers existants ne seront pas remplacés/)).toBeVisible();
  await expect(page.getByText('Ticket #9 : essai trimestriel', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restaurer', exact: true }).click();

  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(
    page.getByText(/3 éléments restaurés en \d+ s\. 1 élément déjà présent a été conservé\./),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Voir dans le journal d’audit' }).click();
  await expect(
    page.getByRole('cell', { name: 'Ticket #9 : essai trimestriel' }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole('cell', {
        name: /Réussie, \d+ (ms|s), bibliothèque, 1 élément conservé$/,
      })
      .first(),
  ).toBeVisible();
});

test('SharePoint : le site entier exige la case, puis le nom exact du site (administrateur)', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'admin');
  await page.goto(`/#/sharepoint/${SITES.rh}`);
  await page.getByLabel('Le site entier').check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel(RESTORE_REASON_LABEL).fill('Ticket #10 : reprise après incident');
  await page.getByRole('button', { name: 'Continuer' }).click();

  await expect(
    page.getByText('Restauration du site entier : action de grande ampleur'),
  ).toBeVisible();
  const go = page.getByRole('button', { name: 'Restaurer', exact: true });
  await expect(go).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText(/inactif tant que la case n’est pas cochée/)).toBeVisible();
  await page.getByLabel('Tapez le nom du site pour confirmer').fill('Ressources humaine');
  await page.getByLabel(/Je comprends/).check();
  await expect(go).toHaveAttribute('aria-disabled', 'true');
  await page.getByLabel('Tapez le nom du site pour confirmer').fill('Ressources humaines');
  await expect(go).not.toHaveAttribute('aria-disabled', 'true');
  await go.click();
  await expect(page.getByText(/éléments? restaurés? en \d+ s/)).toBeVisible();
});

test('SharePoint : un accès direct au site entier est refusé à un opérateur', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'operator');
  await page.goto(`/#/sharepoint/${SITES.rh}/site`);
  await expect(
    page.getByText(/Vous n’avez pas le droit de restaurer le site « Ressources humaines »/),
  ).toBeVisible();
  await expect(page.getByText(/Étape 1 sur 3 : Choisir/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Choisir un autre site' })).toBeVisible();
  await expect(page.locator('.alert-error')).toHaveCount(0);
});

test('SharePoint : un échec affiche le résultat partiel et propose de réessayer', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'operator');
  await page.goto(`/#/sharepoint/${SITES.atelier}/item`);
  await page.getByRole('link', { name: 'Documents partagés', exact: true }).click();
  await page.getByRole('link', { name: 'Plans 2024', exact: true }).click();
  await page.getByRole('radio', { name: /plan-b\.pdf/ }).check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel(RESTORE_REASON_LABEL).fill('Ticket #11 : essai');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Restaurer', exact: true }).click();
  await expect(
    page
      .getByRole('alert')
      .getByText('La restauration a échoué : aucun élément restauré. Rien n’a été écrasé.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Restauration échouée' })).toBeVisible();
  await expect(page.getByText('Éléments en erreur', { exact: true })).toBeVisible();
  // Réessayer ramène au récapitulatif, motif et choix conservés.
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByText('Étape 3 sur 3 : Confirmation')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restaurer', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('alert').getByText('Indiquez un nom pour le plan.')).toBeVisible();
  await page.getByLabel('Nom du plan').fill('Contacts Exemple');
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Étape 2 : le titre prend le focus ; la justification est obligatoire.
  await expect(page.getByText('Étape 2 sur 3 : Objectifs')).toBeFocused();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(
    page.getByRole('alert').getByText('Indiquez la justification de la durée de conservation.'),
  ).toBeVisible();
  await page.getByRole('group', { name: 'Durée de conservation' }).getByLabel('3 ans').check();
  await page.getByLabel('Justification de cette durée').selectOption({ label: 'Besoin métier' });
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Étape 3 : récapitulatif en langage clair, puis création.
  await expect(page.getByText('Étape 3 sur 3 : Récapitulatif')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Récapitulatif' })).toBeVisible();
  await expect(page.locator('dd', { hasText: 'Contacts Exemple' })).toBeVisible();
  await expect(page.locator('dd', { hasText: '3 ans' }).first()).toBeVisible();
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

test('plans : un lancement ou une suppression en échec l’explique au-dessus des boutons', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'admin');
  await page.goto('/#/plans');
  await page.route('**/api/plans/*/run', (route) =>
    route.fulfill({
      status: 503,
      headers: { 'x-request-id': '3f2b8c1e-5a7d-4e0b-9c64-1d2a7b9e4f10' },
      json: { error: 'backup_not_configured' },
    }),
  );
  await page.getByRole('button', { name: 'Lancer Messagerie Direction maintenant' }).click();
  const run = page.getByRole('dialog', { name: 'Lancer « Messagerie Direction » maintenant' });
  const submit = run.getByRole('button', { name: 'Lancer la sauvegarde' });
  await run.getByLabel('Motif').selectOption({ label: 'Après un incident' });
  await submit.click();

  // Console non reliée : avertissement sans identifiant, au-dessus du seul bouton « Fermer ».
  // Le titre de la boîte change : « Lancement impossible ».
  const blocked = page.getByRole('dialog', { name: 'Lancement impossible' });
  const alert = blocked.getByRole('alert').filter({ hasText: 'Sauvegarde indisponible' });
  await expect(alert).toBeVisible();
  await expect(blocked.getByRole('link', { name: 'Configurer la connexion' })).toHaveCount(0);
  await expect(blocked.getByText('Identifiant de requête')).toHaveCount(0);
  const close = blocked.locator('button.btn-primary', { hasText: 'Fermer' });
  await expect(close).toBeVisible();
  await expect(blocked.getByRole('button', { name: 'Lancer la sauvegarde' })).toHaveCount(0);
  await expect(blocked.getByRole('button', { name: 'Annuler' })).toHaveCount(0);
  const alertBox = (await alert.boundingBox())!;
  const closeBox = (await close.boundingBox())!;
  expect(alertBox.y + alertBox.height).toBeLessThanOrEqual(closeBox.y);
  await close.click();
  await expect(blocked).toHaveCount(0);

  // Autre échec (erreur serveur) : les boutons restent, un nouvel essai incomplet
  // remplace l’échec par le rappel du motif.
  await page.route('**/api/plans/*/run', (route) =>
    route.fulfill({
      status: 500,
      headers: { 'x-request-id': '3f2b8c1e-5a7d-4e0b-9c64-1d2a7b9e4f10' },
      json: { error: 'internal_error' },
    }),
  );
  await page.getByRole('button', { name: 'Lancer Messagerie Direction maintenant' }).click();
  await run.getByLabel('Motif').selectOption({ label: 'Après un incident' });
  await submit.click();
  await expect(run.getByRole('alert').filter({ hasText: 'Erreur du serveur' })).toBeVisible();
  await expect(run.getByText('Identifiant de requête')).toHaveCount(0);
  await expect(submit).toBeEnabled();
  await run.getByLabel('Motif').selectOption({ label: 'Autre (préciser)' });
  await submit.click();
  await expect(run.getByText('Indiquez un motif.')).toBeVisible();
  await expect(run.getByText('Erreur du serveur')).toHaveCount(0);
  await run.getByRole('button', { name: 'Annuler' }).click();

  // Suppression refusée : même alerte, le plan reste dans la liste.
  await page.route('**/api/plans/*', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({
          status: 503,
          headers: { 'x-request-id': 'req-3c4d' },
          json: { error: 'audit_unavailable' },
        })
      : route.fallback(),
  );
  await page.getByRole('button', { name: 'Supprimer Messagerie Direction' }).click();
  const del = page.getByRole('dialog', { name: 'Supprimer « Messagerie Direction » ?' });
  await del.getByRole('button', { name: 'Supprimer le plan' }).click();
  const refused = del.getByRole('alert').filter({ hasText: 'Journal d’audit indisponible' });
  await expect(refused).toBeVisible();
  await expect(del.getByText('Identifiant de requête')).toHaveCount(0);
  await expect(refused.getByRole('link')).toHaveCount(0);
  await del.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByRole('cell', { name: 'Messagerie Direction', exact: true })).toBeVisible();
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

test('groupe d’options : légende, flèches du clavier, option désactivée', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'admin');
  await page.goto('/#/composants');

  const mode = page.getByRole('group', { name: 'Mode' });
  const copy = mode.getByRole('radio', { name: /Restaurer en copie/ });
  const replace = mode.getByRole('radio', { name: 'Remplacer le fichier actuel' });
  await expect(copy).toBeChecked();
  await copy.focus();
  await page.keyboard.press('ArrowRight');
  await expect(replace).toBeChecked();
  await expect(copy).not.toBeChecked();
  await page.keyboard.press('ArrowLeft');
  await expect(copy).toBeChecked();

  // Une option désactivée n'est jamais atteinte par les flèches et garde son explication.
  const scope = page.getByRole('group', { name: 'Restaurer' });
  const item = scope.getByRole('radio', { name: 'Un élément' });
  const site = scope.getByRole('radio', { name: /Le site entier/ });
  await expect(site).toBeDisabled();
  await expect(site).toHaveAccessibleDescription('(Réservé aux administrateurs)');
  await item.focus();
  await page.keyboard.press('ArrowRight');
  await expect(item).toBeChecked();
  await expect(site).not.toBeChecked();
});

test('recherche à 1280 px : le tableau tient dans son conteneur, avec ou sans filtre de boîte', async ({
  page,
  context,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAs(context, baseURL!, 'admin');
  // Dépassement du tableau hors de la zone de contenu de `main`, et de la page hors de la fenêtre.
  const overflow = () =>
    page.evaluate(() => {
      const main = document.querySelector('main')!;
      const inner =
        main.getBoundingClientRect().right - parseFloat(getComputedStyle(main).paddingRight);
      const table = document.querySelector('table')!.getBoundingClientRect().right;
      return {
        table: Math.max(0, Math.round(table - inner)),
        page: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      };
    });
  // « Objet » est la colonne élastique : la longueur des objets ne change pas la largeur du tableau.
  const longSubjects = () =>
    page.evaluate(() => {
      const links = document.querySelectorAll('td.subject a');
      for (const a of links) a.textContent = 'objet '.repeat(60);
      return links.length;
    });
  const fitted = { table: 0, page: 0 };

  await page.goto('/#/search?mailbox=paul.moreau%40exemple.fr');
  await page.getByRole('table').waitFor();
  await expect(page.getByRole('columnheader', { name: 'Boîte' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'dans la boîte' })).toBeVisible();
  expect(await overflow()).toEqual(fitted);
  const search = (await page.getByRole('button', { name: 'Rechercher' }).boundingBox())!;
  const restore = (await page
    .getByRole('button', { name: /^Restaurer / })
    .last()
    .boundingBox())!;
  expect(restore.x + restore.width).toBeLessThanOrEqual(search.x + search.width + 1);
  expect(await longSubjects()).toBeGreaterThan(0);
  expect(await overflow()).toEqual(fitted);

  await page.goto('/#/search');
  await page.getByLabel('Recherche').fill('devis');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await page.getByRole('table').waitFor();
  await expect(page.getByRole('columnheader', { name: 'Boîte' })).toHaveCount(1);
  expect(await overflow()).toEqual(fitted);
  expect(await longSubjects()).toBeGreaterThan(0);
  expect(await overflow()).toEqual(fitted);
});
