/**
 * Écrans photographiés par `pnpm run captures` : le seul fichier à modifier pour en ajouter un.
 *
 * - `name` : nom du fichier, `captures/<name>-<largeur>.png` ;
 * - `hash` : ancre de l'écran (vide pour la page de connexion) ;
 * - `role` : `'admin'`, `'operator'` ou `null` (pas de session) ;
 * - `prepare(page)` : gestes éventuels avant la photo (saisie, clic), rendu attendu à la fin.
 *
 * @typedef {{ name: string, hash: string, role: 'admin' | 'operator' | null,
 *   prepare?: (page: import('@playwright/test').Page) => Promise<void> }} Screen
 */

export const WIDTHS = [1280, 390];

/** Premier mail fictif de la première boîte (voir apps/server/src/demo.ts). */
export const DEMO_MAIL_HASH = `#/mail/${encodeURIComponent('claire.durand@exemple.fr')}/msg-1-004`;

/** Libellé du champ motif du panneau de restauration. */
export const RESTORE_REASON_LABEL = 'Motif de la restauration (obligatoire)';

/**
 * Fiche d'un mail fictif propre à la largeur de la capture : la démo refuse deux restaurations
 * simultanées du même mail, et la capture « en cours » du 1280 px dure encore à l'ouverture du
 * 390 px. Le mail n° 25 de chaque boîte échoue (voir `createDemoRestorer`).
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} n numéro du mail dans la boîte, de 1 à 25
 */
async function openMailFor(page, n) {
  const narrow = (page.viewportSize()?.width ?? 1280) < 600;
  const [box, index] = narrow ? ['marc.lefevre@exemple.fr', 2] : ['claire.durand@exemple.fr', 1];
  await page.goto(`/#/mail/${encodeURIComponent(box)}/msg-${index}-${String(n).padStart(3, '0')}`);
  await page.getByText('Expéditeur').first().waitFor();
}

/** Ouvre la fiche du mail n° `n`, puis le panneau « Restaurer ce mail ». */
async function openRestorePanel(page, n) {
  await openMailFor(page, n);
  await page.getByRole('button', { name: /^Restaurer /u }).click();
  await page.getByRole('dialog', { name: 'Restaurer ce mail' }).waitFor();
}

/** Saisit un motif et confirme la restauration. */
async function confirmRestore(page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(RESTORE_REASON_LABEL).fill('Ticket #1234 : mail supprimé par erreur');
  await dialog.getByRole('button', { name: 'Restaurer', exact: true }).click();
}

/**
 * Ouvre un dossier de la sauvegarde OneDrive. Le compte dépend de la largeur de la capture : la
 * démo refuse deux restaurations simultanées du même fichier (voir `openMailFor`). Le fichier
 * `previsions.xlsx` échoue dans la démo (voir `createDemoDriveRestorer`).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} folder dossier, ex. `/Documents/Budget`
 */
export async function openDrive(page, folder = '/Documents/Budget') {
  const narrow = (page.viewportSize()?.width ?? 1280) < 600;
  const account = narrow ? 'marc.lefevre@exemple.fr' : 'claire.durand@exemple.fr';
  const path = folder.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  await page.goto(`/#/onedrive/${encodeURIComponent(account)}/${path}`);
  await page.getByRole('table').waitFor();
}

/** Choisit un fichier du dossier ouvert et passe à l'étape « Motif ». */
export async function chooseDriveFile(page, name) {
  await page.getByLabel(`Sélectionner ${name}`).check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByText('Étape 2 sur 3 : Motif').waitFor();
}

/** Saisit le motif et passe à l'étape « Confirmation ». */
export async function giveDriveReason(page) {
  await page.getByLabel(RESTORE_REASON_LABEL).fill('Suppression accidentelle par l’utilisateur');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByText('Étape 3 sur 3 : Confirmation').waitFor();
}

/** Saisit un motif, confirme et lance la restauration. */
export async function launchDriveRestore(page) {
  await giveDriveReason(page);
  await page.getByRole('button', { name: 'Restaurer', exact: true }).click();
}

/** Sites fictifs (voir `DEMO_SITES` de apps/server/src/demo.ts). */
export const SITES = {
  commerce: 'site-equipe-commerciale',
  rh: 'site-ressources-humaines',
  atelier: 'site-projet-atelier',
};

/**
 * Ouvre l'écran « Restaurer SharePoint » d'un site, pour une granularité. La démo refuse deux
 * restaurations simultanées d'un même site : une capture « en cours » laisse la restauration
 * tourner 2 s, les captures qui lancent une restauration utilisent donc des sites distincts.
 * `plan-b.pdf` échoue dans la démo (voir `createDemoSiteRestorer`).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} site identifiant du site (`SITES`)
 * @param {'item' | 'folder' | 'library' | 'site'} scope
 */
