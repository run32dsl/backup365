/**
 * Écrans photographiés par `pnpm run captures` : le seul fichier à modifier pour en ajouter un.
 *
 * - `name` : nom du fichier, `captures/<name>-<largeur>.png` ;
 * - `hash` : ancre de l'écran (vide pour la page de connexion) ;
 * - `role` : `'admin'`, `'operator'` ou `null` (pas de session) ;
 * - `scheme` : `'dark'` pour le thème sombre (clair par défaut) ;
 * - `prepare(page)` : gestes éventuels avant la photo (saisie, clic), rendu attendu à la fin ;
 * - `extraWidths` : largeurs photographiées en plus de `WIDTHS` (ex. `[1024]`) ;
 * - `buildCommit` : commit court d'une image construite ; l'écran est alors photographié sur un
 *   second serveur de démonstration, dont le pied de page affiche « Version <paquet> · <commit> »
 *   au lieu de « Version dev ».
 *
 * @typedef {{ name: string, hash: string, role: 'admin' | 'operator' | null, scheme?: 'light' | 'dark',
 *   prepare?: (page: import('@playwright/test').Page) => Promise<void>,
 *   buildCommit?: string, extraWidths?: number[] }} Screen
 */

/** Commit court fictif des captures et des tests de la version d'une image. */
export const IMAGE_COMMIT = 'abc1234';

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
  await page.getByRole('radio', { name, exact: true }).check();
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

