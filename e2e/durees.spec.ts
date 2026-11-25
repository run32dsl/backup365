import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  CAPTURES_ALERT_SECONDS,
  capturesDurationReport,
  reportCapturesDuration,
} from './durees.mjs';

// Tests sans navigateur ni serveur : seul le relevé de durée de `pnpm run captures` est vérifié.

test('relevé de durée des captures : ligne stable, en secondes entières', () => {
  expect(capturesDurationReport(41_600, 24)).toEqual({
    line: "captures : durée 42 s pour 24 images (seuil d'alerte : 300 s)",
    exceeded: false,
  });
});

test("le seuil d'alerte des captures est de 5 min, dépassé seulement au-delà", () => {
  expect(CAPTURES_ALERT_SECONDS).toBe(300);
  expect(capturesDurationReport(300_000, 24).exceeded).toBe(false);
  expect(capturesDurationReport(300_001, 24).exceeded).toBe(true);
});

test('hors GitHub Actions : le relevé va sur la sortie, sans fichier de résumé', () => {
  const lines: string[] = [];
  reportCapturesDuration(301_000, 24, {}, (line: string) => lines.push(line));
  expect(lines).toEqual([
    "captures : durée 301 s pour 24 images (seuil d'alerte : 300 s)",
    "captures : seuil d'alerte de 300 s dépassé",
  ]);
});

test('sous GitHub Actions : relevé dans le résumé du run, avertissement au-delà du seuil', () => {
  const dir = mkdtempSync(join(tmpdir(), 'durees-'));
  try {
    const summary = join(dir, 'summary.md');
    const env = { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary };
    const lines: string[] = [];
    const log = (line: string): number => lines.push(line);

    reportCapturesDuration(42_000, 24, env, log);
    expect(lines).toEqual(["captures : durée 42 s pour 24 images (seuil d'alerte : 300 s)"]);

    reportCapturesDuration(301_000, 24, env, log);
    expect(lines[2]).toBe("::warning::captures : seuil d'alerte de 300 s dépassé");
    expect(readFileSync(summary, 'utf8')).toBe(
      "captures : durée 42 s pour 24 images (seuil d'alerte : 300 s)\n\n" +
        "captures : durée 301 s pour 24 images (seuil d'alerte : 300 s)\n\n" +
        "captures : seuil d'alerte de 300 s dépassé\n\n",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// La règle de source des durées est écrite à deux endroits (procédure et modèle du bilan) : ces
// tests échouent si l'un des deux textes s'écarte de l'autre ou du seuil du code.
const readDoc = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

for (const path of ['CONTRIBUTING.md', 'docs/bilan-hebdomadaire.md']) {
  test(`${path} : même règle de source pour les durées de la CI`, () => {
    const text = readDoc(path).replace(/\s+/g, ' ');
    expect(text).toContain('seule source');
    expect(text).toMatch(/`verifs`[^.;]*complétée?s? par (celle des |les )résumés de run/);
    expect(text).toMatch(
      /cas d'écart entre ces deux relevés de `captures`, la valeur la plus défavorable/,
    );
    expect(text).toMatch(/nombre de runs (`ci` )?pris en compte/);
    expect(text).not.toContain('job `ci` prime');
    expect(text).toContain('10 min pour le job `ci`');
    expect(text).toContain('timeout de 15 min');
  });
}

test('modèle du bilan : seuils du tableau alignés sur le code, ligne du nombre de runs', () => {
  const rows = readDoc('docs/bilan-hebdomadaire.md')
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()));
  const row = (label: string): string[] | undefined =>
    rows.find((cells) => cells[1]?.startsWith(label));
  expect(row('Durée maximale de `captures`')?.[4]).toBe(`${CAPTURES_ALERT_SECONDS} s`);
  expect(row('Durée maximale du job `ci`')?.[4]).toBe('10 min');
  expect(row('Durée médiane du job `ci`')?.[2]).toContain('Actions');
  expect(row('Nombre de runs `ci` pris en compte')?.[2]).toContain('Actions');
});
