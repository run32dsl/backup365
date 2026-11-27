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

/**
 * Restauration vers un autre compte (issue #546, administrateur) : ouvre la boîte du mail n° `n`,
 * choisit « Un autre compte » et lance la recherche `query` (Entrée).
 */
async function openOtherAccount(page, n, query) {
  await openMailFor(page, n);
  await page.getByRole('button', { name: /^Restaurer /u }).click();
  // Même titre que chez l'opérateur, à chaque étape (issue #574).
  const dialog = page.getByRole('dialog', { name: 'Restaurer ce mail' });
  await dialog.getByRole('radio', { name: 'Un autre compte' }).check();
  await dialog.getByText('Étape 1 sur 3').waitFor();
  await dialog.getByLabel('Rechercher un compte (nom ou adresse)').fill(query);
  await dialog.getByLabel('Rechercher un compte (nom ou adresse)').press('Enter');
  await dialog.getByText(/comptes? trouvés?\./u).waitFor();
}

/** Choisit le compte `account`, saisit un motif et va jusqu'à la confirmation (A3). */
async function toOtherAccountConfirmation(page, account) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: account }).check();
  await dialog.getByRole('button', { name: 'Continuer' }).click();
  await dialog.getByLabel(RESTORE_REASON_LABEL).fill('Ticket INC-12345 : départ d’un agent');
  await dialog.getByRole('button', { name: 'Continuer' }).click();
  await dialog.getByText('Étape 3 sur 3').waitFor();
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
  await page.getByText('Étape 2 sur 3').waitFor();
}

/** Saisit le motif et passe à l'étape « Récapitulatif ». */
export async function giveDriveReason(page) {
  await page.getByLabel(RESTORE_REASON_LABEL).fill('Suppression accidentelle par l’utilisateur');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByText('Étape 3 sur 3').waitFor();
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
  await page.getByText('Étape 2 sur 3').waitFor();
  await page.getByLabel(RESTORE_REASON_LABEL).fill('Dossier supprimé par erreur');
}

/** Choisit un chemin, donne le motif et arrive au récapitulatif. */
export async function reachSiteSummary(page, site, scope, ...names) {
  await openSite(page, site, scope);
  await browseSite(page, ...names);
  await continueStep(page);
  await giveSiteReason(page);
  await continueStep(page);
  await page.getByText('Étape 3 sur 3').waitFor();
}

/**
 * Un état de l'accueil, décrit une fois : `GET /api/overview`, `/api/plans` et `/api/runs` en
 * sont tous tirés, avec les règles du serveur (`overview-routes.ts`), pour que les trois cartes
 * et les blocs du dessous disent la même chose (#578).
 *
 * - `plans` : `{ name, dataTypes, state, rpoHours?, queued? }`, `state` au sens de la liste
 *   (`compliant`, `late`, `failed`) ;
 * - `runs` : `{ plan, minutesAgo, result, sources? }`, dans n'importe quel ordre ; une
 *   exécution terminée dure 40 secondes, dans la même minute que son début ;
 * - `lateBackups` : sauvegardes en retard de la carte « Sauvegarde ».
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ plans: object[], runs: object[], lateBackups?: object[] }} scenario
 */
