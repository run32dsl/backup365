import { errorMessage, type Outcome, type Role } from './session.js';

export interface AccountInfo {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  operator: 'Opérateur',
};

/** Ce que permet chaque rôle (texte de la maquette de #22). */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'gère les comptes, les plans et les restaurations.',
  operator: 'consulte, exporte et restaure, avec un motif.',
};

/** Textes d'état de l'écran des comptes. */
export const NO_OPERATOR = 'Aucun opérateur pour l’instant.';
export const LAST_ADMIN_NOTICE = 'Dernier administrateur : ce compte ne peut pas être désactivé.';

/** Vrai pour l'unique administrateur actif : ni désactivation ni changement de rôle possibles. */
export function isLastAdmin(accounts: AccountInfo[], account: AccountInfo): boolean {
  return (
    account.role === 'admin' &&
    !account.disabled &&
    accounts.filter((a) => a.role === 'admin' && !a.disabled).length === 1
  );
}

/** Liste des comptes (administrateur seulement). Lève une erreur si la réponse n'est pas en 2xx. */
export async function fetchAccounts(fetchFn: typeof fetch = fetch): Promise<AccountInfo[]> {
  const res = await fetchFn('/api/accounts');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { items: AccountInfo[] }).items;
}

async function send(
  fetchFn: typeof fetch,
  method: 'POST' | 'PATCH',
  url: string,
  payload: object,
): Promise<Outcome<null>> {
  const res = await fetchFn(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok ? { ok: true, value: null } : { ok: false, message: await errorMessage(res) };
}

export const createAccount = (
  username: string,
  password: string,
  role: Role,
  fetchFn: typeof fetch = fetch,
) => send(fetchFn, 'POST', '/api/accounts', { username, password, role });

export const updateAccount = (
  id: number,
  patch: { role?: Role; disabled?: boolean },
  fetchFn: typeof fetch = fetch,
) => send(fetchFn, 'PATCH', `/api/accounts/${id}`, patch);

/**
 * Réinitialise un mot de passe : le serveur en génère un temporaire et le rend ici, une seule
 * fois. La valeur ne doit être ni journalisée ni stockée.
 */
export async function resetPassword(
  id: number,
  reason: string,
  fetchFn: typeof fetch = fetch,
): Promise<Outcome<string>> {
  const res = await fetchFn(`/api/accounts/${id}/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) return { ok: false, message: await errorMessage(res) };
  return { ok: true, value: ((await res.json()) as { password: string }).password };
}

/** Textes de la réinitialisation (maquette de #56). */
export const RESET_TEXTS = {
  title: 'Réinitialiser le mot de passe',
  reasonLabel: 'Motif (obligatoire)',
  reasonMissing: 'Indiquez un motif.',
  audit: 'Cette action sera journalisée (sans le mot de passe).',
  resultTitle: 'Mot de passe temporaire',
  once: 'Affiché une seule fois. Il ne pourra plus être consulté.',
  copyFailed: 'Copie impossible. Sélectionnez le mot de passe et copiez-le manuellement.',
  handed: 'J’ai transmis le mot de passe',
} as const;
