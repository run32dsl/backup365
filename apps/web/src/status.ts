import type { StatusReport } from '@backup365/core';

/** Le stockage répond mais aucune sauvegarde Atlas n'a encore eu lieu. */
export class NoBackupError extends Error {}

/** Interroge `/api/status` ; lève une erreur si la réponse n'est pas en 2xx. */
export async function fetchStatus(fetchFn: typeof fetch = fetch): Promise<StatusReport> {
  const res = await fetchFn('/api/status');
  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (body?.error === 'no_backup_found') throw new NoBackupError('no_backup_found');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as StatusReport;
}
