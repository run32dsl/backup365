import type { HealthResponse } from '@backup365/core';

export async function fetchHealth(fetchFn: typeof fetch = fetch): Promise<HealthResponse> {
  const res = await fetchFn('/api/health');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as HealthResponse;
}
