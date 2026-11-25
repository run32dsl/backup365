import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Aide des tests qui lisent le code source : ils voient un écran en entier, dossiers compris. */
const root = fileURLToPath(new URL('./', import.meta.url));

/** Fichiers `.ts` et `.tsx` de l'application (hors tests), chemins relatifs à `src`. */
export function sourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [relative(root, join(dir, e.name))],
    );
  return walk(root).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
}

export const source = (name: string): string => readFileSync(join(root, name), 'utf8');

/** Dossiers qui portent le code de chaque écran découpé (ADR 0016, issue #256). */
const FOLDERS: Record<string, string[]> = {
  'OneDrivePage.tsx': ['onedrive/', 'restore/'],
  'SharePointPage.tsx': ['sharepoint/', 'restore/'],
  'PlansPage.tsx': ['plans/'],
};

/** Le texte d'un écran : sa page et les fichiers de ses dossiers. */
export function screen(name: string): string {
  const folders = FOLDERS[name];
  if (!folders) throw new Error(`Écran inconnu : ${name} (à ajouter à FOLDERS)`);
  const files = sourceFiles().filter((f) => folders.some((d) => f.startsWith(d)));
  return [name, ...files].map(source).join('\n');
}
