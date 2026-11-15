import { createAtlasCatalog, type AtlasFactory } from './atlas-sdk.js';
import { parseSiteCacheTtlMs, parseStorageConfig } from './config.js';

export type AtlasStartup =
  | { status: 'unconfigured' }
  | { status: 'ready'; atlas: ReturnType<typeof createAtlasCatalog> }
  | { status: 'failed'; code: string | undefined; name: string | undefined };

/**
 * Prépare le catalogue réel d'après l'environnement. Une configuration partielle lève (l'erreur
 * nomme les variables, sans valeur). Si le SDK refuse la configuration, on ne retient que `code`
 * et `name` : son message peut contenir une valeur de configuration, phrase de chiffrement
 * comprise.
 */
export function startAtlas(env: NodeJS.ProcessEnv, factory?: AtlasFactory): AtlasStartup {
  const storage = parseStorageConfig(env);
  if (!storage) return { status: 'unconfigured' };
  const siteCacheTtlMs = parseSiteCacheTtlMs(env['BACKUP365_CATALOG_CACHE_MINUTES']);
  try {
    return { status: 'ready', atlas: createAtlasCatalog(storage, factory, { siteCacheTtlMs }) };
  } catch (err) {
    const { code, name } = err as { code?: unknown; name?: unknown };
    return {
      status: 'failed',
      code: typeof code === 'string' ? code : undefined,
      name: typeof name === 'string' ? name : undefined,
    };
  }
}
