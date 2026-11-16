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
    /Connexion impossible pour le moment\. Nouvel essai possible dans 00:0\d\./,
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
  await page.getByLabel('Compte').selectOption({ label: DEMO_LOGINS.operator.username });
  await page.getByRole('button', { name: 'Réinitialiser le mot de passe' }).click();

  const step2 = page.getByRole('dialog', { name: 'Réinitialiser le mot de passe' });
  await expect(step2).toContainText(DEMO_LOGINS.operator.username);
  await expect(step2).toContainText('Cette action sera journalisée (sans le mot de passe).');
  await step2.getByRole('button', { name: 'Réinitialiser' }).click();
  await expect(step2.getByText('Indiquez un motif.')).toBeVisible();
  expect(bodies).toHaveLength(0);
  await step2.getByLabel('Motif (obligatoire)').fill('Oubli du mot de passe');
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
