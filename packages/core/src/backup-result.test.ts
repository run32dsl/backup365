import { describe, expect, it } from 'vitest';
import { classifyBackup, recordedBackupResult } from './backup-result.js';

const clean = { folderErrorCount: 0, warningCount: 0, snapshotProduced: true };

describe('classifyBackup', () => {
  it('« Réussie » : un instantané, ni erreur de dossier ni avertissement', () => {
    expect(classifyBackup({ threw: false, reports: [clean, clean] })).toEqual({
      result: 'success',
      folderErrorCount: 0,
      warningCount: 0,
    });
  });

  it('« Avec avertissements » : au moins une erreur de dossier ou un avertissement, sommés', () => {
    const run = {
      threw: false,
      reports: [clean, { folderErrorCount: 2, warningCount: 1, snapshotProduced: true }],
    };
    expect(classifyBackup(run)).toEqual({
      result: 'warnings',
      folderErrorCount: 2,
      warningCount: 1,
    });
    const onlyWarning = { folderErrorCount: 0, warningCount: 3, snapshotProduced: true };
    expect(classifyBackup({ threw: false, reports: [onlyWarning] }).result).toBe('warnings');
  });

  it('« En échec » : backup() a levé une erreur, ou aucun instantané n’a été produit', () => {
    expect(classifyBackup({ threw: true, reports: [clean] })).toEqual({
      result: 'failed',
      folderErrorCount: 0,
      warningCount: 0,
    });
    expect(classifyBackup({ threw: false, reports: [] }).result).toBe('failed');
    const none = { folderErrorCount: 1, warningCount: 0, snapshotProduced: false };
    expect(classifyBackup({ threw: false, reports: [clean, none] })).toEqual({
      result: 'failed',
      folderErrorCount: 1,
      warningCount: 0,
    });
  });
});

describe('recordedBackupResult', () => {
  it('renvoie le résultat enregistré', () => {
    expect(recordedBackupResult({ result: 'warnings' })).toBe('warnings');
  });

  it('« inconnu » pour un instantané sans résultat enregistré, jamais une valeur déduite', () => {
    expect(recordedBackupResult(undefined)).toBe('unknown');
    expect(recordedBackupResult(null)).toBe('unknown');
    expect(recordedBackupResult({ result: null })).toBe('unknown');
    expect(recordedBackupResult({ result: 'partial' })).toBe('unknown');
  });
});
