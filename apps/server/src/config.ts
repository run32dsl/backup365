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
