import { createAtlasInstance, type AtlasInstanceConfig } from '@wisecom/atlas-sdk';
import type { M365Config, StorageConfig } from './config.js';
import type { Executeur, ExecutionTarget } from './plan-scheduler.js';

/** Ce que l'exécuteur lit d'un résultat du SDK : l'interruption et la santé du résumé. */
export interface MailOutcome {
  readonly interrupted: boolean;
  readonly summary: { readonly folderErrors: readonly unknown[] };
}
/** OneDrive et SharePoint : `healthy` est faux si une erreur a été rencontrée. */
export interface DriveOutcome {
  readonly interrupted: boolean;
  readonly summary: { readonly healthy: boolean };
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

function check(outcomes: readonly BackupOutcome[]): void {
  for (const outcome of outcomes) {
    if (outcome.interrupted) throw new BackupRunError('interrupted');
    const { summary } = outcome;
    const unhealthy = 'healthy' in summary ? !summary.healthy : summary.folderErrors.length > 0;
    if (unhealthy) throw new BackupRunError('backup_errors');
  }
}

/**
 * Exécuteur réel (ADR 0009) : un site est sauvegardé par `sharepoint.backup` ; un propriétaire par
 * `outlook.backup` puis `onedrive.backup`. Les deux charges sont tentées même si la première
 * échoue ; la première erreur est ensuite relancée. Le SDK choisit seul entre sauvegarde complète
 * (première exécution) et incrémentale (suivantes) : `forceFull` n'est jamais passé. Une
 * exécution interrompue ou avec des erreurs de dossier est un échec.
 */
export class AtlasExecuteur implements Executeur {
  constructor(private readonly options: AtlasExecuteurOptions) {}

  async execute(target: ExecutionTarget): Promise<void> {
    const { api, isSite } = this.options;
    if (await isSite(target.itemId)) {
      check(await api.sharepoint.backup(target.itemId));
      return;
    }
    const steps = [
      () => api.outlook.backup(target.itemId),
      () => api.onedrive.backup(target.itemId),
    ];
    let failure: unknown;
    for (const step of steps) {
      try {
        check([await step()]);
      } catch (err) {
        failure ??= err;
      }
    }
    if (failure !== undefined) throw failure;
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
