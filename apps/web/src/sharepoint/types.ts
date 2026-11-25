import type { SiteEntry, SiteScope } from '../sharepoint.js';

/** Ce qui a été choisi à l'étape 1. */
export interface Choice {
  scope: SiteScope;
  /** `/` pour le site entier. */
  path: string;
  snapshotId: string;
  pointAt: string;
}

/** Granularité portée par les ancres des liens : elle n'a plus d'effet sur l'écran. */
export const LINK_SCOPE: SiteScope = 'item';

/** Ce que la ligne cochée désigne : une bibliothèque, un dossier ou un fichier. */
export interface Selected {
  path: string;
  kind: SiteEntry['kind'];
}
