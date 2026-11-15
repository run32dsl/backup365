import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDataDir } from './config.js';
import { USERNAME_PATTERN } from './auth-routes.js';
import { hashPassword, passwordProblem, type ScryptParams } from './password.js';
import { SqliteAccountStore, UsernameTakenError } from './sqlite/sqlite-account-store.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';

const USAGE =
  'Usage : node apps/server/dist/admin.js create-admin --username <nom> --password-stdin\n' +
  '(mot de passe lu sur l’entrée standard ; dossier de données : BACKUP365_DATA_DIR)';

export interface AdminIo {
  readStdin: () => string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Coût de `scrypt` ; réduit par les tests uniquement. */
  hashParams?: ScryptParams;
}

/**
 * Commande locale `create-admin` : crée un compte administrateur dans la base de la console, sans
 * route HTTP. Codes de sortie : 0 créé, 1 refusé (nom pris, nom ou mot de passe invalide),
 * 2 usage ou base illisible, 3 compte créé mais événement d'audit non écrit. Le mot de passe ne
 * vient que de l'entrée standard (ni argument, ni variable d'environnement).
 */
export async function main(
  argv: string[],
  env: Record<string, string | undefined>,
  io: AdminIo,
): Promise<number> {
  const [command, ...rest] = argv;
  const usernameAt = rest.indexOf('--username');
  const username = usernameAt >= 0 ? rest[usernameAt + 1] : undefined;
  if (
    command !== 'create-admin' ||
    username === undefined ||
    !rest.includes('--password-stdin') ||
    rest.length !== 3
  ) {
    io.err(USAGE);
    return 2;
  }
  if (!new RegExp(USERNAME_PATTERN).test(username)) {
    io.err('Nom invalide : 3 à 64 caractères parmi lettres, chiffres et . _ @ -');
    return 1;
  }
  const password = io.readStdin().replace(/\r?\n$/, '');
  const problem = passwordProblem(password);
  if (problem) {
    io.err(`Mot de passe refusé (${problem}) : de 12 à 256 caractères.`);
    return 1;
  }
  const dataDir = parseDataDir(env['BACKUP365_DATA_DIR']);
  let store: SqliteAccountStore;
  let audit: SqliteAuditLog;
  try {
    store = SqliteAccountStore.open(join(dataDir, 'accounts.sqlite'));
    audit = SqliteAuditLog.open(join(dataDir, 'audit.sqlite'));
  } catch (err) {
    // Le code d'erreur seul : le message peut contenir un chemin local.
    io.err(`Base illisible (${(err as NodeJS.ErrnoException).code ?? 'erreur'}).`);
    return 2;
  }
  try {
    const hash = await hashPassword(password, io.hashParams);
    try {
      store.create({ username, role: 'admin', passwordHash: hash });
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        io.err('Ce nom est déjà pris.');
        return 1;
      }
      throw err;
    }
    try {
      await audit.record({
        at: new Date().toISOString(),
        actor: 'cli',
        action: 'account.create',
        resource: 'account',
        target: username,
        reason: 'role:admin',
      });
    } catch {
      io.err('Compte créé, mais l’événement d’audit n’a pas pu être écrit.');
      return 3;
    }
    io.out(`Administrateur « ${username} » créé.`);
    return 0;
  } finally {
    store.close();
    audit.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env, {
    readStdin: () => readFileSync(0, 'utf8'),
    out: console.log,
    err: console.error,
  });
}
