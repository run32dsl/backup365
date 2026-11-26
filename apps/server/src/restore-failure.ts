/**
 * Échec d'une restauration, commun à la messagerie, OneDrive et SharePoint : liste fermée, jamais
 * le code ni le message du SDK.
 * - `restore_error` : l'appel a abouti mais n'a rien restauré, ou avec des erreurs, ou Atlas a
 *   refusé avant d'écrire (`ATLAS_WRITE_REFUSED`, `ATLAS_FORMAT_UNSUPPORTED`) ;
 * - `restore_busy` : une autre opération tient la source (`ATLAS_OWNER_BUSY`, SDK 7.2.0) ; refusée
 *   avant toute écriture ;
 * - `restore_denied` : Microsoft 365 refuse l'accès (`ATLAS_ACCESS_REFUSED`, `ATLAS_AUTH_DENIED`) ;
 * - `restore_storage` : le stockage ne répond pas (`ATLAS_STORAGE_UNAVAILABLE`) ;
 * - `restore_unreachable` : toute autre erreur, délai dépassé compris.
 */
export type RestoreFailure =
  'restore_error' | 'restore_busy' | 'restore_denied' | 'restore_storage' | 'restore_unreachable';

/** Échec d'une restauration d'après l'erreur levée : seul le `code` du SDK fait contrat. */
export function restoreFailureOf(err: unknown): RestoreFailure {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'ATLAS_OWNER_BUSY') return 'restore_busy';
  if (code === 'ATLAS_ACCESS_REFUSED' || code === 'ATLAS_AUTH_DENIED') return 'restore_denied';
  if (code === 'ATLAS_STORAGE_UNAVAILABLE') return 'restore_storage';
  // Refus d'Atlas avant d'écrire (format trop récent, métadonnée invalide) : la source n'est pas
  // injoignable, la restauration a échoué.
  if (code === 'ATLAS_WRITE_REFUSED' || code === 'ATLAS_FORMAT_UNSUPPORTED') return 'restore_error';
  return 'restore_unreachable';
}
