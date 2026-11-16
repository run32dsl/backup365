import { describe, expect, it } from 'vitest';
import {
  isPathOfScope,
  listSiteFolderOf,
  summarizeSite,
  type SiteManifestEntry,
} from './sharepoint.js';

const row = (
  libraryName: string | undefined,
  parentPath: string,
  fileName: string,
  over: Partial<SiteManifestEntry> = {},
): SiteManifestEntry => ({
  libraryName,
  parentPath,
  fileName,
  sizeBytes: 100,
  backupAt: '2026-11-14T02:10:00.000Z',
  changeType: 'created',
  ...over,
});

const manifest = [
  row('Documents partagés', '/Plans 2024', 'plan-a.pdf'),
  row('Documents partagés', '/Plans 2024', 'plan-b.pdf'),
  row('Documents partagés', '/', 'accueil.docx'),
  row('Archives', '/2023', 'rapport.pdf', { sizeBytes: 900 }),
  row('Archives', '/2023', 'gone.pdf', { changeType: 'deleted' }),
  row(undefined, '/', 'sans-bibliotheque.txt'),
];

describe('listSiteFolderOf', () => {
  it('lists the libraries at the root, deleted items hidden, a default library when unnamed', () => {
    expect(listSiteFolderOf(manifest, '/').map((e) => [e.kind, e.name])).toEqual([
      ['library', 'Archives'],
      ['library', 'Documents'],
      ['library', 'Documents partagés'],
    ]);
  });

  it('lists folders then files inside a library', () => {
    expect(listSiteFolderOf(manifest, '/Documents partagés').map((e) => [e.kind, e.name])).toEqual([
      ['folder', 'Plans 2024'],
      ['file', 'accueil.docx'],
    ]);
    expect(listSiteFolderOf(manifest, '/Documents partagés/Plans 2024').map((e) => e.path)).toEqual(
      ['/Documents partagés/Plans 2024/plan-a.pdf', '/Documents partagés/Plans 2024/plan-b.pdf'],
    );
  });
});

describe('summarizeSite', () => {
  it('counts the files under a path, the whole site for the root, never deleted ones', () => {
    expect(summarizeSite(manifest, '/')).toEqual({ items: 5, sizeBytes: 1_300 });
    expect(summarizeSite(manifest, '/Archives')).toEqual({ items: 1, sizeBytes: 900 });
    expect(summarizeSite(manifest, '/Documents partagés/Plans 2024')).toEqual({
      items: 2,
      sizeBytes: 200,
    });
    expect(summarizeSite(manifest, '/Documents partagés/Plans 2024/plan-a.pdf').items).toBe(1);
    // Un préfixe de nom n'est pas un dossier parent.
    expect(summarizeSite(manifest, '/Documents partagés/Plans').items).toBe(0);
  });
});

describe('isPathOfScope', () => {
  it('ties each granularity to its depth', () => {
    expect(isPathOfScope('site', '/')).toBe(true);
    expect(isPathOfScope('site', '/Archives')).toBe(false);
    expect(isPathOfScope('library', '/Archives')).toBe(true);
    expect(isPathOfScope('library', '/')).toBe(false);
    expect(isPathOfScope('library', '/Archives/2023')).toBe(false);
    expect(isPathOfScope('folder', '/Archives/2023')).toBe(true);
    expect(isPathOfScope('folder', '/Archives')).toBe(false);
    expect(isPathOfScope('item', '/Archives/2023/rapport.pdf')).toBe(true);
    expect(isPathOfScope('item', '/')).toBe(false);
  });
});
