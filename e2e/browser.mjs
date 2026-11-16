import { DEMO_LOGINS } from './demo-server.mjs';

/**
 * Options de lancement de Chromium. `BACKUP365_CHROMIUM` désigne un exécutable déjà installé
 * (conteneurs des agents) ; sans elle, Playwright utilise le sien (`playwright install chromium`).
 */
export function launchOptions(env = process.env) {
  const executablePath = env['BACKUP365_CHROMIUM'];
  return {
    args: ['--disable-dev-shm-usage'],
    ...(executablePath ? { executablePath } : {}),
  };
}

/** Ouvre une session de démonstration dans ce contexte de navigateur (cookie posé). */
export async function signInAs(context, baseURL, role) {
  const res = await context.request.post(`${baseURL}/api/auth/login`, { data: DEMO_LOGINS[role] });
  if (!res.ok()) throw new Error(`Connexion de démonstration refusée (${res.status()})`);
}
