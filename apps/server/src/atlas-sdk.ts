import { createAtlasInstance, type AtlasInstanceConfig } from '@wisecom/atlas-sdk';
import { AtlasSdkCatalog, type AtlasCatalogOptions, type AtlasSdkReader } from './atlas-catalog.js';
import { AtlasSdkMailContentReader, type AtlasMessageReader } from './atlas-mail-content.js';
import type { StorageConfig } from './config.js';

/**
 * Valeurs factices pour `clientId` et `clientSecret` : le SDK les exige non vides, mais le mode
 * lecture seule ne contacte jamais Graph (docs/adr/0002). Ce ne sont pas des identifiants.
 */
export const NO_GRAPH_CLIENT_ID = 'backup365-read-only-no-graph';
export const NO_GRAPH_CLIENT_SECRET = 'backup365-read-only-no-graph';

/** Instance du SDK réduite à ce que la console lit, plus de quoi la libérer. */
export interface AtlasHandle extends AtlasSdkReader {
  outlook: AtlasSdkReader['outlook'] & AtlasMessageReader['outlook'];
  dispose(): Promise<void>;
}

/** Fabrique d'instance, remplaçable dans les tests pour éviter tout appel réseau. */
export type AtlasFactory = (config: AtlasInstanceConfig) => AtlasHandle;

/** Traduit la configuration de la console en configuration du SDK, sans identifiant Graph. */
export function toAtlasConfig(storage: StorageConfig): AtlasInstanceConfig {
  return {
    tenantId: storage.tenantId,
    clientId: NO_GRAPH_CLIENT_ID,
    clientSecret: NO_GRAPH_CLIENT_SECRET,
    s3Endpoint: storage.endpoint,
    s3Region: storage.region,
    s3AccessKey: storage.accessKeyId,
    s3SecretKey: storage.secretAccessKey,
    encryptionPassphrase: storage.encryptionPassphrase,
  };
}

/**
 * Construit le catalogue réel. N'appelle jamais `validate()` (qui exige Graph) ; la première
 * lecture révèle un stockage ou une phrase erronés, en 503.
 */
export function createAtlasCatalog(
  storage: StorageConfig,
  factory: AtlasFactory = createAtlasInstance,
  options: AtlasCatalogOptions = {},
): {
  catalog: AtlasSdkCatalog;
  content: AtlasSdkMailContentReader;
  dispose: () => Promise<void>;
} {
  const atlas = factory(toAtlasConfig(storage));
  return {
    catalog: new AtlasSdkCatalog(atlas, options),
    content: new AtlasSdkMailContentReader(atlas),
    dispose: () => atlas.dispose(),
  };
}
