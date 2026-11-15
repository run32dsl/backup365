import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type Migration } from './migrations.js';

/**
 * Ouvre (et crée au besoin) une base SQLite et applique ses migrations ; `:memory:` pour les
 * tests. Seul endroit à connaître les droits de fichier et les PRAGMA communs aux adaptateurs.
 */
export function openDatabase(path: string, migrations: readonly Migration[]): DatabaseSync {
  if (path !== ':memory:') {
    // La base contient des données personnelles : dossier 0700, fichier 0600 (WAL/SHM en héritent).
    const folder = dirname(path);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    // `mode` ne s'applique pas à un dossier déjà créé avec un umask permissif.
    chmodSync(folder, 0o700);
    closeSync(openSync(path, 'a', 0o600));
    chmodSync(path, 0o600);
  }
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
    migrate(db, migrations);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}
