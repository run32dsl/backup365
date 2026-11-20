import { DEMO_LOGINS } from './demo-server.mjs';
import { expect, test } from './fixtures.js';
import { signInAs } from './browser.mjs';

const EXPIRED = 'Votre session a expiré. Reconnectez-vous pour revenir à la page demandée.';
const TEMPORARY = 'Tz7k-Qp3m-Vx9d-Lw2h';

test('401 en cours de navigation : #/connexion avec message, puis retour à la page demandée', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'admin');
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();

  // La session disparaît côté serveur : la prochaine requête protégée reçoit un 401.
  await context.clearCookies();
  await page.getByRole('link', { name: 'Journal d’audit' }).click();

  await expect(page).toHaveURL(/#\/connexion$/);
  await expect(page.getByRole('status').filter({ hasText: EXPIRED })).toBeVisible();

  await page.getByLabel('Identifiant').fill(DEMO_LOGINS.admin.username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(DEMO_LOGINS.admin.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/#\/audit$/);
  await expect(page.getByRole('heading', { name: 'Journal d’audit' })).toBeVisible();
  await expect(page.getByText(EXPIRED)).toHaveCount(0);
});

test('changement volontaire du mot de passe : la page reste affichée, formulaire vidé, confirmation qui disparaît au prochain envoi', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'admin');
  // Réponse simulée : changer le vrai mot de passe casserait les autres tests.
  await page.route('**/api/auth/password', (route) => route.fulfill({ status: 204 }));
  await page.goto('/#/password');
  const current = page.getByLabel('Mot de passe actuel', { exact: true });
  const next = page.getByLabel('Nouveau mot de passe', { exact: true });
  const confirm = page.getByLabel('Confirmer le nouveau mot de passe', { exact: true });
  await current.fill('ancien mot de passe');
  await next.fill('nouveau mot de passe');
  await confirm.fill('nouveau mot de passe');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();

  await expect(page).toHaveURL(/#\/password$/);
  await expect(page.getByRole('heading', { name: 'Mot de passe', exact: true })).toBeVisible();
  const saved = page.getByRole('status').filter({ hasText: 'Mot de passe modifié.' });
  await expect(saved).toBeVisible();
  await expect(current).toHaveValue('');
  await expect(next).toHaveValue('');
  await expect(confirm).toHaveValue('');

  // Un second envoi avec une confirmation différente fait disparaître le message.
  await current.fill('ancien mot de passe');
  await next.fill('nouveau mot de passe');
  await confirm.fill('autre mot de passe');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(saved).toHaveCount(0);
});

test('changement imposé du mot de passe : même retour au tableau de bord, avec confirmation qui disparaît après 8 s', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'admin');
  let changed = false;
  // Session réelle, avec le drapeau « mot de passe à changer » tant que le changement n'a pas eu lieu.
  await page.route('**/api/auth/me', async (route) => {
    const response = await route.fetch();
    const session = (await response.json()) as { user: Record<string, unknown> };
    await route.fulfill({
      response,
      json: { ...session, user: { ...session.user, mustChangePassword: !changed } },
    });
  });
  await page.route('**/api/auth/password', (route) => {
    changed = true;
    return route.fulfill({ status: 204 });
  });
  await page.clock.install();
  await page.goto('/');
  await page.getByLabel('Mot de passe actuel', { exact: true }).fill('ancien mot de passe');
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill('nouveau mot de passe');
  await page
    .getByLabel('Confirmer le nouveau mot de passe', { exact: true })
    .fill('nouveau mot de passe');
  await page.getByRole('button', { name: 'Enregistrer et continuer' }).click();

  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  const status = page.getByRole('status').filter({ hasText: 'Mot de passe modifié.' }).first();
  await expect(status).toBeVisible();
  await expect(page.getByLabel('Mot de passe actuel', { exact: true })).toHaveCount(0);

  // Le message disparaît après 8 s.
  await page.clock.fastForward(8500);
  await expect(page.getByText('Mot de passe modifié.')).toHaveCount(0);
});

test('connexion Microsoft (fournisseur simulé de la démo) : le bouton ouvre la console', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Se connecter avec un compte Microsoft' }).click();
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  await expect(page.getByText('compte-microsoft@exemple.fr').first()).toBeVisible();
});

