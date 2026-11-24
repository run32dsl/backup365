import type { DataType } from '@backup365/core';

export interface PlanItemsCatalog {
  listMailboxes(): Promise<readonly { id: string }[]>;
  listSites(): Promise<readonly { id: string }[]>;
}

/**
 * Éléments d'un plan : la sélection telle quelle, ou pour « toute l'organisation » les boîtes
 * (messagerie, OneDrive) et les sites (SharePoint) selon les charges choisies. Un site jamais
 * sauvegardé n'est pas connu du catalogue : il n'est pas listé.
 */
export async function listPlanItems(
  plan: { scope: 'all' | 'selection'; selection: string[]; dataTypes: readonly DataType[] },
  catalog: PlanItemsCatalog | undefined,
): Promise<string[]> {
  if (plan.scope === 'selection') return plan.selection;
  const withMailboxes = plan.dataTypes.some((t) => t === 'mail' || t === 'onedrive');
  const mailboxes = withMailboxes ? await catalog?.listMailboxes() : [];
  const sites = plan.dataTypes.includes('sharepoint') ? await catalog?.listSites() : [];
  return [...(mailboxes ?? []), ...(sites ?? [])].map((x) => x.id);
}
