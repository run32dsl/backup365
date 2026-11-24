import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Dossiers de travail de l'hôte et des agents, jamais commités. Un seul oubli ici suffit à
// faire échouer `prettier --check .` (qui parcourt aussi les fichiers non suivis) sur une PR
// dont le code est correct.
const WORKDIRS = ['.pr', '.review', '.recette'];

const entries = (file: string): string[] =>
  readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.trim().replace(/^\/|\/$/g, ''));

describe('working directories of the host and the agents', () => {
  it.each(WORKDIRS)('%s is ignored by git', (dir) => {
    expect(entries('.gitignore')).toContain(dir);
  });

  it.each(WORKDIRS)('%s is ignored by format:check', (dir) => {
    expect(entries('.prettierignore')).toContain(dir);
  });
});