test('connexion verrouillée : décompte, bouton inactif, puis le champ reprend le focus', async ({
  page,
}) => {
  // Réponse simulée : un vrai verrouillage bloquerait l'adresse pour les autres tests.
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'retry-after': '3' },
      body: JSON.stringify({ error: 'too_many_attempts', retryAfterSec: 3 }),
    }),
  );
  await page.goto('/');
  await page.getByLabel('Identifiant').fill('inconnu.exemple');
  await page.getByLabel('Mot de passe', { exact: true }).fill('un mot de passe quelconque');
  await page.getByRole('button', { name: 'Se connecter' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText(
    /Connexion temporairement bloquée.*Nouvel essai possible dans 00:0\d\./s,
  );
  const submit = page.getByRole('button', { name: 'Se connecter' });
  await expect(submit).toBeDisabled();
  // Les champs sont conservés.
  await expect(page.getByLabel('Identifiant')).toHaveValue('inconnu.exemple');

  await expect(submit).toBeEnabled({ timeout: 8000 });
  await expect(alert).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'Vous pouvez réessayer.' }),
  ).toBeAttached();
  await expect(page.getByLabel('Identifiant')).toBeFocused();
});

test('réinitialisation : motif obligatoire, mot de passe affiché une seule fois, fermeture après confirmation', async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signInAs(context, baseURL!, 'admin');
  // Réponse simulée : réinitialiser un vrai compte de démonstration fermerait ses sessions.
  const bodies: string[] = [];
  await page.route('**/api/accounts/*/reset-password', (route) => {
    bodies.push(route.request().postData() ?? '');
    return route.fulfill({ status: 200, json: { password: TEMPORARY } });
  });
  await page.goto('/#/comptes');
  await page
    .getByRole('button', {
      name: `Réinitialiser le mot de passe : ${DEMO_LOGINS.operator.username}`,
    })
    .first()
    .click();

  const step2 = page.getByRole('dialog', { name: 'Réinitialiser le mot de passe' });
  await expect(step2).toContainText(DEMO_LOGINS.operator.username);
  await expect(step2).toContainText('Ce motif sera inscrit au journal d’audit.');
  await step2.getByRole('button', { name: 'Réinitialiser' }).click();
  await expect(step2.getByText('Indiquez un motif pour continuer.')).toBeVisible();
  expect(bodies).toHaveLength(0);
  await step2
    .getByLabel('Motif de la réinitialisation (obligatoire)')
    .fill('Oubli du mot de passe');
  await step2.getByRole('button', { name: 'Réinitialiser' }).click();

  const step3 = page.getByRole('dialog', { name: 'Mot de passe temporaire' });
  const password = step3.getByLabel('Mot de passe temporaire');
  await expect(password).toHaveText(TEMPORARY);
  await expect(password).toBeFocused();
  expect(JSON.parse(bodies[0]!)).toEqual({ reason: 'Oubli du mot de passe' });

  await step3.getByRole('button', { name: 'Copier' }).click();
  await expect(step3.getByRole('button', { name: 'Copié' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TEMPORARY);

  // La boîte reste ouverte tant que la case n'est pas cochée.
  await page.keyboard.press('Escape');
  await step3.getByRole('button', { name: 'Terminer' }).click({ force: true });
  await expect(step3).toBeVisible();
  await step3.getByLabel('J’ai transmis le mot de passe').check();
  await step3.getByRole('button', { name: 'Terminer' }).click();
  await expect(step3).toBeHidden();

  // Le mot de passe n'est ni dans la page, ni dans l'URL, ni dans le stockage local.
  await expect(page.getByText(TEMPORARY)).toHaveCount(0);
  expect(page.url()).not.toContain(TEMPORARY);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
    TEMPORARY,
  );
});

test('administration : la boîte « Créer un compte » s’annule, signale un identifiant pris, puis crée le compte', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!, 'admin');
  await page.goto('/#/comptes');
  const open = page.getByRole('button', { name: /Créer un compte/ });
  const dialog = page.getByRole('dialog', { name: 'Créer un compte' });
  const NEW_LOGIN = 'compte-e2e-boite';

  // Annuler ferme la boîte sans rien créer.
  await open.click();
  await dialog.getByLabel('Identifiant').fill(NEW_LOGIN);
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: NEW_LOGIN })).toHaveCount(0);

  // Identifiant déjà pris : la boîte reste ouverte avec l'erreur du serveur.
  await open.click();
  await dialog.getByLabel('Identifiant').fill(DEMO_LOGINS.operator.username);
  await dialog
    .getByRole('textbox', { name: /Mot de passe temporaire/ })
    .fill('mot-de-passe-e2e-12345');
  await dialog.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog).toBeVisible();

  // Correction : la boîte se ferme et le compte apparaît dans le tableau.
  await dialog.getByLabel('Identifiant').fill(NEW_LOGIN);
  await dialog.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: NEW_LOGIN }).first()).toBeVisible();
});
