import { parentOf } from '@backup365/core';
import type { DriveEntry, DriveVersion } from '../onedrive.js';

/** Élément choisi à l'étape 1 : un fichier ou un dossier, éventuellement une version précise. */
export interface Choice {
  entry: DriveEntry;
  snapshotId: string;
  version?: DriveVersion | undefined;
}

/** Dossier d'un chemin, pour les phrases : `Documents > Budget`, `la racine` sinon. */
export function folderLabel(path: string): string {
  const parent = parentOf(path);
  return parent === '/' ? 'la racine' : parent.split('/').filter(Boolean).join(' > ');
}
