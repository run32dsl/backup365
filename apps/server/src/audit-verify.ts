import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AuditLog } from '@backup365/core';
import {
  ANCHOR_FILE,
  checkAnchors,
  readAnchors,
  resolveAnchorConfig,
  type AnchorHead,
} from './audit-anchor.js';
import { parseDataDir, withSecretFiles } from './config.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';

/**
 * Vérifie la chaîne puis, si `anchors` est donné, les ancres externes. Renvoie le code de sortie :
 * 0 intact, 1 altéré (chaîne ou ancres). Écrit sur `out`.
 */
export async function runAuditVerify(
  log: AuditLog & AnchorHead,
  out: (line: string) => void = console.log,
  anchors?: { dir: string; key: Buffer },
): Promise<number> {
  const result = await log.verify();
  if (!result.ok) {
    out(`Journal d'audit ALTÉRÉ à l'entrée ${result.brokenAt} : ${result.reason}.`);
    return 1;
  }
  out(`Journal d'audit intact : ${result.entries} entrée(s) vérifiée(s).`);
  if (!anchors) return 0;
  // Journal vide et jamais ancré (installation neuve) : rien à comparer, pas un écart.
  if (log.head() === undefined && !existsSync(join(anchors.dir, ANCHOR_FILE))) {
    out("Ancres : aucune attendue, le journal d'audit est vide.");
    return 0;
  }
  const read = readAnchors(anchors.dir, anchors.key);
  const problem = read.anchors
    ? read.anchors.length === 0
      ? "fichier d'ancres vide (vidé ou jamais écrit)"
      : checkAnchors(log, read.anchors)
    : read.error;
  if (problem !== undefined || !read.anchors) {
    out(`Ancres du journal d'audit INCOHÉRENTES : ${problem}.`);
    return 1;
  }
  out(`Ancres vérifiées : ${read.anchors.length} ancre(s) cohérente(s) avec le journal.`);
  return 0;
}

/** Commande `pnpm --filter @backup365/server audit:verify` ; 2 si le journal est illisible. */
export async function main(env: Record<string, string | undefined>): Promise<number> {
  let log: SqliteAuditLog;
  let anchors: { dir: string; key: Buffer } | undefined;
  try {
    const dataDir = parseDataDir(env['BACKUP365_DATA_DIR']);
    const path = join(dataDir, 'audit.sqlite');
    // Ne jamais créer une base vide : un dossier mal configuré ne doit pas passer pour « intact ».
    if (!existsSync(path)) {
      console.error("Journal d'audit introuvable (ENOENT) : vérifier BACKUP365_DATA_DIR.");
      return 2;
    }
    const secrets = withSecretFiles(env, (p) => readFileSync(p, 'utf8'));
    const config = resolveAnchorConfig(
      env['BACKUP365_AUDIT_ANCHOR_DIR'],
      dataDir,
      secrets['BACKUP365_ENCRYPTION_PASSPHRASE'],
    );
    if (config.configured) anchors = { dir: config.dir, key: config.key };
    else
      console.warn(`Ancrage du journal : non configuré (${config.reason}), ancres non vérifiées.`);
    log = SqliteAuditLog.open(path);
  } catch (err) {
    // Le code d'erreur seul : le message peut contenir un chemin local.
    console.error(
      `Journal d'audit illisible (${(err as NodeJS.ErrnoException).code ?? 'erreur'}).`,
    );
    return 2;
  }
  try {
    return await runAuditVerify(log, console.log, anchors);
  } finally {
    log.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.env);
}
