import { isIP } from 'node:net';
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

/** Intervalle d'indexation, en millisecondes (`BACKUP365_INDEX_INTERVAL_MINUTES`, 60 par défaut). */
export function parseIndexIntervalMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 3_600_000;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error('BACKUP365_INDEX_INTERVAL_MINUTES invalide : attendu un entier de 1 à 1440');
  }
  return minutes * 60_000;
}

/**
 * `BACKUP365_TRUST_PROXY=<adresses>` : adresses IP ou plages CIDR (séparées par des virgules) des
 * proxys inverses que l'on maîtrise devant la console. `X-Forwarded-Proto` (cookie `Secure`) et
 * `X-Forwarded-For` (anti-force brute) ne sont crus que si la connexion vient de l'un d'eux, et
 * l'adresse cliente est la première non fiable en remontant la chaîne : le client ne choisit pas
 * la sienne. Défaut (`false`) : ces en-têtes sont ignorés. `true` et un nombre de sauts sont
 * refusés (le premier ferait confiance à tout le monde, donc à une adresse forgée).
 */
export function parseTrustProxy(raw: string | undefined): string | false {
  if (raw === undefined || raw === '' || raw === 'false') return false;
  const entries = raw.split(',').map((entry) => entry.trim());
  const valid = entries.every((entry) => {
    const [address, prefix, ...rest] = entry.split('/');
    const family = isIP(address ?? '');
    if (family === 0 || rest.length > 0) return false;
    if (prefix === undefined) return true;
    return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
  });
  if (!valid) {
    throw new Error(
      'BACKUP365_TRUST_PROXY invalide : attendu false ou des adresses IP ou plages CIDR de proxys',
    );
  }
  return entries.join(',');
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
  'BACKUP365_M365_CLIENT_SECRET',
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

export interface M365Config {
  /** Application Entra (identifiant du client) autorisée à lire le tenant pour la sauvegarde. */
  clientId: string;
  /** Secret de l'application. Ne doit jamais être journalisé, stocké ni renvoyé par l'API. */
  clientSecret: string;
}

/**
 * Identifiants Microsoft 365 de la sauvegarde (`BACKUP365_M365_CLIENT_ID`,
 * `BACKUP365_M365_CLIENT_SECRET` ou `BACKUP365_M365_CLIENT_SECRET_FILE`). Renvoie `undefined` si
 * aucune n'est définie (sauvegarde non configurée) ; lève une erreur qui nomme la variable
 * manquante si une seule des deux est donnée. Aucune valeur n'apparaît dans les messages.
 */
export function parseM365Config(env: Record<string, string | undefined>): M365Config | undefined {
  const clientId = env['BACKUP365_M365_CLIENT_ID'] || undefined;
  const clientSecret = env['BACKUP365_M365_CLIENT_SECRET'] || undefined;
  if (!clientId && !clientSecret) return undefined;
  const missing = [
    ...(clientId ? [] : ['BACKUP365_M365_CLIENT_ID']),
    ...(clientSecret ? [] : ['BACKUP365_M365_CLIENT_SECRET']),
  ];
  if (missing.length > 0) {
    throw new Error(`Identifiants Microsoft 365 incomplets : ${missing.join(', ')} manquant(s)`);
  }
  return { clientId: clientId!, clientSecret: clientSecret! };
}
