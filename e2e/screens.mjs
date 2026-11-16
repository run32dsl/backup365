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
