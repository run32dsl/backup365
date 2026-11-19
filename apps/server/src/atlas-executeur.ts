import { createAtlasInstance, type AtlasInstanceConfig } from '@wisecom/atlas-sdk';
import type { DataType } from '@backup365/core';
import type { M365Config, StorageConfig } from './config.js';
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

/** Ce que l'exécuteur appelle du SDK : les trois sauvegardes, plus de quoi libérer l'instance. */
export interface AtlasBackupApi {
  outlook: { backup(mailboxId: string): Promise<MailOutcome> };
  onedrive: { backup(ownerId: string): Promise<DriveOutcome> };
  sharepoint: { backup(siteId: string): Promise<readonly DriveOutcome[]> };
  dispose(): Promise<void>;
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
    if (await isSite(target.itemId)) {
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
