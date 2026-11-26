import { createAtlasInstance, type AtlasInstanceConfig } from '@wisecom/atlas-sdk';
import type { DataType } from '@backup365/core';
import type { M365Config, StorageConfig } from './config.js';
import type { Executeur, ExecutionResult, ExecutionTarget } from './plan-scheduler.js';

/**
 * Ce que l'exécuteur lit d'un résultat du SDK : l'interruption, la santé du résumé et, pour
 * l'historique, les éléments copiés (`stored`) et la taille de la boîte (`manifest`).
 */
export interface MailOutcome {
  readonly interrupted: boolean;
  readonly summary: { readonly folderErrors: readonly unknown[]; readonly stored?: number };
  readonly manifest?: { readonly totalSizeBytes?: number } | undefined;
}
/** OneDrive, SharePoint, contacts et agenda : `healthy` est faux si une erreur a été rencontrée. */
export interface DriveOutcome {
  readonly interrupted: boolean;
  readonly summary: {
    readonly healthy: boolean;
    /** Présent quand une exécution saine n'a créé aucun point de restauration. */
    readonly noSnapshotReason?: string | undefined;
    readonly filesStored?: number;
  };
  /** Absent quand aucun point de restauration n'a été créé. */
  readonly snapshot?: { readonly totalSizeBytes?: number } | undefined;
}
type BackupOutcome = MailOutcome | DriveOutcome;

/** Ce que l'exécuteur appelle du SDK : les cinq sauvegardes, plus de quoi libérer l'instance. */
export interface AtlasBackupApi {
  outlook: { backup(mailboxId: string): Promise<MailOutcome> };
  contacts: { backup(mailboxId: string): Promise<DriveOutcome> };
  calendar: { backup(mailboxId: string): Promise<DriveOutcome> };
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

/** Somme des valeurs fournies ; `undefined` si le moteur n'en a fourni aucune. */
function sum(values: readonly (number | undefined)[]): number | undefined {
  const known = values.filter((v): v is number => typeof v === 'number');
  return known.length === 0 ? undefined : known.reduce((a, b) => a + b, 0);
}

/** Éléments copiés et taille source des résultats réussis, quand le SDK les donne. */
function volumeOf(outcomes: readonly BackupOutcome[]): ExecutionResult {
  const isDrive = (o: BackupOutcome): o is DriveOutcome => 'healthy' in o.summary;
  const itemsSaved = sum(
    outcomes.map((o) => (isDrive(o) ? o.summary.filesStored : o.summary.stored)),
  );
  const sourceBytes = sum(
    outcomes.map((o) => (isDrive(o) ? o.snapshot?.totalSizeBytes : o.manifest?.totalSizeBytes)),
  );
  return {
    ...(itemsSaved !== undefined ? { itemsSaved } : {}),
    ...(sourceBytes !== undefined ? { sourceBytes } : {}),
  };
}

/**
 * Exécuteur réel (ADR 0009) : un site est sauvegardé par `sharepoint.backup` ; un propriétaire par
 * `outlook.backup`, `contacts.backup`, `calendar.backup` puis `onedrive.backup`, chacun seulement
 * si le plan protège cette charge. Les charges voulues sont tentées même si la première échoue ; la première erreur
 * est ensuite relancée. Le SDK choisit seul entre sauvegarde complète (première exécution) et
 * incrémentale (suivantes) : `forceFull` n'est jamais passé. Une exécution interrompue ou avec des
 * erreurs de dossier est un échec.
 */
export class AtlasExecuteur implements Executeur {
  constructor(private readonly options: AtlasExecuteurOptions) {}

  async execute(target: ExecutionTarget): Promise<ExecutionResult> {
    const { api, isSite } = this.options;
    const wanted = (type: DataType): boolean => target.dataTypes.includes(type);
    if (await isSite(target.itemId)) {
      // Un site n'est sauvegardé que si le plan protège SharePoint : rien à faire sinon.
      if (!wanted('sharepoint')) return NO_CONTENT;
      const outcomes = await api.sharepoint.backup(target.itemId);
      return { ...(check(outcomes) ? NO_CONTENT : {}), ...volumeOf(outcomes) };
    }
    const steps: (() => Promise<BackupOutcome>)[] = [];
    if (wanted('mail')) steps.push(() => api.outlook.backup(target.itemId));
    if (wanted('contacts')) steps.push(() => api.contacts.backup(target.itemId));
    if (wanted('calendar')) steps.push(() => api.calendar.backup(target.itemId));
    if (wanted('onedrive')) steps.push(() => api.onedrive.backup(target.itemId));
    let failure: unknown;
    let empty = true;
    const done: BackupOutcome[] = [];
    for (const step of steps) {
      try {
        const outcome = await step();
        empty = check([outcome]) && empty;
        done.push(outcome);
      } catch (err) {
        failure ??= err;
      }
    }
    if (failure !== undefined) throw failure;
    return { ...(empty ? NO_CONTENT : {}), ...volumeOf(done) };
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