async function homeAs(page, { plans, runs, lateBackups = [] }) {
  const { items: real } = await (await page.request.get('/api/plans')).json();
  if (!real[0]) throw new Error('homeAs : la démo doit avoir un plan, modèle des plans simulés');
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  const at = (minutesAgo, seconds) => new Date(minute - minutesAgo * 60_000 + seconds * 1000);
  const recentFirst = [...runs].sort((a, b) => a.minutesAgo - b.minutesAgo);
  const runItems = recentFirst.flatMap((r, i) => {
    const plan = plans.findIndex((p) => p.name === r.plan);
    const done = r.result !== 'running';
    return Array.from({ length: r.sources ?? 1 }, (_, s) => ({
      id: 1000 - i * 10 - s,
      planId: `plan-${plan}`,
      planName: r.plan,
      itemId: `source-${s}`,
      startedAt: at(r.minutesAgo, 5).toISOString(),
      finishedAt: done ? at(r.minutesAgo, 45).toISOString() : null,
      durationMs: done ? 40_000 : null,
      result: r.result,
      itemsSaved: r.result === 'success' ? 52 : null,
      sourceBytes: r.result === 'success' ? 340_000_000 : null,
      ...(r.result === 'failed' ? { failureCause: 'backup_errors' } : {}),
    }));
  });
  const runsOf = (name) => runItems.filter((r) => r.planName === name);
  // Dernière exécution terminée de chaque plan : elle fait l'état, comme sur le serveur.
  const latests = plans.map((p) => runsOf(p.name).find((r) => r.result !== 'running'));
  // Comme le serveur : un plan dont la dernière exécution a échoué est « En échec ».
  const stateOf = (p) => (runsOf(p.name)[0]?.result === 'failed' ? 'failed' : p.state);
  const items = plans.map((p, i) => {
    const own = runsOf(p.name);
    const success = own.find((r) => r.result === 'success');
    return {
      ...real[0],
      id: `plan-${i}`,
      name: p.name,
      dataTypes: p.dataTypes,
      rpoHours: p.rpoHours ?? 24,
      compliance: {
        state: stateOf(p),
        lastSuccessAt: success?.finishedAt ?? null,
        lastRestorePointAt: success?.finishedAt ?? null,
      },
      running: own.some((r) => r.result === 'running'),
      queued: p.queued ?? false,
      lastRun: own[0]
        ? {
            status: own[0].result,
            startedAt: own[0].startedAt,
            finishedAt: own[0].finishedAt,
            noSnapshotReason: null,
            ...(own[0].failureCause ? { failureCause: own[0].failureCause } : {}),
          }
        : null,
    };
  });
  const lastSuccess = runItems.find((r) => r.result === 'success');
  const failures = latests
    .filter((r) => r?.result === 'failed')
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  // Comme le serveur : un plan sans exécution terminée attend, il n'est compté dans aucun état.
  const count = (state) => plans.filter((p, i) => latests[i] && stateOf(p) === state).length;
  const running = items.filter((p) => p.running).length;
  const overview = {
    state:
      plans.length === 0
        ? 'unconfigured'
        : failures.length > 0
          ? 'failed'
          : latests.some(Boolean)
            ? 'operational'
            : 'pending',
    plans: {
      total: plans.length,
      operational: count('compliant'),
      running,
      queued: items.filter((p) => p.queued && !p.running).length,
      failed: count('failed'),
      late: count('late'),
      waiting: latests.filter((r) => !r).length,
    },
    lastBackupAt: lastSuccess?.finishedAt ?? null,
    lastBackupPlan: lastSuccess?.planName ?? null,
    lastFailure: failures[0] ? { plan: failures[0].planName, at: failures[0].finishedAt } : null,
    lateBackups,
  };
  await page.route('**/api/overview', (route) => route.fulfill({ status: 200, json: overview }));
  await page.route(/\/api\/plans$/, (route) => route.fulfill({ status: 200, json: { items } }));
  await page.route(/\/api\/runs(\?|$)/, (route) =>
    route.fulfill({ status: 200, json: { items: runItems, limit: 20 } }),
  );
  await page.reload();
  await page.getByRole('heading', { name: 'Sauvegarde', level: 2, exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Prochaine sauvegarde', level: 2 }).waitFor();
}

/** Simule une console sans identifiants Microsoft 365 utilisables (`/api/configuration`). */
async function unlinkMicrosoft(page) {
  await page.route('**/api/configuration', (route) =>
    route.fulfill({
      json: { microsoft: { connected: false }, workloads: ['mail', 'onedrive'] },
    }),
  );
}

/**
 * En démo le stockage accepte les écritures conditionnelles : `GET /api/status` est modifié pour
 * dire qu'il les ignore, ce qui bloque sauvegardes et restaurations (issues #567, #612).
 *
 * @param {import('@playwright/test').Page} page
 */
async function blockStorage(page) {
  await page.route('**/api/status', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.storage = { conditionalWrites: 'ignored' };
    await route.fulfill({ response: res, json: body });
  });
}

/** Titre du bandeau d'erreur d'un stockage bloqué (#612). */
const STORAGE_BLOCKED = 'Sauvegardes et restaurations bloquées sur ce stockage';

/**
 * Vérifie que le bandeau d'erreur du stockage précède le rappel d'audit dans `scope` (#612).
 *
 * @param {import('@playwright/test').Locator} scope
 */
async function expectStorageBeforeAudit(scope) {
  await scope.getByRole('alert').getByText(STORAGE_BLOCKED).waitFor();
  const texts = await scope.locator('.alert').allInnerTexts();
  const storage = texts.findIndex((t) => t.includes(STORAGE_BLOCKED));
  const audit = texts.findIndex((t) => t.includes('inscrite au journal d’audit'));
  if (storage < 0 || audit < 0 || storage > audit)
    throw new Error(`bandeau du stockage (${storage}) après le rappel d’audit (${audit})`);
}

/** Plans de l'accueil simulé : ce que chacun protège. */
const MAIL_PLAN = { name: 'Boîtes mail, quotidien', dataTypes: ['mail'] };
const FILES_PLAN = { name: 'Fichiers, quotidien', dataTypes: ['onedrive', 'sharepoint'] };
const DIRECTION_PLAN = {
  name: 'Boîte direction, toutes les 4 h',
  dataTypes: ['mail'],
  rpoHours: 4,
};

/** Ouvre « Sauvegarder maintenant » sur l'accueil et saisit un motif ; renvoie le dialogue. */
async function openRunAll(page) {
  await page.getByRole('button', { name: 'Sauvegarder maintenant' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sauvegarder maintenant' });
  await dialog
    .getByLabel('Motif du lancement (obligatoire)')
    .fill('Ticket INC-1234 : avant migration');
  return dialog;
}

/** Retire de `/api/status` les plans listés qui couvrent ce service, décomptes compris. */
function dropListedPlans(body, service) {
  if (!body.plans) return;
  for (const p of body.plans.nonCompliant) {
    if (p.dataTypes?.includes(service)) body.plans.counts[p.state] -= 1;
  }
  body.plans.nonCompliant = body.plans.nonCompliant.filter((p) => !p.dataTypes?.includes(service));
}

/**
 * Retire un service de la couverture des plans listés : un plan qui ne couvrait que lui disparaît,
 * décomptes compris ; un plan qui en couvre d'autres reste, avec son état (issue #495).
 */
function uncoverListedPlans(body, service) {
  if (!body.plans) return;
  const only = (p) => p.dataTypes?.length === 1 && p.dataTypes[0] === service;
  for (const p of body.plans.nonCompliant) if (only(p)) body.plans.counts[p.state] -= 1;
  body.plans.nonCompliant = body.plans.nonCompliant
    .filter((p) => !only(p))
    .map((p) => (p.dataTypes ? { ...p, dataTypes: p.dataTypes.filter((t) => t !== service) } : p));
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
      await page.getByRole('heading', { name: 'Accueil' }).waitFor();
      // Sur mobile, ouvre le menu pour montrer l'identifiant du compte en bas de la barre.
      const menu = page.getByRole('button', { name: 'Menu' });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('button', { name: 'Se déconnecter' }).waitFor();
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
  // Bloc « Couverture du tenant », « Prochaine sauvegarde » et « Derniers événements ».
  { name: 'accueil-couverture', hash: '#/', role: 'admin' },
  {
    // « Derniers événements » : une exécution de chaque statut, dont une « En cours » (#475).
    name: 'accueil-derniers-evenements',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      const { items: plans } = await (await page.request.get('/api/plans')).json();
      const [a, b = a] = plans;
      const at = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
      const run = (id, plan, minutes, result, extra = {}) => ({
        id,
        planId: plan.id,
        planName: plan.name,
        itemId: 'box',
        startedAt: at(minutes),
        finishedAt: result === 'running' ? null : at(minutes - 14),
        durationMs: result === 'running' ? null : 14 * 60_000,
        result,
        itemsSaved: result === 'success' ? 1284 : null,
        sourceBytes: result === 'success' ? 3_400_000_000 : null,
        ...extra,
      });
      const items = [
        run(5, a, 1, 'running'),
        run(4, b, 60, 'failed', { failureCause: 'backup_errors' }),
        // Une exécution sur cinq boîtes : une seule ligne « 5 boîtes » (#571).
        ...['b1', 'b2', 'b3', 'b4', 'b5'].map((itemId, i) =>
          run(30 + i, a, 180, 'success', { itemId, itemsSaved: 0, sourceBytes: null }),
        ),
        run(2, b, 600, 'interrupted', { failureCause: 'interrupted' }),
        run(1, a, 1440, 'success', { itemsSaved: 1, sourceBytes: 840_000_000 }),
      ];
      await page.route(/\/api\/runs(\?|$)/, (route) =>
        route.fulfill({ status: 200, json: { items, limit: 5 } }),
      );
      await page.reload();
      // Le résumé du tableau et la ligne de la carte le disent : un seul est visible par largeur.
      await page.getByText('sauvegarde en cours').filter({ visible: true }).first().waitFor();
    },
  },
  {
    // « Derniers événements » rempli par les exécutions réelles de la démo, sans simulation (#476).
    name: 'accueil-evenements',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      await page.locator('.events-table tbody tr').first().waitFor();
    },
  },
  {
    // Dialogue « Sauvegarder maintenant », motif saisi : le champ garde le focus visible (#476).
    name: 'accueil-sauvegarder-maintenant',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      await openRunAll(page);
    },
  },
  {
    // Lancement partiel : un plan refusé, la boîte passe en résultat (bilan, plan non lancé,
    // motif rappelé, seul « Fermer ») (#476, #596). Les lancements sont simulés.
    name: 'accueil-sauvegarder-maintenant-echec',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      let calls = 0;
      await page.route(/\/api\/plans\/[^/]+\/run$/, (route) => {
        calls += 1;
        return calls === 2
          ? route.fulfill({ status: 409, json: { error: 'run_in_progress' } })
          : route.fulfill({ status: 202, json: { queued: false } });
      });
      const dialog = await openRunAll(page);
      await dialog.getByRole('button', { name: 'Lancer la sauvegarde' }).click();
      await page.getByRole('dialog', { name: 'Lancement partiel' }).waitFor();
    },
  },
  { name: 'accueil-en-echec-sombre', hash: '#/', role: 'admin', scheme: 'dark' },
  // États simulés : toute la page suit le même scénario (`homeAs`, #578).
  {
    name: 'accueil-operationnelle',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      await homeAs(page, {
        plans: [
          { ...MAIL_PLAN, state: 'compliant' },
          { ...FILES_PLAN, state: 'compliant' },
        ],
        runs: [
          { plan: MAIL_PLAN.name, minutesAgo: 200, result: 'success', sources: 5 },
          { plan: FILES_PLAN.name, minutesAgo: 300, result: 'success', sources: 8 },
          { plan: MAIL_PLAN.name, minutesAgo: 1620, result: 'success', sources: 5 },
          { plan: FILES_PLAN.name, minutesAgo: 1740, result: 'success', sources: 8 },
        ],
      });
      await page.getByText('Microsoft 365 connecté').waitFor();
    },
  },
  {
    // Aucun plan en échec, une sauvegarde OneDrive en retard : son plan est en retard (#462, #495).
    name: 'accueil-en-retard',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      await homeAs(page, {
        plans: [
          { ...MAIL_PLAN, state: 'compliant' },
          { ...FILES_PLAN, state: 'late' },
        ],
        runs: [
          { plan: MAIL_PLAN.name, minutesAgo: 200, result: 'success', sources: 5 },
          { plan: MAIL_PLAN.name, minutesAgo: 1620, result: 'success', sources: 5 },
          { plan: FILES_PLAN.name, minutesAgo: 4320, result: 'success', sources: 8 },
        ],
        lateBackups: [
          {
            service: 'onedrive',
            name: 'paul.moreau@exemple.fr',
            lastSnapshotAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
          },
        ],
      });
      await page.getByText('1 sauvegarde en retard').waitFor();
    },
  },
  {
    // Carte « Plans » pendant une sauvegarde : un plan en cours, un lancement en file (issue #307).
    name: 'accueil-plans-en-file',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      await homeAs(page, {
        plans: [
          { ...MAIL_PLAN, state: 'compliant' },
          { ...FILES_PLAN, state: 'compliant', queued: true },
          { ...DIRECTION_PLAN, state: 'compliant' },
        ],
        runs: [
          { plan: DIRECTION_PLAN.name, minutesAgo: 2, result: 'running' },
          { plan: MAIL_PLAN.name, minutesAgo: 200, result: 'success', sources: 5 },
          { plan: DIRECTION_PLAN.name, minutesAgo: 230, result: 'success' },
          { plan: FILES_PLAN.name, minutesAgo: 300, result: 'success', sources: 8 },
        ],
      });
      await page.getByText('En file d’attente').waitFor();
    },
  },
  {
    name: 'accueil-non-configuree',
    hash: '#/',
    role: 'admin',
    prepare: (page) => homeAs(page, { plans: [], runs: [] }),
  },
  {
    name: 'accueil-sans-resultat',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      // Jamais exécuté, le plan est « En retard » pour le serveur (`planCompliance`).
      await homeAs(page, { plans: [{ ...MAIL_PLAN, state: 'late' }], runs: [] });
      await page.getByText('Aucune exécution pour le moment.').waitFor();
      await page.getByText('1 plan, en attente de sa première sauvegarde').waitFor();
    },
  },
  {
    name: 'accueil-non-configuree-operateur',
    hash: '#/',
    role: 'operator',
    prepare: (page) => homeAs(page, { plans: [], runs: [] }),
  },
  {
    // Installation jamais terminée (aucune exécution) : le bloc montre les étapes côté serveur.
    name: 'tableau-de-bord-non-configure',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      await unlinkMicrosoft(page);
      await homeAs(page, { plans: [MAIL_PLAN], runs: [] });
      await page.getByText('Connexion Microsoft 365 à configurer').waitFor();
    },
  },
  {
    // Connexion perdue après des sauvegardes (#604) : erreur, date de la dernière exécution.
    name: 'accueil-connexion-interrompue',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      await unlinkMicrosoft(page);
      await page.reload();
      await page.getByRole('alert').getByText('Connexion Microsoft 365 interrompue').waitFor();
      await page.getByRole('button', { name: 'Voir la conduite à tenir' }).waitFor();
    },
  },
  {
    // Stockage bloqué (#612) : erreur sous le `h1`, carte « Interrompue », ni échéance ni lancement.
    name: 'accueil-stockage-bloque',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      await blockStorage(page);
      await page.reload();
      await page.getByRole('alert').getByText(STORAGE_BLOCKED).waitFor();
      await page.getByText('Aucune sauvegarde ne partira tant que le stockage').waitFor();
    },
  },
  {
    // Stockage bloqué (#612) : erreur en tête, lancement manuel suspendu, dit une fois.
    name: 'plans-stockage-bloque',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await blockStorage(page);
      await page.reload();
      await page.getByRole('alert').getByText(STORAGE_BLOCKED).waitFor();
      await page
        .getByRole('link', { name: /^Modifier / })
        .first()
        .waitFor();
      if ((await page.getByRole('button', { name: /^Lancer /u }).count()) > 0)
        throw new Error('« Lancer maintenant » proposé sur un stockage bloqué');
      const suspended = await page.getByText('Le lancement manuel des plans est suspendu').count();
      if (suspended !== 1) throw new Error(`suspension écrite ${suspended} fois`);
    },
  },
  {
    name: 'plans-connexion-interrompue',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await unlinkMicrosoft(page);
      await page.reload();
      await page.getByRole('alert').getByText('Connexion Microsoft 365 interrompue').waitFor();
      await page
        .getByRole('alert')
        .getByText('Le lancement manuel des plans est suspendu')
        .waitFor();
      await page
        .getByRole('link', { name: /^Modifier / })
        .first()
        .waitFor();
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
      await page.getByRole('link', { name: 'Mails' }).waitFor();
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
  // Activités › Sauvegardes : historique des exécutions (issue #258), clair et sombre, puis
  // filtré sur les échecs, puis un seul plan (lien « Historique » de la liste des plans).
  {
    name: 'activites-sauvegardes',
    hash: '#/activites',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').waitFor();
    },
  },
  {
    name: 'activites-sauvegardes-sombre',
    hash: '#/activites',
    role: 'operator',
    scheme: 'dark',
    prepare: async (page) => {
      await page.getByRole('table').waitFor();
    },
  },
  {
    name: 'activites-sauvegardes-echecs',
    hash: '#/activites',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').waitFor();
      await page.getByLabel('Résultat', { exact: true }).selectOption({ label: 'En échec' });
      await page.getByRole('button', { name: 'Filtrer' }).click();
      // La pastille, visible en tableau comme en carte (« Cause : » n'est que dans le tableau).
      await page.locator('td .badge', { hasText: 'En échec' }).first().waitFor();
    },
  },
  {
    name: 'activites-sauvegardes-plan',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('link', { name: 'Historique de Boîtes mail, quotidien' }).click();
      await page.getByRole('table').waitFor();
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
    // Les connexions des captures repoussent les exports hors de la première page : filtre sur l'export.
    name: 'journal-audit-export',
    hash: '#/audit',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('table').waitFor();
      await page.getByLabel('Action', { exact: true }).selectOption({ label: 'Export' });
      await page.getByRole('button', { name: 'Filtrer' }).click();
      await page.getByText('Motif : Ticket INC-10001').first().waitFor();
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
  {
    // Même écran, case cochée : « Terminer » est plein et actif.
    name: 'mot-de-passe-temporaire-coche',
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
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Mot de passe temporaire').waitFor();
      await dialog.getByLabel('J’ai transmis le mot de passe').check();
    },
  },
  {
    // Réponse simulée : créer un vrai compte à chaque capture polluerait la démonstration.
    name: 'creation-mot-de-passe-temporaire',
    hash: '#/comptes',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/accounts', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({
              status: 201,
              json: {
                id: 99,
                username: 'nouveau-compte',
                role: 'operator',
                disabled: false,
                mustChangePassword: true,
                createdAt: '2026-11-24T09:00:00.000Z',
                password: 'Tz7k-Qp3m-Vx9d-Lw2h',
              },
            })
          : route.fallback(),
      );
      await page.getByRole('table').first().waitFor();
      await page.getByRole('button', { name: 'Créer un compte' }).click();
      await page.getByLabel('Identifiant').fill('nouveau-compte');
      await page.getByRole('button', { name: 'Créer le compte' }).click();
      await page.getByRole('dialog').getByLabel('Mot de passe temporaire').waitFor();
    },
  },
  { name: 'page-reservee', hash: '#/comptes', role: 'operator' },
  {
    // Écran A : envoi prêt (boîte fictive de la démo), deux destinataires, dernier rapport envoyé.
    name: 'rapports-par-mail',
    hash: '#/rapports',
    role: 'admin',
    prepare: async (page) => {
      await page.getByText('Envoi par Microsoft 365 prêt').waitFor();
    },
  },
  {
    // Écran B : récapitulatif avant l'enregistrement.
    name: 'rapports-par-mail-recapitulatif',
    hash: '#/rapports',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByRole('heading', { name: 'Vérifier avant d’enregistrer' }).waitFor();
    },
  },
  {
    // Écran C : réponse simulée. Le serveur limite à un essai par 30 s et chaque largeur
    // rejoue l'écran : sans simulation, la seconde capture reçoit 429.
    name: 'rapports-par-mail-essai',
    hash: '#/rapports',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/reports/test', (route) =>
        route.fulfill({ json: { at: '2026-11-24T09:00:00.000Z', count: 1 } }),
      );
      await page
        .getByLabel('Ajouter un destinataire', { exact: true })
        .fill('admin@exemple.invalid');
      await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
      await page.getByRole('button', { name: 'Envoyer un essai' }).click();
      await page.getByText('Vérifiez aussi le dossier des courriers indésirables.').waitFor();
    },
  },
  {
    // Adresse déjà dans la liste : l'erreur s'affiche sous le champ « Ajouter un destinataire ».
    name: 'rapports-par-mail-adresse-deja-presente',
    hash: '#/rapports',
    role: 'admin',
    prepare: async (page) => {
      const field = page.getByLabel('Ajouter un destinataire', { exact: true });
      await field.fill('marie.durand@exemple.invalid');
      await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
      await page.getByText('Cette adresse est déjà dans la liste.').waitFor();
    },
  },
  {
    // Écran D : réponse simulée, la démo ayant toujours un envoi prêt.
    name: 'rapports-par-mail-permission',
    hash: '#/rapports',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/reports', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              json: {
                settings: { recipients: [], frequency: 'weekly', failureAlert: true },
                mailer: { state: 'permission', sender: 'sauvegardes@exemple.invalid' },
                lastSend: null,
                plans: 0,
              },
            })
          : route.fallback(),
      );
      await page.reload();
      await page.getByText('Envoi par mail à autoriser').waitFor();
    },
  },
  {
    // Accueil : le dernier rapport n'est pas parti (réponse simulée).
    name: 'accueil-rapport-en-echec',
    hash: '#/',
    role: 'admin',
    prepare: async (page) => {
      await page.route('**/api/reports', (route) =>
        route.fulfill({
          json: {
            settings: {
              recipients: ['marie.durand@exemple.invalid'],
              frequency: 'weekly',
              failureAlert: true,
            },
            mailer: { state: 'permission', sender: 'sauvegardes@exemple.invalid' },
            lastSend: { at: '2026-11-23T07:00:00.000Z', kind: 'report', ok: false },
            plans: 4,
          },
        }),
      );
      await page.reload();
      await page.getByText('Le dernier rapport n’a pas pu être envoyé').waitFor();
    },
  },
  { name: 'rapports-page-reservee', hash: '#/rapports', role: 'operator' },
  {
    name: 'sources',
    hash: '#/sources',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('heading', { name: 'Sauvegardes' }).waitFor();
    },
  },
  {
    // Le lien d'un service en échec : Activités › Sauvegardes, déjà filtrée sur « En échec » (#592).
    name: 'sources-vers-sauvegardes-en-echec',
    hash: '#/sources',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('link', { name: 'Voir les sauvegardes en échec : Messagerie' }).click();
      await page.locator('td .badge', { hasText: 'En échec' }).first().waitFor();
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
        // SharePoint jamais protégé : aucune sauvegarde de site, sinon la ligne en reprend la date.
        body.rows = body.rows.filter((r) => r.kind !== 'site');
        // Et aucun plan listé ne le couvre ; le plan des fichiers garde OneDrive et son retard.
        uncoverListedPlans(body, 'sharepoint');
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
    // Stockage bloqué (issues #567, #612) : bandeau d'erreur en tête, section « Stockage » juste dessous.
    name: 'sources-stockage-sans-ecritures-conditionnelles',
    hash: '#/sources',
    role: 'admin',
    prepare: async (page) => {
      await blockStorage(page);
      await page.reload();
      await page.getByRole('alert').first().getByText(STORAGE_BLOCKED, { exact: true }).waitFor();
      await page.getByRole('heading', { name: 'Stockage' }).waitFor();
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
        // Le plan des fichiers n'a jamais tourné : aucune sauvegarde OneDrive ni SharePoint, sinon
        // les lignes du catalogue disent le contraire (même plan, mêmes états).
        const files = ['onedrive', 'sharepoint'];
        body.rows = body.rows.filter((r) => !files.includes(r.workload));
        dropListedPlans(body, 'onedrive');
        // Ce plan, sans exécution, est compté « En attente » à part : la somme égale les plans.
        body.plans.pending = 1;
        body.services = body.services.map((s) =>
          files.includes(s.service)
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
    // Simulation de conservation (issue #79) : le premier plan de la démo (90 jours) a un
    // instantané mail de 120 jours ; rien n'est supprimé.
    name: 'plans-conservation-simulation',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await page.getByText('Durée 90 jours :').waitFor();
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
    name: 'plans-creation-etape-1',
    hash: '#/plans/nouveau',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Nom du plan').fill('Plan de démonstration');
    },
  },
  {
    // Contacts cochés (issue #543) : la case n'est jamais cochée par défaut.
    name: 'plans-creation-contacts',
    hash: '#/plans/nouveau',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Nom du plan').fill('Carnets d’adresses');
      await page.getByRole('checkbox', { name: /^Contacts/ }).check();
    },
  },
  {
    // Agenda coché (issue #544) : la case n'est jamais cochée par défaut.
    name: 'plans-creation-agenda',
    hash: '#/plans/nouveau',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Nom du plan').fill('Agendas de la direction');
      await page.getByRole('checkbox', { name: /^Contacts/ }).check();
      await page.getByRole('checkbox', { name: /^Agenda/ }).check();
    },
  },
  {
    name: 'plans-creation-etape-1-sombre',
    hash: '#/plans/nouveau',
    role: 'admin',
    scheme: 'dark',
    prepare: async (page) => {
      await page.getByLabel('Nom du plan').fill('Plan de démonstration');
    },
  },
  {
    name: 'plans-creation-etape-2-sombre',
    hash: '#/plans/nouveau',
    role: 'admin',
    scheme: 'dark',
    prepare: async (page) => {
      await page.getByLabel('Nom du plan').fill('Plan de démonstration');
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByText('Étape 2 sur 3').waitFor();
    },
  },
  {
    name: 'plans-creation-etape-3-sombre',
    hash: '#/plans/nouveau',
    role: 'admin',
    scheme: 'dark',
    prepare: async (page) => {
      await page.getByLabel('Nom du plan').fill('Plan de démonstration');
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByLabel('Justification de cette durée (obligatoire)').fill('Obligation légale');
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByText('Étape 3 sur 3').waitFor();
    },
  },
  {
    name: 'plans-creation-etape-2',
    hash: '#/plans/nouveau',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Nom du plan').fill('Plan de démonstration');
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByText('Étape 2 sur 3').waitFor();
    },
  },
  {
    name: 'plans-creation-etape-3',
    hash: '#/plans/nouveau',
    role: 'admin',
    prepare: async (page) => {
      await page.getByLabel('Nom du plan').fill('Plan de démonstration');
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByLabel('Justification de cette durée (obligatoire)').fill('Obligation légale');
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByText('Étape 3 sur 3').waitFor();
    },
  },
  {
    name: 'plans-creation-erreur',
    hash: '#/plans/nouveau',
    role: 'admin',
    prepare: async (page) => {
      // Nom déjà pris et périmètre vide : les deux erreurs, le focus sur le nom.
      await page.getByLabel('Nom du plan').fill('Messagerie Direction');
      await page.getByRole('radio', { name: 'Boîtes, comptes et sites choisis' }).check();
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByText('Ce nom est déjà utilisé. Choisissez-en un autre.').waitFor();
    },
  },
  {
    // Périmètre choisi : un groupe par service coché, dont les sites SharePoint.
    name: 'plans-creation-perimetre',
    hash: '#/plans/nouveau',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('radio', { name: 'Boîtes, comptes et sites choisis' }).check();
      await page.getByRole('group', { name: 'Sites SharePoint' }).waitFor();
    },
  },
  {
    name: 'plans-lancer',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Lancer Messagerie Direction maintenant' }).click();
      await page.getByRole('dialog', { name: 'Lancer ce plan maintenant' }).waitFor();
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
        name: 'Lancer ce plan maintenant',
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
      await page.getByRole('dialog', { name: 'Supprimer ce plan\u202F?' }).waitFor();
    },
  },
  {
    name: 'plans-supprimer-motif-manquant',
    hash: '#/plans',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Supprimer Messagerie Direction' }).click();
      const dialog = page.getByRole('dialog', { name: 'Supprimer ce plan\u202F?' });
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
    // Stockage bloqué (#612) : l'erreur est dite avant le rappel d'audit et la saisie du motif.
    name: 'restauration-stockage-bloque',
    hash: DEMO_MAIL_HASH,
    role: 'admin',
    prepare: async (page) => {
      await blockStorage(page);
      await openRestorePanel(page, 11);
      await expectStorageBeforeAudit(page.getByRole('dialog'));
    },
  },
  {
    name: 'onedrive-motif-stockage-bloque',
    hash: '#/onedrive',
    role: 'admin',
    prepare: async (page) => {
      await blockStorage(page);
      await page.reload();
      await openDrive(page);
      await chooseDriveFile(page, 'budget.xlsx');
      await expectStorageBeforeAudit(page.locator('main'));
    },
  },
  {
    name: 'sharepoint-motif-stockage-bloque',
    hash: '#/sharepoint',
    role: 'admin',
    prepare: async (page) => {
      await blockStorage(page);
      await page.reload();
      await openSite(page, SITES.commerce, 'library');
      await browseSite(page, 'Documents partagés');
      await continueStep(page);
      await page.getByText('Étape 2 sur 3').waitFor();
      await expectStorageBeforeAudit(page.locator('main'));
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
    // A1 de l'issue #546 : un administrateur choisit « Un autre compte » et cherche le compte.
    name: 'restauration-autre-compte-destination',
    hash: DEMO_MAIL_HASH,
    role: 'admin',
    prepare: async (page) => {
      await openOtherAccount(page, 13, 'exemple.fr');
    },
  },
  {
    // A3 : récapitulatif source → destination (adresse longue : elle passe à la ligne).
    name: 'restauration-autre-compte-confirmation',
    hash: DEMO_MAIL_HASH,
    role: 'admin',
    prepare: async (page) => {
      await openOtherAccount(page, 14, 'direction');
      await toOtherAccountConfirmation(page, /^direction\.administrative/u);
    },
  },
  {
    // A3, corps défilé jusqu'en bas (#574, #590) : le titre et le « ✕ » restent visibles en haut,
    // les trois boutons sur une ligne dès 900 px, empilés pleine largeur sur mobile.
    name: 'restauration-autre-compte-confirmation-actions',
    hash: DEMO_MAIL_HASH,
    role: 'admin',
    extraWidths: [900],
    prepare: async (page) => {
      await openOtherAccount(page, 14, 'direction');
      await toOtherAccountConfirmation(page, /^direction\.administrative/u);
      await page.locator('.dialog-body').evaluate((body) => {
        body.scrollTop = body.scrollHeight;
      });
    },
  },
  {
    // A4 : restauration terminée chez l'autre compte.
    name: 'restauration-autre-compte-terminee',
    hash: DEMO_MAIL_HASH,
    role: 'admin',
    prepare: async (page) => {
      await openOtherAccount(page, 15, 'sophie');
      await toOtherAccountConfirmation(page, /^sophie\.bernard/u);
      await page.getByRole('button', { name: /^Restaurer vers /u }).click();
      await page.getByRole('dialog', { name: 'Restauration terminée' }).waitFor();
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
      await page.getByText(/Sélection : fichier « budget\.xlsx », version du /).waitFor();
    },
  },
  {
    name: 'onedrive-sans-selection',
    hash: '#/onedrive',
    role: 'operator',
    prepare: async (page) => {
      await openDrive(page);
      await page.getByText('Cochez un fichier ou un dossier pour continuer.').waitFor();
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
      await page.getByText(/fichier restauré en/u).waitFor();
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
  // Les quatre tons d'alerte en thème sombre : même gabarit d'icône, « i » cerclé (#588).
  {
    name: 'composants-alertes-sombre',
    hash: '#/composants',
    role: 'admin',
    scheme: 'dark',
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
    // Contenu plus haut que l'écran (#590) : seul le corps défile, en-tête et actions visibles.
    name: 'composants-dialogue-long',
    hash: '#/composants',
    role: 'admin',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Ouvrir une boîte au contenu long' }).click();
      await page.getByRole('dialog', { name: 'Boîte au contenu long' }).waitFor();
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
