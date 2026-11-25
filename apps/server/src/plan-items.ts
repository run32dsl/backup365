import { DATA_TYPES, chargeScope, type DataType, type PlanScope } from '@backup365/core';
import { errorCode } from './plan-scheduler.js';

export interface PlanItemsCatalog {
  listMailboxes(): Promise<readonly { id: string }[]>;
  listSites(): Promise<readonly { id: string }[]>;
}

/** Propriétaire du tenant ; `mailOnly` : boîte partagée, sans OneDrive à sauvegarder. */
export interface TenantOwner {
  id: string;
  mailOnly?: boolean;
}

/**
 * Annuaire du tenant (Graph, via l'instance de sauvegarde du SDK) : les boîtes et les sites qui
 * existent aujourd'hui, sauvegardés ou non. C'est lui qui fait entrer un nouveau compte dans un
 * plan « tout le tenant » sans modifier le plan (issue #545).
 */
export interface TenantDirectory {
  listOwners(): Promise<readonly TenantOwner[]>;
  listSites(): Promise<readonly { id: string }[]>;
}

/** Un élément à sauvegarder et les charges du plan qui le visent. */
export interface PlanTarget {
  itemId: string;
  dataTypes: DataType[];
  /** Connu quand l'élément vient de l'annuaire ou du catalogue ; absent pour une sélection. */
  kind?: 'owner' | 'site';
  /** Pris parce qu'une charge couvre tout le tenant (pas choisi un par un). */
  discovered: boolean;
}

/** Éléments d'un plan ; `degraded` : l'annuaire n'a pas répondu, le catalogue l'a remplacé. */
export type PlanItems = PlanTarget[] & { degraded?: boolean };

export interface PlanItemsSources {
  catalog?: PlanItemsCatalog | undefined;
  directory?: TenantDirectory | undefined;
  /** L'annuaire n'a pas répondu : on retombe sur le catalogue (code seulement). */
  onDirectoryError?: (code: string) => void;
}

type PlanShape = {
  scope: PlanScope;
  selection: readonly string[];
  dataTypes: readonly DataType[];
  selectionTypes?: readonly DataType[] | undefined;
};

const OWNER_TYPES: readonly DataType[] = ['mail', 'onedrive'];

/**
 * Éléments d'un plan. Une charge limitée à la sélection vise les éléments choisis ; une charge
 * « tout » vise tout ce que l'annuaire du tenant connaît à cet instant (boîtes pour la messagerie
 * et OneDrive, sites pour SharePoint), donc aussi ce qui est apparu depuis la création du plan.
 * Sans annuaire (démo, tests) ou s'il échoue, le catalogue des sauvegardes le remplace : il ne
 * connaît que ce qui a déjà été sauvegardé.
 */
export async function listPlanItems(
  plan: PlanShape,
  sources: PlanItemsSources = {},
): Promise<PlanItems> {
  const scoped = (scope: PlanScope) => plan.dataTypes.filter((t) => chargeScope(plan, t) === scope);
  const limited = scoped('selection');
  const all = scoped('all');
  const targets = new Map<
    string,
    { types: Set<DataType>; kind?: 'owner' | 'site'; discovered: boolean }
  >();
  if (limited.length > 0) {
    for (const id of plan.selection)
      targets.set(id, { types: new Set(limited), discovered: false });
  }
  const add = (ids: readonly TenantOwner[], types: DataType[], kind: 'owner' | 'site') => {
    for (const { id, mailOnly } of ids) {
      const wanted = mailOnly ? types.filter((t) => t === 'mail') : types;
      if (wanted.length === 0) continue;
      const entry = targets.get(id) ?? { types: new Set<DataType>(), discovered: true };
      for (const t of wanted) entry.types.add(t);
      entry.kind = kind;
      targets.set(id, entry);
    }
  };
  let degraded = false;
  const list = async (what: 'owners' | 'sites') => {
    const found = await fromDirectory(sources, what);
    degraded ||= found.degraded;
    return found.items;
  };
  const ownerTypes = all.filter((t) => OWNER_TYPES.includes(t));
  if (ownerTypes.length > 0) add(await list('owners'), ownerTypes, 'owner');
  if (all.includes('sharepoint')) add(await list('sites'), ['sharepoint'], 'site');
  const items: PlanItems = [...targets].map(([itemId, entry]) => ({
    itemId,
    dataTypes: DATA_TYPES.filter((t) => entry.types.has(t)),
    ...(entry.kind && { kind: entry.kind }),
    discovered: entry.discovered,
  }));
  if (degraded) items.degraded = true;
  return items;
}

async function fromDirectory(
  { catalog, directory, onDirectoryError }: PlanItemsSources,
  what: 'owners' | 'sites',
): Promise<{ items: readonly TenantOwner[]; degraded: boolean }> {
  if (directory) {
    try {
      const items = await (what === 'owners' ? directory.listOwners() : directory.listSites());
      return { items, degraded: false };
    } catch (err) {
      onDirectoryError?.(errorCode(err));
    }
  }
  const items = (await (what === 'owners' ? catalog?.listMailboxes() : catalog?.listSites())) ?? [];
  return { items, degraded: directory !== undefined };
}
