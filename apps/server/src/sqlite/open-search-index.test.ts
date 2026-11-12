import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tryOpenSearchIndex } from './open-search-index.js';

describe('tryOpenSearchIndex', () => {
  it('returns the index when the database is usable', () => {
    const opened = tryOpenSearchIndex(':memory:');
    expect(opened.error).toBeUndefined();
    expect(opened.index).toBeDefined();
    opened.index?.close();
  });

  it('returns an error instead of throwing when the data folder is unusable', () => {
    const base = mkdtempSync(join(tmpdir(), 'b365-open-'));
    try {
      // Un fichier à la place du dossier : la création échoue quel que soit l'utilisateur.
      const file = join(base, 'fichier');
      writeFileSync(file, '');
      const opened = tryOpenSearchIndex(join(file, 'search.sqlite'));
      expect(opened.index).toBeUndefined();
      expect(opened.error).toBeInstanceOf(Error);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