export async function openSite(page, site, scope = 'item') {
  await page.goto(`/#/sharepoint/${site}/${scope}`);
  await page.getByRole('heading', { name: 'Restaurer depuis SharePoint' }).waitFor();
  await page.getByText('Étape 1 sur 3').waitFor();
}

/** Ouvre, dans l'arborescence, les dossiers de la liste, puis (facultatif) choisit le fichier. */
export async function browseSite(page, ...names) {
  for (const name of names) {
    await page.getByRole('treeitem', { name: new RegExp(name, 'u') }).click();
  }
}

/** Passe à l'étape suivante. */
export async function continueStep(page) {
  await page.getByRole('button', { name: 'Continuer' }).click();
}

/** Étape « Motif » : liste par défaut et précision saisie. */
export async function giveSiteReason(page) {
  await page.getByText('Étape 2 sur 3 : Motif').waitFor();
  await page.getByLabel(RESTORE_REASON_LABEL).fill('Dossier supprimé par erreur');
}

/** Choisit un chemin, donne le motif et arrive au récapitulatif. */
export async function reachSiteSummary(page, site, scope, ...names) {
  await openSite(page, site, scope);
  await browseSite(page, ...names);
  await continueStep(page);
  await giveSiteReason(page);
  await continueStep(page);
  await page.getByText('Étape 3 sur 3 : Confirmation').waitFor();
}

