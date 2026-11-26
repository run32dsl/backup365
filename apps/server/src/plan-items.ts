import type { DataType } from '@backup365/core';

export interface PlanItemsCatalog {
  listMailboxes(): Promise<readonly { id: string }[]>;
  listSites(): Promise<readonly { id: string }[]>;
  /** Équipes Teams à sauvegarder ; absent si on ne sait pas les lister (aucune équipe). */
  listTeams?(): Promise<readonly { id: string }[]>;
}

/**
 * Préfixe d'un élément de plan qui désigne une équipe : l'exécuteur le reconnaît sans appel au
 * catalogue, et un identifiant d'équipe ne se confond pas avec celui d'une boîte (docs/adr/0022).
 */
export const TEAM_ITEM_PREFIX = 'teams:';

/** Identifiant de l'équipe d'un élément de plan ; `undefined` si l'élément n'est pas une équipe. */
export function teamOfItem(itemId: string): string | undefined {
  return itemId.startsWith(TEAM_ITEM_PREFIX) ? itemId.slice(TEAM_ITEM_PREFIX.length) : undefined;
}

/**
 * Élément mis à la place des équipes quand on n'a pas pu les lister (autorisations Teams non
 * accordées, Graph injoignable) : l'exécuteur le fait échouer, l'échec se voit dans Activités, et
 * les boîtes et les sites du même plan sont sauvegardés quand même.
 */
export const TEAMS_UNLISTED_ITEM = TEAM_ITEM_PREFIX;

async function teamItemsOf(catalog: PlanItemsCatalog | undefined): Promise<string[]> {
  if (!catalog?.listTeams) return [];
  try {
    return (await catalog.listTeams()).map((t) => TEAM_ITEM_PREFIX + t.id);
  } catch {
    return [TEAMS_UNLISTED_ITEM];
  }
}

/**
 * Éléments d'un plan : la sélection telle quelle, ou pour « toute l'organisation » les boîtes
 * (messagerie, contacts, agenda, OneDrive) et les sites (SharePoint) selon les charges choisies. Un site jamais
 * sauvegardé n'est pas connu du catalogue : il n'est pas listé. Teams couvre toujours toutes les
 * équipes de l'organisation, quel que soit le périmètre : la sélection ne propose pas d'équipe.
 */
export async function listPlanItems(
  plan: { scope: 'all' | 'selection'; selection: string[]; dataTypes: readonly DataType[] },
  catalog: PlanItemsCatalog | undefined,
): Promise<string[]> {
  const teamItems = plan.dataTypes.includes('teams') ? await teamItemsOf(catalog) : [];
  if (plan.scope === 'selection') return [...plan.selection, ...teamItems];
  const withMailboxes = plan.dataTypes.some((t) => t !== 'sharepoint' && t !== 'teams');
  const mailboxes = withMailboxes ? await catalog?.listMailboxes() : [];
  const sites = plan.dataTypes.includes('sharepoint') ? await catalog?.listSites() : [];
  return [...[...(mailboxes ?? []), ...(sites ?? [])].map((x) => x.id), ...teamItems];
}
