import { API_ERRORS, fallbackMessage } from './apiError.js';

/** Rôles des comptes locaux (voir docs/adr/0008-comptes-locaux-et-sessions.md). */
export type Role = 'admin' | 'operator';

export interface User {
  username: string;
  role: Role;
  /** Mot de passe temporaire : à changer avant toute autre action. */
  mustChangePassword?: boolean;
  /** Connecté avec un compte Microsoft : pas de mot de passe local à changer. */
  oidc?: boolean;
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

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; retryAfterSec?: number; code?: string; requestId?: string };

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Identifiant ou mot de passe incorrect.',
  reason_required: 'Indiquez un motif.',
  too_many_attempts: 'Trop de tentatives. Réessayez dans quelques instants.',
  password_too_short: 'Le mot de passe doit comporter au moins 12 caractères.',
  password_too_long: 'Le mot de passe ne doit pas dépasser 256 caractères.',
  invalid_password: 'Mot de passe invalide.',
  same_password: 'Le nouveau mot de passe doit être différent de l’ancien.',
  wrong_password: 'Le mot de passe actuel est incorrect.',
  already_configured: 'Un administrateur existe déjà : connectez-vous.',
  username_taken: 'Cet identifiant est déjà utilisé.',
  last_admin: 'Impossible : c’est le dernier administrateur actif.',
  managed_by_oidc:
    'Ce compte Microsoft tient son rôle de ses groupes Entra : à modifier dans Entra ID.',
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
  `${username ? `Compte « ${username} », rôle` : 'Rôle'} administrateur. Ses actions sont inscrites au journal d’audit.`;

/** Écran de connexion après un 401 d'une requête alors qu'une session existait. */
export const SESSION_EXPIRED =
  'Votre session a expiré. Reconnectez-vous pour revenir à la page demandée.';
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
  return MESSAGES[code] ?? API_ERRORS[code] ?? fallbackMessage(res.status);
}

/** Échec d'une réponse d'erreur : le message en français et l'identifiant de requête. */
export async function failureOf(res: Response): Promise<{ message: string; requestId?: string }> {
  const requestId = res.headers.get('x-request-id') ?? undefined;
  return { message: await errorMessage(res), ...(requestId ? { requestId } : {}) };
}

/** Secondes avant un nouvel essai, d'après une réponse 429 (corps, sinon en-tête `Retry-After`). */
export async function retryAfterOf(res: Response): Promise<number | undefined> {
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { retryAfterSec?: unknown } | null;
  const sec =
    typeof body?.retryAfterSec === 'number'
      ? body.retryAfterSec
      : Number(res.headers.get('retry-after'));
  return Number.isFinite(sec) && sec > 0 ? Math.ceil(sec) : undefined;
}

/** Décompte « mm:ss » (« 04:32 »). */
export const formatCountdown = (seconds: number): string => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Message de verrouillage : identique que le compte existe ou non. */
export const lockedMessage = (seconds: number): string =>
  `Connexion impossible pour le moment. Nouvel essai possible dans ${formatCountdown(seconds)}.`;
/** Annoncé à la fin du décompte. */
export const RETRY_NOW = 'Vous pouvez réessayer.';

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
  if (!res.ok) {
    const retryAfterSec = res.status === 429 ? await retryAfterOf(res) : undefined;
    const requestId = res.headers.get('x-request-id') ?? undefined;
    return {
      ok: false,
      message: await errorMessage(res),
      ...(retryAfterSec ? { retryAfterSec } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }
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
  return res.ok ? { ok: true, value: null } : { ok: false, ...(await failureOf(res)) };
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

/** Connexion avec un compte Microsoft : lien de départ (le navigateur quitte la console). */
export const MICROSOFT_LOGIN_URL = '/api/auth/oidc/login';
export const MICROSOFT_LABEL = 'Se connecter avec un compte Microsoft';

const OIDC_MESSAGES: Record<string, string> = {
  no_group:
    'Ce compte Microsoft n’a pas accès à la console : il n’appartient à aucun groupe autorisé. Demandez à un administrateur.',
  disabled: 'Ce compte a été désactivé par un administrateur.',
  account_conflict: 'Un compte local porte déjà ce nom. Demandez à un administrateur.',
  invalid_request: 'La connexion Microsoft a expiré ou a été interrompue. Réessayez.',
  provider_error: 'Microsoft n’a pas confirmé la connexion. Réessayez.',
  invalid_token: 'La réponse de Microsoft n’a pas pu être vérifiée. Réessayez.',
  unavailable: 'Journal d’audit ou base des comptes indisponible : connexion refusée.',
};

/** Message de l'écran de connexion après un retour de Microsoft refusé (`?oidc_error=<code>`). */
export function oidcErrorMessage(search: string): string | undefined {
  const code = new URLSearchParams(search).get('oidc_error');
  return code === null ? undefined : (OIDC_MESSAGES[code] ?? 'La connexion Microsoft a échoué.');
}

/** La connexion Microsoft est-elle configurée ? Faux en cas d'erreur : seul le formulaire local reste. */
export async function loadOidcEnabled(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn('/api/auth/oidc/status');
    return res.ok && ((await res.json()) as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}
