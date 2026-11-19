import { describe, expect, it } from 'vitest';
import {
  copyNameOf,
  listFolderOf,
  normalizeDrivePath,
  parentOf,
  type DriveManifestEntry,
} from './drive.js';

const row = (
  parentPath: string,
  fileName: string,
  over: Partial<DriveManifestEntry> = {},
): DriveManifestEntry => ({
  parentPath,
  fileName,
  sizeBytes: 10,
  backupAt: '2026-11-14T02:10:00.000Z',
  changeType: 'created',
  ...over,
});

describe('normalizeDrivePath', () => {
  it('canonicalises, strips the Graph prefix and refuses traversal and control characters', () => {
    expect(normalizeDrivePath('/Documents/Budget/')).toBe('/Documents/Budget');
    expect(normalizeDrivePath('/drive/root:/Documents')).toBe('/Documents');
    expect(normalizeDrivePath('/drive/root:')).toBe('/');
    expect(normalizeDrivePath('')).toBe('/');
    expect(normalizeDrivePath('Documents')).toBeNull();
    expect(normalizeDrivePath('/a/../b')).toBeNull();
    expect(normalizeDrivePath('/a\\b')).toBeNull();
    expect(normalizeDrivePath('/a\nb')).toBeNull();
    expect(normalizeDrivePath(42)).toBeNull();
    expect(normalizeDrivePath(`/${'a'.repeat(1100)}`)).toBeNull();
  });
});

describe('copyNameOf', () => {
  const at = new Date('2026-11-14T23:30:00Z');
  it('suffixes before the extension, without slashes', () => {
    expect(copyNameOf('budget.xlsx', 'file', at)).toBe('budget (restauré le 14.11.2026).xlsx');
    expect(copyNameOf('archive.tar.gz', 'file', at)).toBe(
      'archive.tar (restauré le 14.11.2026).gz',
    );
    expect(copyNameOf('.profil', 'file', at)).toBe('.profil (restauré le 14.11.2026)');
    expect(copyNameOf('2025.bak', 'folder', at)).toBe('2025.bak (restauré le 14.11.2026)');
  });
});

describe('listFolderOf', () => {
  const entries = [
    row('/Documents', 'notes.docx'),
    row('/Documents/Budget', 'budget.xlsx', { lastModifiedAt: '2026-11-13T22:04:00.000Z' }),
    row('/Documents/Budget/2025', 'old.xlsx', { lastModifiedAt: '2026-11-10T08:00:00.000Z' }),
    row('/Documents/Budget/2025', 'gone.xlsx', { changeType: 'deleted' }),
    row('/drive/root:', 'racine.txt'),
  ];
  it('lists direct files and derived sub-folders, folders first, without deleted items', () => {
    expect(listFolderOf(entries, '/Documents/Budget').map((e) => [e.kind, e.name])).toEqual([
      ['folder', '2025'],
      ['file', 'budget.xlsx'],
    ]);
    const root = listFolderOf(entries, '/');
    expect(root.map((e) => e.name)).toEqual(['Documents', 'racine.txt']);
    expect(root[0]).toMatchObject({ path: '/Documents', versionAt: '2026-11-14T02:10:00.000Z' });
  });
  it('does not confuse a folder with a sibling sharing its prefix', () => {
    expect(listFolderOf([row('/Budget2', 'a.txt')], '/Budget')).toEqual([]);
    expect(parentOf('/a/b')).toBe('/a');
    expect(parentOf('/a')).toBe('/');
  });
});
