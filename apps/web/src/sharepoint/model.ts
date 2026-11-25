import type { SiteScope } from '@backup365/core';
import { REASON } from '../RestoreJourney.js';
import { quoted } from '../format.js';

export type SiteJobStatus = 'running' | 'succeeded' | 'failed';

/** Restauration SharePoint telle que l'API la rend : états, comptes et durées, jamais de contenu. */
export interface SiteJob {
  id: string;
  siteId: string;
  scope: SiteScope;
  path: string;
  status: SiteJobStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  total: number;
  restored: number;
  skipped: number;
  errors: number;
  copyName: string | null;
  error: 'restore_error' | 'restore_unreachable' | 'restore_lost' | null;
}

export interface Site {
  id: string;
  displayName: string;
}

export const SHAREPOINT_MESSAGES = {
  title: 'Restaurer depuis SharePoint',
  loadingPoints: 'Chargement des points de restauration…',
  loading: 'Chargement…',
  noSites: 'Aucun site SharePoint n’est encore sauvegardé.',
  noPoints: 'Aucun point de restauration pour ce site.',
  emptyFolder: 'Ce dossier ne contient aucun élément à cette date.',
  readError: 'La sauvegarde n’a pas pu être lue.',
  forbidden: 'Vous n’avez pas le droit de restaurer ce site. Contactez un administrateur.',
  forbiddenSite: (name: string) =>
    `Vous n’avez pas le droit de restaurer le site ${quoted(name)}. Demandez à un administrateur ou choisissez un autre site.`,
  chooseOther: 'Choisir un autre site',
  reasonError: REASON.error,
  nameError: 'Le nom saisi ne correspond pas au site.',
  inactiveHint:
    'Le bouton reste inactif tant que la case n’est pas cochée et que le nom du site n’est pas exact.',
  alreadyRunning: 'Une restauration de ce site est déjà en cours.',
  auditUnavailable: 'Journal d’audit indisponible : restauration refusée.',
  emptyScope: 'Rien à restaurer à cette date : le périmètre ne contient aucun élément.',
  notInBackup: 'Cet élément n’est plus disponible dans la sauvegarde.',
  generic: 'La demande a échoué. Réessayez.',
} as const;
