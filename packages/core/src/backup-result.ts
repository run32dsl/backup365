/**
 * Résultat d'une sauvegarde lancée par la console (issue #439). Le manifeste d'un instantané ne
 * dit rien des erreurs partielles ; seul le retour de `backup()` les porte. La console enregistre
 * donc, pour chaque sauvegarde qu'elle lance, un résultat et deux nombres, jamais un nom de
 * dossier ni un message.
 */
export const BACKUP_RESULTS = ['success', 'warnings', 'failed'] as const;
/** `success` : « Réussie » ; `warnings` : « Avec avertissements » ; `failed` : « En échec ». */
export type BackupResult = (typeof BACKUP_RESULTS)[number];

/** Ce que le catalogue de la console enregistre pour une sauvegarde. */
export interface BackupResultRecord {
  result: BackupResult;
  folderErrorCount: number;
  warningCount: number;
}

/** Ce que la console retient d'un retour de `backup()` : des nombres et un fait, rien d'autre. */
export interface BackupReport {
  folderErrorCount: number;
  warningCount: number;
  /** Faux si le moteur dit n'avoir produit aucun instantané. */
  snapshotProduced: boolean;
}

/**
 * Classe une sauvegarde d'après les retours de `backup()` (un par charge ou par site).
 * « En échec » si `backup()` a levé une erreur ou si aucun instantané n'a été produit (aucun
 * retour, ou un retour sans instantané) ; « Avec avertissements » si au moins une erreur de
 * dossier ou un avertissement ; « Réussie » sinon. Les nombres sont la somme des retours.
 */
export function classifyBackup(run: {
  threw: boolean;
  reports: readonly BackupReport[];
}): BackupResultRecord {
  const folderErrorCount = run.reports.reduce((n, r) => n + r.folderErrorCount, 0);
  const warningCount = run.reports.reduce((n, r) => n + r.warningCount, 0);
  const failed =
    run.threw || run.reports.length === 0 || run.reports.some((r) => !r.snapshotProduced);
  const result: BackupResult = failed
    ? 'failed'
    : folderErrorCount + warningCount > 0
      ? 'warnings'
      : 'success';
  return { result, folderErrorCount, warningCount };
}

/**
 * Résultat enregistré d'un instantané, ou `unknown` s'il n'y en a pas (instantané que la console
 * n'a pas lancé, exécution antérieure) ou s'il est illisible. Jamais une valeur déduite.
 */
export function recordedBackupResult(
  record: { result?: unknown } | null | undefined,
): BackupResult | 'unknown' {
  const result = record?.result;
  return BACKUP_RESULTS.find((r) => r === result) ?? 'unknown';
}
