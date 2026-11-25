import type { DriveSnapshot, SiteEntry, SiteScope, SiteScopeSummary } from '@backup365/core';
import { API_ERRORS } from '../apiError.js';
import type { Loaded } from '../onedrive.js';
import { UNREACHABLE } from '../session.js';
import { SHAREPOINT_MESSAGES as T, type Site, type SiteJob } from './model.js';

const SERVER_MESSAGES: Record<string, string> = {
  reason_required: T.reasonError,
  forbidden: T.forbidden,
  admin_required: T.forbidden,
  confirmation_mismatch: T.nameError,
  restore_in_progress: T.alreadyRunning,
  audit_unavailable: T.auditUnavailable,
  item_not_found: T.notInBackup,
  empty_scope: T.emptyScope,
};

async function load<T>(
  url: string,
  pick: (body: never) => T,
  fetchFn: typeof fetch,
): Promise<Loaded<T>> {
  try {
    const res = await fetchFn(url);
    if (res.ok) return { status: 'ok', data: pick((await res.json()) as never) };
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (res.status === 503 && body?.error === 'catalog_unavailable')
      return { status: 'unconfigured' };
    if (res.status === 503 && body?.error === 'no_backup_found') return { status: 'no_backup' };
    return { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

const site = (id: string): string => `/api/sharepoint/${encodeURIComponent(id)}`;

export function fetchSites(fetchFn: typeof fetch = fetch): Promise<Loaded<Site[]>> {
  return load('/api/sharepoint/sites', (b: { sites: Site[] }) => b.sites, fetchFn);
}

export function fetchSiteSnapshots(
  siteId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Loaded<DriveSnapshot[]>> {
  return load(
    `${site(siteId)}/snapshots`,
    (b: { snapshots: DriveSnapshot[] }) => b.snapshots,
    fetchFn,
  );
}

export function fetchSiteEntries(
  siteId: string,
  snapshotId: string,
  path: string,
  fetchFn: typeof fetch = fetch,
): Promise<Loaded<SiteEntry[]>> {
  const query = new URLSearchParams({ snapshot: snapshotId, path });
  return load(
    `${site(siteId)}/items?${query.toString()}`,
    (b: { entries: SiteEntry[] }) => b.entries,
    fetchFn,
  );
}

export function fetchScope(
  siteId: string,
  snapshotId: string,
  path: string,
  fetchFn: typeof fetch = fetch,
): Promise<Loaded<SiteScopeSummary>> {
  const query = new URLSearchParams({ snapshot: snapshotId, path });
  return load(
    `${site(siteId)}/scope?${query.toString()}`,
    (b: SiteScopeSummary) => ({ items: b.items, sizeBytes: b.sizeBytes }),
    fetchFn,
  );
}

/** La restauration est-elle configurée ? En cas d'erreur : oui, le serveur tranchera. */
export async function fetchSiteRestoreConfigured(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn('/api/sharepoint/status');
    if (!res.ok) return true;
    return ((await res.json()) as { configured: boolean }).configured;
  } catch {
    return true;
  }
}

/** Dernière restauration du site ; lève si la réponse n'est pas en 2xx. */
export async function fetchLastSiteJob(
  siteId: string,
  fetchFn: typeof fetch = fetch,
): Promise<SiteJob | null> {
  const res = await fetchFn(`${site(siteId)}/restore`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { last: SiteJob | null }).last;
}

export interface SiteRestoreInput {
  snapshotId: string;
  scope: SiteScope;
  path: string;
  reason: string;
  confirmName?: string | undefined;
}

export type SiteRestoreResult =
  { ok: true; job: SiteJob } | { ok: false; message: string; requestId?: string };

/** Lance la restauration. `message` est en français, sans détail technique. */
export async function startSiteRestore(
  siteId: string,
  input: SiteRestoreInput,
  fetchFn: typeof fetch = fetch,
): Promise<SiteRestoreResult> {
  try {
    const res = await fetchFn(`${site(siteId)}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, reason: input.reason.trim() }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const code = typeof body?.error === 'string' ? body.error : '';
      const requestId = res.headers.get('x-request-id') ?? undefined;
      return {
        ok: false,
        message: SERVER_MESSAGES[code] ?? API_ERRORS[code] ?? T.generic,
        ...(requestId ? { requestId } : {}),
      };
    }
    return { ok: true, job: ((await res.json()) as { job: SiteJob }).job };
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}
