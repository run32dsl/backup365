import { describe, expect, it } from 'vitest';
import { confirmRowsOf as oneDriveRows } from './onedrive.js';
import { confirmRowsOf as sharePointRows } from './sharepoint.js';
import { RESTORE_LABELS } from './restoreLabels.js';

describe('shared restore labels', () => {
  it('feeds both summaries from the same constants', () => {
    const od = oneDriveRows({
      account: 'compte@exemple.test',
      name: 'budget.xlsx',
      mode: 'copy',
      backupAt: '2026-11-14T09:00:00.000Z',
      versionAt: null,
      folderLabel: 'la racine',
      copyName: '',
      reason: 'Reprise',
    }).map(([l]) => l);
    const sp = sharePointRows({
      scope: 'library',
      siteName: 'Site (exemple)',
      path: '/Documents partagés',
      pointAt: '2026-11-14T09:00:00.000Z',
      summary: null,
      reason: 'Reprise',
    }).map(([l]) => l);
    for (const label of [RESTORE_LABELS.item, RESTORE_LABELS.backupAt]) {
      expect(od).toContain(label);
      expect(sp).toContain(label);
    }
    expect(RESTORE_LABELS.itemRestored).toBe('Élément restauré');
    expect(RESTORE_LABELS.backupDate).toBe('Date de la sauvegarde (UTC)');
  });
});