/** @type {Screen[]} */
export const SCREENS = [
  { name: 'connexion', hash: '', role: null },
  {
    // Réponse 429 simulée : un vrai verrouillage bloquerait l'adresse des captures suivantes.
    name: 'connexion-verrouillee',
    hash: '',
    role: null,
    prepare: async (page) => {
      await page.route('**/api/auth/login', (route) =>
        route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'too_many_attempts', retryAfterSec: 272 }),
        }),
      );
      await page.getByLabel('Identifiant').fill('marie.exemple');
      await page.getByLabel('Mot de passe', { exact: true }).fill('un mot de passe quelconque');
      await page.getByRole('button', { name: 'Se connecter' }).click();
      await page.getByRole('alert').waitFor();
    },
  },
  {
    // Le bouton « Se connecter avec un compte Microsoft » figure déjà sur `connexion` (fournisseur
    // simulé de la démo) ; ici le clic aboutit à la console, sous le compte Microsoft simulé.
    name: 'connexion-microsoft',
    hash: '',
    role: null,
    prepare: async (page) => {
      await page.getByRole('link', { name: 'Se connecter avec un compte Microsoft' }).click();
      await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    },
  },
  {
    // Retour refusé (aucun groupe reconnu) : l'adresse d'arrivée porte le code, simulé ici.
    name: 'connexion-microsoft-refusee',
    hash: '',
    role: null,
    prepare: async (page) => {
      await page.goto('/?oidc_error=no_group');
      await page.getByRole('status').filter({ hasText: 'aucun groupe autorisé' }).waitFor();
    },
  },
  { name: 'tableau-de-bord', hash: '#/', role: 'admin' },
  {
    name: 'recherche',
    hash: '#/search',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Recherche').fill('devis');
      await page.getByRole('button', { name: 'Rechercher' }).click();
      await page.getByRole('table').waitFor();
    },
  },
  {
    name: 'fiche-mail',
    hash: DEMO_MAIL_HASH,
    role: 'admin',
    prepare: async (page) => {
      await page.getByText('Expéditeur').first().waitFor();
    },
  },
  {
    name: 'journal-audit',
    hash: '#/audit',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').waitFor();
    },
  },
  {
    name: 'administration-comptes',
    hash: '#/comptes',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').first().waitFor();
    },
  },
  {
    name: 'reinitialisation-motif',
    hash: '#/comptes',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').first().waitFor();
      await page.getByLabel('Compte').selectOption({ label: 'operateur-demo' });
      await page.getByRole('button', { name: 'Réinitialiser le mot de passe' }).click();
      await page.getByLabel('Motif (obligatoire)').fill('Oubli du mot de passe');
    },
  },
  {
    // Réponse simulée : réinitialiser le vrai compte fermerait ses sessions de démonstration.
    name: 'mot-de-passe-temporaire',
    hash: '#/comptes',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/accounts/*/reset-password', (route) =>
        route.fulfill({ status: 200, json: { password: 'Tz7k-Qp3m-Vx9d-Lw2h' } }),
      );
      await page.getByRole('table').first().waitFor();
      await page.getByLabel('Compte').selectOption({ label: 'operateur-demo' });
      await page.getByRole('button', { name: 'Réinitialiser le mot de passe' }).click();
      await page.getByLabel('Motif (obligatoire)').fill('Oubli du mot de passe');
      await page.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
      await page.getByRole('dialog').getByLabel('Mot de passe temporaire').waitFor();
    },
  },
  { name: 'page-reservee', hash: '#/comptes', role: 'operator' },
  {
    name: 'plans-liste',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').waitFor();
    },
  },
  {
    // Le mode démo simule l'exécution : la réponse est modifiée pour montrer une réussite sans
    // point de restauration (ressource vide, issue #80).
    name: 'plans-liste-aucun-contenu',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/plans', async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        for (const plan of body.items) {
          const at = new Date().toISOString();
          plan.running = false;
          plan.compliance = { state: 'compliant', lastSuccessAt: at, lastRestorePointAt: null };
          plan.lastRun = {
            status: 'success',
            startedAt: at,
            finishedAt: at,
            noSnapshotReason: 'no_content',
          };
        }
        await route.fulfill({ response: res, json: body });
      });
      await page.reload();
      await page.getByRole('table').waitFor();
    },
  },
  {
    name: 'plans-liste-operateur',
    hash: '#/plans',
    role: 'operator',
    prepare: async (page) => {
      await page.getByRole('table').waitFor();
    },
  },
  {
    name: 'plans-etape-1',
    hash: '#/plans/nouveau',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Nom du plan').fill('Messagerie Direction');
    },
  },
  {
    name: 'plans-etape-2',
    hash: '#/plans/nouveau',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Nom du plan').fill('Messagerie Direction');
      await page.getByRole('button', { name: 'Suivant' }).click();
      await page.getByText('Étape 2 sur 3 : Objectifs').waitFor();
    },
  },
  {
    name: 'plans-etape-3',
    hash: '#/plans/nouveau',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Nom du plan').fill('Messagerie Direction');
      await page.getByRole('button', { name: 'Suivant' }).click();
      await page
        .getByLabel('Justification de cette durée')
        .selectOption({ label: 'Obligation légale' });
      await page.getByRole('button', { name: 'Suivant' }).click();
      await page.getByText('Étape 3 sur 3 : Récapitulatif').waitFor();
    },
  },
  {
    name: 'plans-lancer',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Lancer Messagerie Direction maintenant' }).click();
      await page
        .getByRole('dialog', { name: 'Lancer « Messagerie Direction » maintenant' })
        .waitFor();
    },
  },
  {
    name: 'plans-supprimer',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Supprimer Messagerie Direction' }).click();
      await page.getByRole('dialog', { name: 'Supprimer « Messagerie Direction » ?' }).waitFor();
    },
  },
  {
    name: 'restauration-formulaire',
    hash: DEMO_MAIL_HASH,
    role: 'operator',
    prepare: async (page) => {
      await openRestorePanel(page, 10);
      await page.getByRole('dialog').getByLabel(RESTORE_REASON_LABEL).fill('Ticket #1234 : mail');
    },
  },
  {
    name: 'restauration-en-cours',
    hash: DEMO_MAIL_HASH,
    role: 'operator',
    prepare: async (page) => {
      await openRestorePanel(page, 11);
      await confirmRestore(page);
      await page.getByRole('dialog', { name: 'Restauration en cours' }).waitFor();
    },
  },
  {
    name: 'restauration-reussie',
    hash: DEMO_MAIL_HASH,
    role: 'operator',
    prepare: async (page) => {
      await openRestorePanel(page, 12);
      await confirmRestore(page);
      await page.getByText(/Mail restauré en/u).waitFor();
    },
  },
  {
    name: 'restauration-echouee',
    hash: DEMO_MAIL_HASH,
    role: 'operator',
    prepare: async (page) => {
      await openRestorePanel(page, 25);
      await confirmRestore(page);
      await page.getByText(/La restauration a échoué après/u).waitFor();
    },
  },
  {
    name: 'onedrive-parcourir',
    hash: '#/onedrive',
    role: 'operator',
    prepare: async (page) => {
      await openDrive(page);
      await page.getByLabel('Sélectionner budget.xlsx').check();
    },
  },
  {
    name: 'onedrive-versions',
    hash: '#/onedrive',
    role: 'operator',
    prepare: async (page) => {
      await openDrive(page);
      await page.getByRole('button', { name: 'Versions de budget.xlsx' }).click();
      await page.getByRole('dialog', { name: 'Versions de budget.xlsx' }).waitFor();
    },
  },
  {
    name: 'onedrive-motif',
    hash: '#/onedrive',
    role: 'operator',
    prepare: async (page) => {
      await openDrive(page);
      await chooseDriveFile(page, 'budget.xlsx');
      await page
        .getByLabel(RESTORE_REASON_LABEL)
        .fill('Suppression accidentelle par l’utilisateur');
    },
  },
  {
    name: 'onedrive-recapitulatif',
    hash: '#/onedrive',
    role: 'operator',
    prepare: async (page) => {
      await openDrive(page);
      await chooseDriveFile(page, 'budget.xlsx');
      await giveDriveReason(page);
    },
  },
  {
    name: 'onedrive-remplacer',
    hash: '#/onedrive',
    role: 'operator',
    prepare: async (page) => {
      await openDrive(page);
      await chooseDriveFile(page, 'budget.xlsx');
      await giveDriveReason(page);
      await page.getByLabel('Remplacer le fichier actuel').check();
    },
  },
  {
    name: 'onedrive-en-cours',
    hash: '#/onedrive',
    role: 'operator',
    prepare: async (page) => {
      await openDrive(page, '/Documents');
      await chooseDriveFile(page, 'notes.docx');
      await launchDriveRestore(page);
      await page.getByRole('progressbar').waitFor();
    },
  },
  {
    name: 'onedrive-terminee',
    hash: '#/onedrive',
    role: 'operator',
    prepare: async (page) => {
      await openDrive(page, '/Images');
      await chooseDriveFile(page, 'logo.png');
      await launchDriveRestore(page);
      await page.getByText(/Restauration terminée en/u).waitFor();
    },
  },
  {
    name: 'onedrive-echouee',
    hash: '#/onedrive',
    role: 'operator',
    prepare: async (page) => {
      await openDrive(page);
      await chooseDriveFile(page, 'previsions.xlsx');
      await launchDriveRestore(page);
      await page.getByText(/La restauration a échoué/u).waitFor();
    },
  },
  {
    name: 'sharepoint-choisir',
    hash: '#/sharepoint',
    role: 'operator',
    prepare: async (page) => {
      await openSite(page, SITES.commerce, 'item');
      await browseSite(page, 'Documents partagés', 'Plans 2024', 'plan-a.pdf');
    },
  },
  {
    name: 'sharepoint-motif',
    hash: '#/sharepoint',
    role: 'operator',
    prepare: async (page) => {
      await openSite(page, SITES.commerce, 'library');
      await browseSite(page, 'Documents partagés');
      await continueStep(page);
      await giveSiteReason(page);
    },
  },
  {
    name: 'sharepoint-recapitulatif',
    hash: '#/sharepoint',
    role: 'operator',
    prepare: async (page) => {
      await reachSiteSummary(page, SITES.commerce, 'library', 'Documents partagés');
      await page.getByText(/\d+ éléments?, /u).waitFor();
    },
  },
  {
    name: 'sharepoint-site-entier',
    hash: '#/sharepoint',
    role: 'admin',
    prepare: async (page) => {
      await reachSiteSummary(page, SITES.commerce, 'site');
      await page.getByText('Restauration du site entier').waitFor();
    },
  },
  {
    name: 'sharepoint-droits',
    hash: '#/sharepoint',
    role: 'operator',
    prepare: async (page) => {
      await page.goto(`/#/sharepoint/${SITES.commerce}/site`);
      await page.getByText(/Vous n’avez pas le droit de restaurer ce site/u).waitFor();
    },
  },
  {
    name: 'sharepoint-en-cours',
    hash: '#/sharepoint',
    role: 'operator',
    prepare: async (page) => {
      // Largeur étroite : un autre site, la restauration du 1280 px dure encore (voir `openSite`).
      const narrow = (page.viewportSize()?.width ?? 1280) < 600;
      await reachSiteSummary(
        page,
        narrow ? SITES.rh : SITES.commerce,
        'library',
        'Documents partagés',
      );
      await page.getByRole('button', { name: 'Restaurer', exact: true }).click();
      await page.getByRole('progressbar').waitFor();
    },
  },
  {
    name: 'sharepoint-terminee',
    hash: '#/sharepoint',
    role: 'operator',
    prepare: async (page) => {
      await reachSiteSummary(page, SITES.atelier, 'folder', 'Documents partagés', 'Contrats');
      await page.getByRole('button', { name: 'Restaurer', exact: true }).click();
      await page.getByText(/Restauration terminée en/u).waitFor();
    },
  },
  {
    name: 'sharepoint-echouee',
    hash: '#/sharepoint',
    role: 'operator',
    prepare: async (page) => {
      await reachSiteSummary(
        page,
        SITES.atelier,
        'item',
        'Documents partagés',
        'Plans 2024',
        'plan-b.pdf',
      );
      await page.getByRole('button', { name: 'Restaurer', exact: true }).click();
      await page.getByText(/La restauration a échoué après/u).waitFor();
    },
  },
  {
    name: 'composants',
    hash: '#/composants',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('heading', { name: 'Composants', level: 1 }).waitFor();
    },
  },
  {
    name: 'composants-dialogue',
    hash: '#/composants',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Ouvrir l’exemple de dialogue' }).click();
      await page.getByRole('dialog', { name: 'Exporter cette boîte ?' }).waitFor();
    },
  },
];
