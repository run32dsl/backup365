import { describe, expect, it } from 'vitest';
import {
  cardSummary,
  dateTimeOf,
  dateTimeOrDash,
  folderLabel,
  keepDateTogether,
  plural,
  sizeOf,
  workloadLabel,
} from './format.js';

describe('cardSummary', () => {
  it('joins the UTC version and the size, and drops absent values', () => {
    expect(cardSummary('2026-11-18T09:52:00.000Z', 84_000)).toBe(
      'Version du 18/11/2026 09:52 UTC · 84 Ko',
    );
    expect(cardSummary(null, 84_000)).toBe('84 Ko');
    expect(cardSummary(null, null)).toBeNull();
  });
});

describe('format', () => {
  it('shows an ISO date as dd/mm/yyyy hh:mm UTC, without seconds or milliseconds', () => {
    const text = dateTimeOf('2026-11-16T18:15:20.738Z');
    expect(text).toBe('16/11/2026 18:15');
    expect(text).not.toMatch(/T|Z|\./u);
    expect(dateTimeOf(null)).toBe('');
    expect(dateTimeOf('n’importe quoi')).toBe('');
    expect(dateTimeOrDash(null)).toBe('—');
  });

  it('writes sizes in French units', () => {
    expect(sizeOf(842)).toBe('842 o');
    expect(sizeOf(2411)).toBe('2,4 Ko');
    expect(sizeOf(84_000)).toBe('84 Ko');
    expect(sizeOf(9_999)).toBe('10 Ko');
    expect(sizeOf(999_999)).toBe('1,0 Mo');
    expect(sizeOf(1_240_000)).toBe('1,2 Mo');
    expect(sizeOf(999_949_999)).toBe('999,9 Mo');
    expect(sizeOf(1_850_000_000)).toBe('1,9 Go');
  });

  it('translates folders and workloads, and keeps unknown ones', () => {
    expect(folderLabel('inbox')).toBe('Boîte de réception');
    expect(folderLabel('Inbox')).toBe('Boîte de réception');
    expect(folderLabel('sent')).toBe('Éléments envoyés');
    expect(folderLabel('archive')).toBe('Archives');
    expect(folderLabel('Projets')).toBe('Projets');
    expect(workloadLabel('mail')).toBe('Messagerie');
    expect(workloadLabel('onedrive')).toBe('OneDrive');
    expect(workloadLabel('sharepoint')).toBe('SharePoint');
  });

  it('agrees the plural', () => {
    expect(plural(0, 'résultat')).toBe('0 résultat');
    expect(plural(1, 'élément')).toBe('1 élément');
    expect(plural(10, 'résultat')).toBe('10 résultats');
  });
});

describe('keepDateTogether', () => {
  const NBSP = '\u00a0';
  it('joins date, time and UTC with non-breaking spaces only', () => {
    expect(keepDateTogether('Mail · 22/11/2026 21:01 UTC')).toBe(
      `Mail · 22/11/2026${NBSP}21:01${NBSP}UTC`,
    );
  });

  it('handles a date without UTC and leaves other text alone', () => {
    expect(keepDateTogether('14/11/2026 06:00')).toBe(`14/11/2026${NBSP}06:00`);
    expect(keepDateTogether('Fichiers déjà présents')).toBe('Fichiers déjà présents');
  });
});
