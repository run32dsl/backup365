import { createAtlasInstance, type AtlasInstanceConfig } from '@wisecom/atlas-sdk';
import type { DataType } from '@backup365/core';
import type { M365Config, StorageConfig } from './config.js';
import type { TenantDirectory } from './plan-items.js';
import type { Executeur, ExecutionResult, ExecutionTarget } from './plan-scheduler.js';

/** Ce que l'exécuteur lit d'un résultat du SDK : l'interruption et la santé du résumé. */
export interface MailOutcome {
  readonly interrupted: boolean;
  readonly summary: { readonly folderErrors: readonly unknown[] };
}
/** OneDrive et SharePoint : `healthy` est faux si une erreur a été rencontrée. */
export interface DriveOutcome {
  readonly interrupted: boolean;
  readonly summary: {
    readonly healthy: boolean;
    /** Présent quand une exécution saine n'a créé aucun point de restauration. */
    readonly noSnapshotReason?: string | undefined;
  };
}
type BackupOutcome = MailOutcome | DriveOutcome;

/** Boîte du tenant selon Graph : seuls les champs qui décident si elle se sauvegarde. */
export interface TenantMailbox {
  readonly userId: string;
  readonly hasExchangeLicense: boolean;
  readonly mailboxPurpose?: string | undefined;
}
/** Site du tenant selon Graph ; `file_storage_container` n'est pas un site à sauvegarder. */
export interface TenantSite {
  readonly siteId: string;
  readonly kind: string;
}

/**
 * Ce que l'exécuteur appelle du SDK : les trois sauvegardes, plus de quoi libérer l'instance. La
 * découverte (facultative ici pour les doubles de test) liste ce qui existe dans le tenant.
 */
export interface AtlasBackupApi {
  outlook: {
    backup(mailboxId: string): Promise<MailOutcome>;
    listAvailableMailboxes?(): Promise<readonly TenantMailbox[]>;
  };
  onedrive: { backup(ownerId: string): Promise<DriveOutcome> };
  sharepoint: {
    backup(siteId: string): Promise<readonly DriveOutcome[]>;
    listSites?(): Promise<readonly TenantSite[]>;
  };
  dispose(): Promise<void>;
}

/**
 * Annuaire du tenant tiré de l'instance de sauvegarde (identifiants Graph réels). Même règle que
 * la sauvegarde du tenant du SDK : une boîte se sauvegarde si elle a une licence Exchange ou si
 * c'est une boîte partagée ; les autres comptes sont ignorés. `undefined` si l'instance n'a pas
 * de découverte.
 */
export function tenantDirectory(api: AtlasBackupApi): TenantDirectory | undefined {
  const { listAvailableMailboxes } = api.outlook;
  const { listSites } = api.sharepoint;
  if (!listAvailableMailboxes || !listSites) return undefined;
  return {
    listOwners: async () =>
      (await listAvailableMailboxes.call(api.outlook))
        .filter((m) => m.hasExchangeLicense || m.mailboxPurpose === 'shared')
        // Une boîte partagée n'a pas de OneDrive : seule sa messagerie est sauvegardée.
        .map((m) => (m.hasExchangeLicense ? { id: m.userId } : { id: m.userId, mailOnly: true })),
    listSites: async () =>
      (await listSites.call(api.sharepoint))
        .filter((s) => s.kind === 'site')
        .map((s) => ({ id: s.siteId })),
  };
}

export type BackupFactory = (config: AtlasInstanceConfig) => AtlasBackupApi;

/** Instance du SDK avec les identifiants Graph réels, distincte de l'instance en lecture seule. */
export const createBackupInstance: BackupFactory = (config) => createAtlasInstance(config);

/** Erreur à code stable : le planificateur ne conserve que le code, jamais le message. */
export class BackupRunError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BackupRunError';
  }
}

export interface AtlasExecuteurOptions {
  api: AtlasBackupApi;
  /** `true` si l'élément est un site SharePoint sauvegardé ; sinon c'est un propriétaire (boîte). */
  isSite: (itemId: string) => Promise<boolean>;
}

/** Lève sur un échec ; rend `true` si aucun résultat n'a créé de point de restauration. */
function check(outcomes: readonly BackupOutcome[]): boolean {
  // Le SDK rend un résultat par site sauvegardé, racine en tête : aucun résultat veut dire que
  // rien n'a été sauvegardé, ce n'est pas un succès.
  if (outcomes.length === 0) throw new BackupRunError('no_result');
  for (const outcome of outcomes) {
    if (outcome.interrupted) throw new BackupRunError('interrupted');
    const { summary } = outcome;
    const unhealthy = 'healthy' in summary ? !summary.healthy : summary.folderErrors.length > 0;
    if (unhealthy) throw new BackupRunError('backup_errors');
  }
  // La messagerie ne dit pas pourquoi elle n'a pas de point : elle compte comme en ayant un.
  return outcomes.every(
    (o) => 'healthy' in o.summary && o.summary.noSnapshotReason === 'no_content',
  );
}

const NO_CONTENT: ExecutionResult = { noSnapshotReason: 'no_content' };

/**
 * Exécuteur réel (ADR 0009) : un site est sauvegardé par `sharepoint.backup` ; un propriétaire par
 * `outlook.backup` puis `onedrive.backup`, chacun seulement si le plan protège cette charge. Les
 * charges voulues sont tentées même si la première échoue ; la première erreur est ensuite relancée. Le SDK choisit seul entre sauvegarde complète
 * (première exécution) et incrémentale (suivantes) : `forceFull` n'est jamais passé. Une
 * exécution interrompue ou avec des erreurs de dossier est un échec.
 */
export class AtlasExecuteur implements Executeur {
  constructor(private readonly options: AtlasExecuteurOptions) {}

  async execute(target: ExecutionTarget): Promise<ExecutionResult> {
    const { api, isSite } = this.options;
    const wanted = (type: DataType): boolean => target.dataTypes.includes(type);
    // Un élément venu de l'annuaire porte sa nature ; un élément choisi se juge sur le catalogue.
    if (target.kind ? target.kind === 'site' : await isSite(target.itemId)) {
      // Un site n'est sauvegardé que si le plan protège SharePoint : rien à faire sinon.
      if (!wanted('sharepoint')) return NO_CONTENT;
      return check(await api.sharepoint.backup(target.itemId)) ? NO_CONTENT : {};
    }
    const steps: (() => Promise<BackupOutcome>)[] = [];
    if (wanted('mail')) steps.push(() => api.outlook.backup(target.itemId));
    if (wanted('onedrive')) steps.push(() => api.onedrive.backup(target.itemId));
    let failure: unknown;
    let empty = true;
    for (const step of steps) {
      try {
        empty = check([await step()]) && empty;
      } catch (err) {
        failure ??= err;
      }
    }
    if (failure !== undefined) throw failure;
    return empty ? NO_CONTENT : {};
  }
}

/** Configuration du SDK avec les identifiants Microsoft 365 (lus de l'environnement). */
export function toBackupConfig(storage: StorageConfig, m365: M365Config): AtlasInstanceConfig {
  return {
    tenantId: storage.tenantId,
    clientId: m365.clientId,
    clientSecret: m365.clientSecret,
    s3Endpoint: storage.endpoint,
    s3Region: storage.region,
    s3AccessKey: storage.accessKeyId,
    s3SecretKey: storage.secretAccessKey,
    encryptionPassphrase: storage.encryptionPassphrase,
  };
}
