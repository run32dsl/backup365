import type { StatusReport } from '@backup365/core';

/** Interroge `/api/status` ; lève une erreur si la réponse n'est pas en 2xx. */
export async function fetchStatus(fetchFn: typeof fetch = fetch): Promise<StatusReport> {
  const res = await fetchFn('/api/status');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as StatusReport;
}
