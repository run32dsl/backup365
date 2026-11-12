import { SqliteAuditLog } from './sqlite-audit-log.js';

export type OpenedAuditLog =
  { audit: SqliteAuditLog; error?: undefined } | { audit?: undefined; error: Error };

/**
 * Ouvre le journal d'audit sans jamais lever : s'il est inutilisable, le serveur démarre quand
 * même et les routes qui renvoient des éléments sauvegardés répondent 503 (aucun accès sans trace).
 */
export function tryOpenAuditLog(path: string): OpenedAuditLog {
  try {
    return { audit: SqliteAuditLog.open(path) };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}
