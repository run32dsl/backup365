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

export const resetPassword = (id: number, password: string, fetchFn: typeof fetch = fetch) =>
  send(fetchFn, 'POST', `/api/accounts/${id}/reset-password`, { password });