/** Ouvre les niveaux de la liste (liens), puis coche le dernier nom (bouton radio de sa ligne). */
export async function browseSite(page, ...names) {
  for (const [i, name] of names.entries()) {
    if (i === names.length - 1) {
      await page.getByRole('radio', { name, exact: true }).check();
    } else {
      await page.getByRole('link', { name, exact: true }).click();
    }
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

/**
 * Simule la réponse de `GET /api/overview` puis recharge l'accueil.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} overview corps de la réponse
 */
async function overviewAs(page, overview) {
  await page.route('**/api/overview', (route) => route.fulfill({ status: 200, json: overview }));
  await page.reload();
  await page.getByRole('heading', { name: 'Sauvegarde', level: 2, exact: true }).waitFor();
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
      await page.getByRole('alert').filter({ hasText: 'aucun groupe autorisé' }).waitFor();
    },
  },
  {
    // Réponses simulées : aucun administrateur n'existe encore (la démo en a un).
    name: 'premier-administrateur',
    hash: '',
    role: null,
    prepare: async (page) => {
      await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401, json: {} }));
      await page.route('**/api/auth/setup-status', (route) =>
        route.fulfill({ status: 200, json: { needsSetup: true } }),
      );
      await page.goto('/');
      await page.getByRole('heading', { name: 'Créer le compte administrateur' }).waitFor();
    },
  },
  {
    // Session simulée avec un mot de passe temporaire : la console impose le changement.
    name: 'mot-de-passe-impose',
    hash: '',
    role: null,
    prepare: async (page) => {
      await page.route('**/api/auth/me', (route) =>
        route.fulfill({
          status: 200,
          json: {
            csrfToken: 'demo',
            user: { username: 'operateur-demo', role: 'operator', mustChangePassword: true },
          },
        }),
      );
      await page.goto('/');
      await page.getByRole('heading', { name: 'Choisissez un nouveau mot de passe' }).waitFor();
    },
  },
  // Pied de page (version) : thème sombre, puis version d'une image construite, avant et après
  // connexion. Le clair avec « Version dev » figure sur `connexion` et `accueil-en-echec`.
  { name: 'connexion-sombre', hash: '', role: null, scheme: 'dark' },
  { name: 'connexion-version-image', hash: '', role: null, buildCommit: IMAGE_COMMIT },
  {
    name: 'tableau-de-bord-version-image-sombre',
    hash: '#/',
    role: 'admin',
    scheme: 'dark',
    buildCommit: IMAGE_COMMIT,
  },
  // Accueil : la démo inscrit un plan en échec (état réel, sans simulation) ; les deux autres états
  // sont simulés par la réponse de GET /api/overview.
  { name: 'accueil-en-echec', hash: '#/', role: 'admin' },
  { name: 'accueil-en-echec-sombre', hash: '#/', role: 'admin', scheme: 'dark' },
  {
    name: 'accueil-operationnelle',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      await overviewAs(page, {
        state: 'operational',
        plans: { total: 2, operational: 2, running: 0, queued: 0, failed: 0, late: 0 },
        lastBackupAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        lastBackupPlan: 'Boîtes mail, quotidien',
      });
      await page.getByText('Microsoft 365 connecté').waitFor();
    },
  },
  {
    // Carte « Plans » pendant une sauvegarde : un plan en cours, un lancement en file (issue #307).
    name: 'accueil-plans-en-file',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      await overviewAs(page, {
        state: 'operational',
        plans: { total: 3, operational: 3, running: 1, queued: 1, failed: 0, late: 0 },
        lastBackupAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        lastBackupPlan: 'Boîtes mail, quotidien',
      });
      await page.getByText('En file d’attente').waitFor();
    },
  },
  {
    name: 'accueil-non-configuree',
    hash: '#/',
    role: 'admin',
    prepare: (page) =>
      overviewAs(page, {
        state: 'unconfigured',
        plans: { total: 0, operational: 0, running: 0, queued: 0, failed: 0, late: 0 },
        lastBackupAt: null,
        lastBackupPlan: null,
      }),
  },
  {
    name: 'accueil-sans-resultat',
    hash: '#/',
    role: 'admin',
    prepare: (page) =>
      overviewAs(page, {
        state: 'pending',
        plans: { total: 1, operational: 0, running: 0, queued: 0, failed: 0, late: 0 },
        lastBackupAt: null,
        lastBackupPlan: null,
      }),
  },
  {
    name: 'accueil-non-configuree-operateur',
    hash: '#/',
    role: 'operator',
    prepare: (page) =>
      overviewAs(page, {
        state: 'unconfigured',
        plans: { total: 0, operational: 0, running: 0, queued: 0, failed: 0, late: 0 },
        lastBackupAt: null,
        lastBackupPlan: null,
      }),
  },
  {
    // Démo exposée sans identifiants Microsoft 365 : le bloc montre les étapes côté serveur.
    name: 'tableau-de-bord-non-configure',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/configuration', (route) =>
        route.fulfill({
          json: { microsoft: { connected: false }, workloads: ['mail', 'onedrive'] },
        }),
      );
      await page.reload();
      await page.getByText('Connexion Microsoft 365 à configurer').waitFor();
    },
  },
  {
    name: 'mot-de-passe',
    hash: '#/password',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Mot de passe actuel', { exact: true }).waitFor();
    },
  },
  {
    // Réponse simulée : changer le vrai mot de passe casserait les sessions de démonstration.
    name: 'mot-de-passe-modifie',
    hash: '#/password',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/auth/password', (route) => route.fulfill({ status: 204 }));
      await page.getByLabel('Mot de passe actuel', { exact: true }).fill('ancien mot de passe');
      await page.getByLabel('Nouveau mot de passe', { exact: true }).fill('nouveau mot de passe');
      await page
        .getByLabel('Confirmer le nouveau mot de passe', { exact: true })
        .fill('nouveau mot de passe');
      await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Mot de passe modifié.' }).first().waitFor();
    },
  },
  {
    name: 'recherche-boite',
    hash: '#/search?mailbox=paul.moreau%40exemple.fr',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').waitFor();
    },
  },
  {
    name: 'recherche',
    hash: '#/search',
    role: 'admin',
    // Entre 900 et 1280 px, l'adresse longue se coupe après le « @ » (voir demo.spec.ts).
    extraWidths: [1024],
    prepare: async (page) => {
      await page.getByLabel('Recherche').fill('devis');
      await page.getByRole('button', { name: 'Rechercher' }).click();
      await page.getByRole('table').waitFor();
    },
  },
  {
    name: 'recherche-sans-resultat',
    hash: '#/search',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Recherche').fill('introuvable-xyz');
      await page.getByRole('button', { name: 'Rechercher' }).click();
      await page.getByText('Aucun mail ne correspond').waitFor();
    },
  },
  {
    name: 'recherche-sans-resultat-filtre-boite',
    hash: '#/search',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Recherche').fill('introuvable-xyz');
      await page.getByLabel('Boîte', { exact: true }).fill('alice@example.test');
      await page.getByRole('button', { name: 'Rechercher' }).click();
      await page.getByRole('button', { name: 'Retirer les filtres' }).waitFor();
    },
  },
  {
    name: 'navigation-restaurer',
    hash: '#/search',
    role: 'admin',
    prepare: async (page) => {
      const menu = page.getByRole('button', { name: 'Menu' });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('link', { name: 'Messagerie' }).waitFor();
    },
  },
  {
    name: 'recherche-date-invalide',
    hash: '#/search',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Du (UTC)', { exact: true }).fill('31/02/2026');
      await page.getByRole('button', { name: 'Rechercher' }).click();
      await page.getByText('Cette date n’existe pas (31/02/2026)').waitFor();
    },
  },
  {
    name: 'recherche-periode-inversee',
    hash: '#/search',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Du (UTC)', { exact: true }).fill('20/11/2026');
      await page.getByLabel('Au (UTC)', { exact: true }).fill('18/11/2026');
      await page.getByRole('button', { name: 'Rechercher' }).click();
      await page.getByText('La date « Au » doit être égale ou postérieure à « Du »').waitFor();
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
    name: 'journal-audit-date-invalide',
    hash: '#/audit',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').waitFor();
      await page.getByLabel('Du (UTC)', { exact: true }).fill('31/02/2026');
      await page.getByRole('button', { name: 'Filtrer' }).click();
      await page.getByText('Cette date n’existe pas (31/02/2026)').waitFor();
    },
  },
  {
    name: 'journal-audit-periode-inversee',
    hash: '#/audit',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').waitFor();
      await page.getByLabel('Du (UTC)', { exact: true }).fill('20/11/2026');
      await page.getByLabel('Au (UTC)', { exact: true }).fill('18/11/2026');
      await page.getByRole('button', { name: 'Filtrer' }).click();
      await page.getByText('La date « Au » doit être égale ou postérieure à « Du »').waitFor();
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
    name: 'administration-creer-compte',
    hash: '#/comptes',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').first().waitFor();
      await page.getByRole('button', { name: 'Créer un compte' }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    name: 'reinitialisation-motif',
    hash: '#/comptes',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').first().waitFor();
      await page
        .getByRole('button', { name: 'Réinitialiser le mot de passe : operateur-demo' })
        .click();
      await page
        .getByLabel('Motif de la réinitialisation (obligatoire)')
        .fill('Oubli du mot de passe');
    },
  },
  {
    name: 'comptes-modifier-role',
    hash: '#/comptes',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').first().waitFor();
      await page.getByRole('button', { name: 'Modifier le rôle : operateur-demo' }).click();
      await page
        .getByLabel('Motif du changement de rôle (obligatoire)')
        .fill('Remplacement pendant les congés');
    },
  },
  {
    name: 'comptes-desactiver',
    hash: '#/comptes',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').first().waitFor();
      await page.getByRole('button', { name: 'Désactiver : operateur-demo' }).click();
      await page.getByLabel('Motif de la désactivation (obligatoire)').fill('Départ du service');
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
      await page
        .getByRole('button', { name: 'Réinitialiser le mot de passe : operateur-demo' })
        .click();
      await page
        .getByLabel('Motif de la réinitialisation (obligatoire)')
        .fill('Oubli du mot de passe');
      await page.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
      await page.getByRole('dialog').getByLabel('Mot de passe temporaire').waitFor();
    },
  },
  { name: 'page-reservee', hash: '#/comptes', role: 'operator' },
  {
    name: 'sources',
    hash: '#/sources',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('heading', { name: 'Sauvegardes' }).waitFor();
    },
  },
  {
    // En démo chaque service a un plan : la réponse est modifiée pour montrer la ligne grisée
    // « Aucun plan » et son lien « Créer un plan ».
    name: 'sources-sans-plan',
    hash: '#/sources',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/status', async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        body.services = body.services.map((s) =>
          s.service === 'sharepoint'
            ? {
                ...s,
                hasPlan: false,
                lastSnapshotAt: null,
                ageHours: null,
                state: 'missing',
                retentionDays: null,
                scope: null,
                awaitingFirstRun: false,
              }
            : s,
        );
        await route.fulfill({ response: res, json: body });
      });
      await page.reload();
      await page.getByRole('link', { name: 'Créer un plan' }).waitFor();
    },
  },
  {
    // Un plan sans aucune sauvegarde, avant l'échéance de sa première exécution : « En attente ».
    name: 'sources-en-attente',
    hash: '#/sources',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/status', async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        body.services = body.services.map((s) =>
          s.service === 'onedrive'
            ? {
                ...s,
                lastSnapshotAt: null,
                ageHours: null,
                state: 'missing',
                awaitingFirstRun: true,
              }
            : s,
        );
        await route.fulfill({ response: res, json: body });
      });
      await page.reload();
      await page.getByText('En attente').first().waitFor();
    },
  },
  {
    // Bouton « Voir l'erreur » de l'accueil : la liste réduite au plan en échec, avec sa cause.
    name: 'plans-liste-en-echec',
    hash: '#/plans?etat=echec',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').waitFor();
    },
  },
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
    // Lancement manuel en file derrière une sauvegarde en cours (issue #300) : réponse modifiée,
    // le mode démo n'a jamais deux sauvegardes à la fois.
    name: 'plans-lancement-en-file',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/plans', async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        body.items.forEach((plan, i) => {
          plan.running = i === 0;
          plan.queued = i === 1;
        });
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
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByText('Étape 2 sur 3 : Objectifs').waitFor();
    },
  },
  {
    name: 'plans-etape-3',
    hash: '#/plans/nouveau',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Nom du plan').fill('Messagerie Direction');
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByLabel('Justification de cette durée (obligatoire)').fill('Obligation légale');
      await page.getByRole('button', { name: 'Continuer' }).click();
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
    // Démo exposée sans identifiants Microsoft 365 : le serveur répond 503 backup_not_configured.
    name: 'plans-lancer-erreur',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/plans/*/run', (route) =>
        route.fulfill({
          status: 503,
          headers: { 'x-request-id': '3f2b8c1e-5a7d-4e0b-9c64-1d2a7b9e4f10' },
          json: { error: 'backup_not_configured' },
        }),
      );
      await page.getByRole('button', { name: 'Lancer Messagerie Direction maintenant' }).click();
      const dialog = page.getByRole('dialog', {
        name: 'Lancer « Messagerie Direction » maintenant',
      });
      await dialog.getByLabel('Motif du lancement (obligatoire)').fill('Contrôle de conformité');
      await dialog.getByRole('button', { name: 'Lancer la sauvegarde' }).click();
      // Le titre devient celui du résultat : la boîte se retrouve par son nouveau nom.
      const blocked = page.getByRole('dialog', { name: 'Lancement impossible' });
      await blocked.getByText('Aucune sauvegarde n’a été lancée.').waitFor();
      await blocked.locator('.dialog-actions').getByRole('button', { name: 'Fermer' }).waitFor();
      if ((await blocked.locator('select, input').count()) > 0) {
        throw new Error('Le formulaire de motif est encore affiché');
      }
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
    name: 'plans-supprimer-motif-manquant',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Supprimer Messagerie Direction' }).click();
      const dialog = page.getByRole('dialog', { name: 'Supprimer « Messagerie Direction » ?' });
      await dialog.getByRole('button', { name: 'Supprimer le plan' }).click();
      await dialog.getByText('Indiquez un motif pour continuer.').waitFor();
    },
  },
  {
    name: 'export-formulaire',
    hash: DEMO_MAIL_HASH,
    role: 'operator',
    prepare: async (page) => {
      await page.getByText('Expéditeur').first().waitFor();
      await page.getByRole('button', { name: /^Exporter /u }).click();
      await page.getByRole('dialog', { name: 'Exporter ce mail' }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: 'Exporter', exact: true }).click();
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
      await page.getByText(/Échec de la restauration de /u).waitFor();
    },
  },
  {
    // Restauration non configurée : GET /api/restore répond configured:false, le même état que le
    // 503 restore_unavailable de POST …/restore.
    name: 'restauration-non-configuree',
    hash: DEMO_MAIL_HASH,
    role: 'operator',
    prepare: async (page) => {
      await page.route('**/api/restore', (route) =>
        route.fulfill({ status: 200, json: { configured: false } }),
      );
      await page.reload();
      await page.getByText('Restauration indisponible').waitFor();
    },
  },
  {
    // Stockage non configuré ou en panne : l'API répond 503 catalog_unavailable.
    name: 'sharepoint-non-configure',
    hash: '#/sharepoint',
    role: 'operator',
    prepare: async (page) => {
      await page.route('**/api/sharepoint/**', (route) =>
        route.fulfill({ status: 503, json: { error: 'catalog_unavailable' } }),
      );
      await page.reload();
      await page.getByText('Sauvegardes inaccessibles').waitFor();
    },
  },
  {
    // Stockage non configuré ou en panne : l'API répond 503 catalog_unavailable.
    name: 'onedrive-non-configure',
    hash: '#/onedrive',
    role: 'operator',
    prepare: async (page) => {
      await page.route('**/api/onedrive/**', (route) =>
        route.fulfill({ status: 503, json: { error: 'catalog_unavailable' } }),
      );
      await page.route('**/api/mail/mailboxes', (route) =>
        route.fulfill({ status: 503, json: { error: 'catalog_unavailable' } }),
      );
      await page.reload();
      await page.getByText('Sauvegardes inaccessibles').waitFor();
    },
  },
  {
    // Même panne vue par un administrateur : la conduite à tenir, pas « Prévenez un administrateur ».
    name: 'onedrive-non-configure-admin',
    hash: '#/onedrive',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/onedrive/**', (route) =>
        route.fulfill({ status: 503, json: { error: 'catalog_unavailable' } }),
      );
      await page.route('**/api/mail/mailboxes', (route) =>
        route.fulfill({ status: 503, json: { error: 'catalog_unavailable' } }),
      );
      await page.reload();
      await page.getByText('prévenez l’exploitant du serveur').waitFor();
    },
  },
  {
    name: 'onedrive-parcourir',
    hash: '#/onedrive',
    role: 'operator',
    prepare: async (page) => {
      await openDrive(page);
      await page.getByRole('radio', { name: 'budget.xlsx' }).check();
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
    name: 'onedrive-version-choisie',
    hash: '#/onedrive',
    role: 'operator',
    prepare: async (page) => {
      await openDrive(page);
      await page.getByRole('button', { name: 'Versions de budget.xlsx' }).click();
      const panel = page.getByRole('dialog', { name: 'Versions de budget.xlsx' });
      await panel.getByRole('radio').nth(1).check();
      await panel.getByRole('button', { name: 'Choisir cette version' }).click();
      await page.getByText(/Sélection : budget\.xlsx, version du /).waitFor();
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
      await page.getByText(/Échec de la restauration de /u).waitFor();
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
    name: 'sharepoint-bibliotheques',
    hash: '#/sharepoint',
    role: 'operator',
    prepare: async (page) => {
      await openSite(page, SITES.commerce, 'item');
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
      await page.getByText(/Vous n’avez pas le droit de restaurer le site/u).waitFor();
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
      await page.getByText(/éléments? restaurés? en/u).waitFor();
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
      await page.getByText(/Échec de la restauration de /u).waitFor();
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
  {
    name: 'composants-confirmation-destructive',
    hash: '#/composants',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Supprimer', exact: true }).last().click();
      await page.getByRole('dialog', { name: 'Supprimer cet exemple ?' }).waitFor();
    },
  },
];
