import { DEFAULT_MAX_AGE_HOURS, WORKLOADS, isWorkload, type Workload } from '@backup365/core';

/** Lit un port TCP (entier de 1 à 65535) ; lève une erreur explicite sinon. */
export function parsePort(raw: string | undefined, fallback = 3000): number {
  if (raw === undefined || raw === '') return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT invalide : attendu un entier entre 1 et 65535');
  }
  return port;
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** Lit un niveau de journal Pino ; lève une erreur explicite sinon. */
export function parseLogLevel(raw: string | undefined, fallback = 'info'): string {
  if (raw === undefined || raw === '') return fallback;
  if (!LOG_LEVELS.includes(raw)) {
    throw new Error(`LOG_LEVEL invalide : attendu ${LOG_LEVELS.join(', ')}`);
  }
  return raw;
}

/** Seuil d'alerte du tableau de bord, en heures (`BACKUP365_STATUS_MAX_AGE_HOURS`, 26 par défaut). */
export function parseMaxAgeHours(
  raw: string | undefined,
  fallback = DEFAULT_MAX_AGE_HOURS,
): number {
  if (raw === undefined || raw === '') return fallback;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 8760) {
    throw new Error('BACKUP365_STATUS_MAX_AGE_HOURS invalide : attendu un nombre de 0 à 8760');
  }
  return hours;
}

/**
 * Durée de validité du recensement des sites SharePoint, en millisecondes
 * (`BACKUP365_CATALOG_CACHE_MINUTES`, 60 minutes par défaut, de 1 à 1440 minutes entières).
 */
export function parseSiteCacheTtlMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 3_600_000;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error('BACKUP365_CATALOG_CACHE_MINUTES invalide : attendu un entier de 1 à 1440');
  }
  return minutes * 60_000;
}

/**
 * Charges suivies par le tableau de bord (`BACKUP365_STATUS_WORKLOADS`, liste séparée par des
 * virgules). Par défaut les charges que l'adaptateur sait lire : `mail`, `onedrive` (ADR 0002)
 * et `sharepoint` (ADR 0006).
 */
export function parseStatusWorkloads(
  raw: string | undefined,
  fallback: readonly Workload[] = ['mail', 'onedrive', 'sharepoint'],
): Workload[] {
  if (raw === undefined || raw.trim() === '') return [...fallback];
  const names = raw.split(',').map((name) => name.trim());
  const workloads = names.filter(isWorkload);
  if (workloads.length !== names.length) {
    throw new Error(`BACKUP365_STATUS_WORKLOADS invalide : attendu ${WORKLOADS.join(', ')}`);
  }
  return [...new Set(workloads)];
}

/** Dossier des données de l'application (base de recherche…), `./data` par défaut. */
export function parseDataDir(raw: string | undefined, fallback = './data'): string {
  return raw === undefined || raw === '' ? fallback : raw;
}

export interface StorageConfig {
  /** Tenant Microsoft 365 : le SDK en dérive le bucket (`atlas-<tenantId>`). */
  tenantId: string;
  /** URL absolue http(s) du stockage S3, exigée par le SDK. */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Phrase de chiffrement des sauvegardes (14 octets au moins). Ne doit jamais être journalisée. */
  encryptionPassphrase: string;
}

const STORAGE_REQUIRED = [
  'BACKUP365_TENANT_ID',
  'BACKUP365_S3_ENDPOINT',
  'BACKUP365_S3_ACCESS_KEY_ID',
  'BACKUP365_S3_SECRET_ACCESS_KEY',
  'BACKUP365_ENCRYPTION_PASSPHRASE',
] as const;

/** Variables de stockage qui acceptent une variante `<NOM>_FILE` (secret monté en fichier). */
const SECRET_FILE_TARGETS = [
  'BACKUP365_S3_ACCESS_KEY_ID',
  'BACKUP365_S3_SECRET_ACCESS_KEY',
  'BACKUP365_ENCRYPTION_PASSPHRASE',
] as const;

/**
 * Complète l'environnement avec les secrets montés en fichiers : `<NOM>_FILE` désigne un fichier
 * dont le contenu (sans fin de ligne finale) devient `<NOM>`. `<NOM>` et `<NOM>_FILE` ensemble
 * sont refusés. Les erreurs nomment la variable, jamais le chemin ni le contenu.
 */
export function withSecretFiles(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string,
): Record<string, string | undefined> {
  const result = { ...env };
  for (const name of SECRET_FILE_TARGETS) {
    const path = env[`${name}_FILE`];
    if (!path) continue;
    if (env[name]) throw new Error(`${name} et ${name}_FILE sont exclusifs`);
    let content: string;
    try {
      content = readFile(path);
    } catch {
      throw new Error(`${name}_FILE illisible`);
    }
    result[name] = content.replace(/\r?\n$/, '');
  }
  return result;
}

/**
 * Lit la configuration du stockage S3 d'Atlas. Renvoie `undefined` si aucune variable n'est
 * définie (console sans catalogue) ; lève une erreur qui nomme les variables manquantes si la
 * configuration est partielle. Aucune valeur n'apparaît dans les messages.
 */
export function parseStorageConfig(
  env: Record<string, string | undefined>,
): StorageConfig | undefined {
  const given = (name: string): string | undefined => (env[name] ? env[name] : undefined);
  const names = [...STORAGE_REQUIRED, 'BACKUP365_S3_REGION'];
  if (names.every((name) => !given(name))) return undefined;
  const missing = STORAGE_REQUIRED.filter((name) => !given(name));
  if (missing.length > 0) {
    throw new Error(`Configuration du stockage incomplète : ${missing.join(', ')} manquant(s)`);
  }
  return {
    tenantId: given('BACKUP365_TENANT_ID')!,
    endpoint: given('BACKUP365_S3_ENDPOINT')!,
    region: given('BACKUP365_S3_REGION') ?? 'eu-west-3',
    accessKeyId: given('BACKUP365_S3_ACCESS_KEY_ID')!,
    secretAccessKey: given('BACKUP365_S3_SECRET_ACCESS_KEY')!,
    encryptionPassphrase: given('BACKUP365_ENCRYPTION_PASSPHRASE')!,
  };
}
