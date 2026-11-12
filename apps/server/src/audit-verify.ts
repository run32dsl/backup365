import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AuditLog } from '@backup365/core';
import { parseDataDir } from './config.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';

/** Vérifie la chaîne et renvoie le code de sortie : 0 intacte, 1 altérée. Écrit sur `out`. */
export async function runAuditVerify(
  log: AuditLog,
  out: (line: string) => void = console.log,
): Promise<number> {
  const result = await log.verify();
  if (result.ok) {
    out(`Journal d'audit intact : ${result.entries} entrée(s) vérifiée(s).`);
    return 0;
  }
  out(`Journal d'audit ALTÉRÉ à l'entrée ${result.brokenAt} : ${result.reason}.`);
  return 1;
}

/** Commande `pnpm --filter @backup365/server audit:verify` ; 2 si le journal est illisible. */
export async function main(env: Record<string, string | undefined>): Promise<number> {
  let log: SqliteAuditLog;
  try {
    const path = join(parseDataDir(env['BACKUP365_DATA_DIR']), 'audit.sqlite');
    // Ne jamais créer une base vide : un dossier mal configuré ne doit pas passer pour « intact ».
    if (!existsSync(path)) {
      console.error("Journal d'audit introuvable (ENOENT) : vérifier BACKUP365_DATA_DIR.");
      return 2;
    }
    log = SqliteAuditLog.open(path);
  } catch (err) {
    // Le code d'erreur seul : le message peut contenir un chemin local.
    console.error(
      `Journal d'audit illisible (${(err as NodeJS.ErrnoException).code ?? 'erreur'}).`,
    );
    return 2;
  }
  try {
    return await runAuditVerify(log);
  } finally {
    log.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.env);
}
