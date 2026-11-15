/** Rôles des comptes locaux (voir docs/adr/0008-comptes-locaux-et-sessions.md). */
export type Role = 'admin' | 'operator';

export interface User {
  username: string;
  role: Role;
  /** Mot de passe provisoire : à changer avant toute autre action. */
  mustChangePassword?: boolean;
}

export interface SessionInfo {
  csrfToken: string;
  user: User;
}

/** Ce que l'interface doit afficher avant l'application. */
export type Gate =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'setup' }
  | { status: 'login' }
  | { status: 'ready'; session: SessionInfo };

export type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Identifiant ou mot de passe incorrect.',
  too_many_attempts: 'Trop de tentatives. Réessayez dans quelques instants.',
  password_too_short: 'Le mot de passe doit comporter au moins 12 caractères.',
  password_too_long: 'Le mot de passe ne doit pas dépasser 256 caractères.',
  invalid_password: 'Mot de passe invalide.',
  same_password: 'Le nouveau mot de passe doit être différent de l’ancien.',
  wrong_password: 'Le mot de passe actuel est incorrect.',
  already_configured: 'Un administrateur existe déjà : connectez-vous.',
  username_taken: 'Cet identifiant est déjà utilisé.',
  last_admin: 'Impossible : c’est le dernier administrateur actif.',
  audit_unavailable: 'Journal d’audit indisponible : action refusée.',
  auth_unavailable: 'Base des comptes indisponible.',
  bad_request:
    'Saisie invalide : 3 à 64 caractères (lettres, chiffres, . _ @ -) pour l’identifiant.',
};

/** Console injoignable (réseau coupé ou serveur arrêté). */
export const UNREACHABLE = 'Impossible de joindre la console. Réessayez.';
/** Rappel affiché au bas des écrans de connexion et de comptes (information des personnes). */
export const AUDIT_NOTICE =
  'Les connexions et les modifications de comptes sont inscrites au journal d’audit.';

/** Page des comptes ouverte par un opérateur. */
export const ADMIN_ONLY = 'Cette page est réservée aux administrateurs.';
/** Récapitulatif affiché après la création du premier administrateur. */
export const setupRecap = (username: string): string =>
  `Compte « ${username} », rôle administrateur. Ses actions sont inscrites au journal d’audit.`;

/** Écran de connexion après un 401 d'une requête alors qu'une session existait. */
export const SESSION_EXPIRED = 'Votre session a expiré. Reconnectez-vous.';
/** Écran de connexion après un refus CSRF (jeton absent ou périmé). */
export const SESSION_INVALID = 'Votre session n’est plus valide. Reconnectez-vous.';

/** Message en français pour une réponse d'erreur de l'API. */
export async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: unknown;
    retryAfterSec?: unknown;
  } | null;
  const code = typeof body?.error === 'string' ? body.error : '';
  if (code === 'too_many_attempts' && typeof body?.retryAfterSec === 'number') {
    return `Trop de tentatives. Réessayez dans ${body.retryAfterSec} secondes.`;
  }
  return MESSAGES[code] ?? `Erreur inattendue (HTTP ${res.status}).`;
}

const json = (payload: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

/** Session en cours, ou écran de premier démarrage ou de connexion. */
export async function loadGate(fetchFn: typeof fetch = fetch): Promise<Gate> {
  const me = await fetchFn('/api/auth/me');
  if (me.ok) return { status: 'ready', session: (await me.json()) as SessionInfo };
  if (me.status !== 401) return { status: 'error' };
  const setup = await fetchFn('/api/auth/setup-status');
  if (!setup.ok) return { status: 'error' };
  const { needsSetup } = (await setup.json()) as { needsSetup: boolean };
  return { status: needsSetup ? 'setup' : 'login' };
}

/** Connexion (`login`) ou création du premier administrateur (`setup`). */
export async function authenticate(
  kind: 'login' | 'setup',
  username: string,
  password: string,
  fetchFn: typeof fetch = fetch,
): Promise<Outcome<SessionInfo>> {
  const res = await fetchFn(`/api/auth/${kind}`, json({ username, password }));
  if (!res.ok) return { ok: false, message: await errorMessage(res) };
  return { ok: true, value: (await res.json()) as SessionInfo };
}

export async function logout(fetchFn: typeof fetch = fetch): Promise<void> {
  await fetchFn('/api/auth/logout', { method: 'POST' });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  fetchFn: typeof fetch = fetch,
): Promise<Outcome<null>> {
  const res = await fetchFn('/api/auth/password', json({ currentPassword, newPassword }));
  return res.ok ? { ok: true, value: null } : { ok: false, message: await errorMessage(res) };
}

/**
 * `fetch` qui joint le jeton CSRF aux requêtes qui modifient l'état et signale une session
 * expirée (401 hors connexion) : l'interface revient alors à l'écran de connexion.
 */
export function withSession(
  base: typeof fetch,
  getToken: () => string | null,
  onExpired: (reason: SessionLoss) => void,
): typeof fetch {
  return async (input, init) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const token = getToken();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
    if (token && !['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('x-csrf-token', token);
    const res = await base(input, { ...init, headers });
    const url = input instanceof Request ? input.url : String(input);
    if (res.status === 401 && !/\/api\/auth\/(login|setup|me|logout)/.test(url))
      onExpired('expired');
    if (res.status === 403) {
      const body = (await res
        .clone()
        .json()
        .catch(() => null)) as { error?: unknown } | null;
      if (body?.error === 'csrf_invalid') onExpired('invalid');
    }
    return res;
  };
}

/** Perte de la session : `expired` (401), `invalid` (refus CSRF). */
export type SessionLoss = 'expired' | 'invalid';

/** Message de l'écran de connexion pour une session perdue. */
export const lossMessage = (loss: SessionLoss): string =>
  loss === 'expired' ? SESSION_EXPIRED : SESSION_INVALID;

/** Ancre de l'écran de connexion ; elle remplace la page demandée le temps de la connexion. */
export const LOGIN_HASH = '#/connexion';

/**
 * Page à rouvrir après la connexion : l'ancre demandée si c'est une page de la console, sinon
 * rien (on garde l'ancre déjà mémorisée, et l'accueil par défaut).
 */
export const requestedPage = (hash: string): string | null =>
  hash.startsWith('#/') && hash !== LOGIN_HASH ? hash : null;

let csrfToken: string | null = null;
let expiredListener: (reason: SessionLoss) => void = () => undefined;

export const setCsrfToken = (token: string | null): void => {
  csrfToken = token;
};
export const onSessionExpired = (listener: (reason: SessionLoss) => void): void => {
  expiredListener = listener;
};

/** À appeler une fois au démarrage : tous les `fetch` de l'interface passent par la session. */
export function installSessionFetch(): void {
  window.fetch = withSession(
    window.fetch.bind(window),
    () => csrfToken,
    (reason) => {
      expiredListener(reason);
    },
  );
}
