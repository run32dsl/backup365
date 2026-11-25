import { parseOneDriveHash } from '../onedrive.js';
import { parseSharePointHash } from '../sharepoint.js';
import { parseMailHash, parseSearchHash } from '../mail.js';
import { parsePlansHash } from '../plans.js';
import { COMPONENTS_HASH, LEGACY_STATUS_HASH, STATUS_HASH } from '../routes.js';

/**
 * Écran demandé par l'ancre de l'URL : `#/audit` le journal, `#/search` la recherche,
 * `#/comptes` les comptes, `#/password` le changement de mot de passe, `#/mail/<boîte>/<message>`
 * la fiche d'un mail, `#/onedrive/<compte>/<chemin>` la restauration OneDrive,
 * `#/sharepoint/<site>/<granularité>` la restauration SharePoint, tout le reste
 * l'accueil.
 */
export function screenOf(
  hash: string,
):
  | 'audit'
  | 'search'
  | 'accounts'
  | 'plans'
  | 'status'
  | 'password'
  | 'components'
  | 'mail'
  | 'onedrive'
  | 'sharepoint'
  | 'home' {
  if (parsePlansHash(hash)) return 'plans';
  if (parseOneDriveHash(hash)) return 'onedrive';
  if (parseSharePointHash(hash)) return 'sharepoint';
  if (hash === '#/audit') return 'audit';
  if (hash === '#/search' || parseSearchHash(hash) !== null) return 'search';
  if (hash === '#/comptes') return 'accounts';
  if (hash === STATUS_HASH) return 'status';
  if (hash === '#/password') return 'password';
  if (hash === COMPONENTS_HASH) return 'components';
  return parseMailHash(hash) ? 'mail' : 'home';
}

/**
 * Écran affiché pour une ancre et un rôle : un opérateur qui ouvre `#/comptes` reçoit « page
 * réservée » au lieu d'un accueil silencieux.
 */
export function screenFor(
  hash: string,
  admin: boolean,
  demo: boolean | null = false,
): ReturnType<typeof screenOf> | 'forbidden' | 'unavailable' | 'pending' {
  const screen = screenOf(hash);
  // `null` : le serveur n'a pas encore dit s'il est en démo ; rien n'est affiché plutôt qu'un avis faux.
  if (screen === 'components') return demo === null ? 'pending' : demo ? screen : 'unavailable';
  return (screen === 'accounts' || screen === 'status') && !admin ? 'forbidden' : screen;
}

/** Nouvelle ancre d'une ancienne adresse (`#/etat` → `#/sources`) ; `null` si rien à rediriger. */
export function redirectLegacyHash(hash: string): string | null {
  return hash === LEGACY_STATUS_HASH ? STATUS_HASH : null;
}

/** Entrée de navigation : un lien, avec une icône décorative. */
export type NavEntry = { href: string; label: string; current: boolean; icon: string };

/** Charte : cinq entrées au plus (décision du PM du 2026-11-19). */
export const MAX_ADMIN_NAV_ENTRIES = 5;

/**
 * Entrées de la navigation principale : Accueil, Sources, Restaurer, Activités, Réglages. Les
 * trois parcours de restauration (messagerie, OneDrive, SharePoint) restent sous « Restaurer »,
 * fiche d'un mail comprise ; les plans et l'état des sources sont sous « Sources ». « Réglages »
 * (comptes) est réservé aux administrateurs : un opérateur voit quatre entrées.
 */
export function navEntries(screen: ReturnType<typeof screenFor>, admin: boolean): NavEntry[] {
  const entries: NavEntry[] = [
    { href: '#/', label: 'Accueil', icon: '⌂', current: screen === 'home' },
    {
      href: '#/plans',
      label: 'Sources',
      icon: '▤',
      current: screen === 'plans' || screen === 'status',
    },
    {
      href: '#/search',
      label: 'Restaurer',
      icon: '↺',
      current:
        screen === 'search' ||
        screen === 'mail' ||
        screen === 'onedrive' ||
        screen === 'sharepoint',
    },
    { href: '#/audit', label: 'Activités', icon: '≡', current: screen === 'audit' },
  ];
  if (admin) {
    entries.push({
      href: '#/comptes',
      label: 'Réglages',
      icon: '⚙',
      current: screen === 'accounts' || screen === 'forbidden',
    });
  }
  // Invariant de la charte : un ajout qui la dépasse échoue aux tests, pas en silence chez l'utilisateur.
  if (entries.length > MAX_ADMIN_NAV_ENTRIES) {
    throw new Error(`La navigation dépasse ${MAX_ADMIN_NAV_ENTRIES} entrées.`);
  }
  return entries;
}
