import { DEMO_LOGINS } from './demo-server.mjs';

/** Langue du navigateur des captures et des tests, sauf demande contraire. */
export const DEFAULT_LANG = 'fr-FR';

/**
 * Langue demandée par `--lang=<balise>` (ex. `pnpm run captures --lang=en-US`), sinon par
 * `BACKUP365_LANG`, sinon `undefined`. Une balise mal formée est refusée plutôt qu'ignorée : une
 * capture prise dans la mauvaise langue ne prouverait rien.
 *
 * @param {string[]} argv arguments de la ligne de commande
 * @param {Record<string, string | undefined>} env
 * @returns {string | undefined}
 */
export function requestedLang(argv = process.argv.slice(2), env = process.env) {
  const arg = argv.find((a) => a.startsWith('--lang='));
  const lang = arg ? arg.slice('--lang='.length) : env['BACKUP365_LANG'] || undefined;
  if (lang !== undefined && !/^[a-z]{2,3}(-[A-Z]{2})?$/u.test(lang)) {
    throw new Error(`Langue attendue sous la forme fr-FR ou en-US, reçu « ${lang} »`);
  }
  return lang;
}

/**
 * Options de lancement de Chromium. `BACKUP365_CHROMIUM` désigne un exécutable déjà installé
 * (conteneurs des agents) ; sans elle, Playwright utilise le sien (`playwright install chromium`).
 * `lang` lance le navigateur dans cette langue (`--lang`), celle des champs natifs.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} [lang]
 */
export function launchOptions(env = process.env, lang = env['BACKUP365_LANG'] || undefined) {
  const executablePath = env['BACKUP365_CHROMIUM'];
  return {
    args: ['--disable-dev-shm-usage', ...(lang ? [`--lang=${lang}`] : [])],
    ...(executablePath ? { executablePath } : {}),
  };
}

/** Ouvre une session de démonstration dans ce contexte de navigateur (cookie posé). */
export async function signInAs(context, baseURL, role) {
  const res = await context.request.post(`${baseURL}/api/auth/login`, { data: DEMO_LOGINS[role] });
  if (!res.ok()) throw new Error(`Connexion de démonstration refusée (${res.status()})`);
}
