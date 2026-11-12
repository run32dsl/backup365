import { SqliteSearchIndex } from './sqlite-search-index.js';

export type OpenedSearchIndex =
  { index: SqliteSearchIndex; error?: undefined } | { index?: undefined; error: Error };

/**
 * Ouvre l'index de recherche sans jamais lever : si le dossier de données est inutilisable
 * (lecture seule, volume absent), le serveur démarre quand même et `/api/search` répond 503.
 */
export function tryOpenSearchIndex(path: string): OpenedSearchIndex {
  try {
    return { index: SqliteSearchIndex.open(path) };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}
