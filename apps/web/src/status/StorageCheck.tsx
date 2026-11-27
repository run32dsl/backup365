import type { StatusReport } from '@backup365/core';
import { useEffect, useRef } from 'react';
import { STATUS_HASH } from '../routes.js';
import { Alert, StatusPill } from '../ui/index.js';

/**
 * Textes de la section « Stockage », en mots du produit : ce que le résultat de la vérification
 * change pour les données. Le terme technique reste dans la documentation de l'exploitant.
 */
export const CONDITIONAL_WRITES = {
  supported: 'Une sauvegarde et une restauration de la même source ne peuvent pas s’écraser.',
  ignoredTitle: 'Sauvegardes et restaurations bloquées sur ce stockage',
  /** Explication seule : le bandeau d'en-tête porte déjà le titre et la conduite à tenir (#616). */
  ignored:
    'Le stockage ne bloque pas deux opérations lancées en même temps sur une même source. Pour ne pas risquer d’écraser des données, aucune sauvegarde ni restauration n’y est faite.',
  notProbedTitle: 'Stockage pas encore vérifié',
  notProbed:
    'La console n’a pas encore pu vérifier qu’une sauvegarde et une restauration de la même source ne peuvent pas s’écraser. Elle réessaie dans l’heure. D’ici là, ne restaurez pas une source pendant sa sauvegarde ; si ce message reste après la première sauvegarde, prévenez l’exploitant du serveur.',
  unknownLabel: 'Non vérifié',
  unknown: 'La vérification du stockage est impossible pour le moment.',
  /** Conduite à tenir, première phrase des bandeaux d'erreur du stockage bloqué (#612). */
  action: 'Prévenez l’exploitant du serveur : le stockage est à faire corriger.',
  /** Bandeau d'État des sources : les dates listées précèdent le blocage (#612). */
  before: 'Les sauvegardes listées plus bas sont antérieures au blocage.',
} as const;

/** Identifiant du titre de la section « Stockage », cible de « Voir le stockage » (#616). */
export const STORAGE_SECTION_ID = 'storage-title';

/** Vrai entre « Voir le stockage » et l'affichage de la section, qui prend alors le focus. */
let storageRequested = false;

/** « Voir le stockage » (Accueil) : ouvre État des sources, la section « Stockage » à l'écran. */
export function goToStorage(location: { hash: string } = window.location): void {
  storageRequested = true;
  location.hash = STATUS_HASH;
}

/** Oublie la demande : État des sources est chargé, avec ou sans section « Stockage ». */
export function forgetStorageRequest(): void {
  storageRequested = false;
}

/** Titre de section que l'on peut faire défiler et focaliser. */
type Reachable = { scrollIntoView: (options: ScrollIntoViewOptions) => void; focus: () => void };

/** Fait défiler jusqu'au titre et lui donne le focus, une seule fois, s'il a été demandé. */
export function revealStorage(title: Reachable | null): boolean {
  if (!storageRequested || !title) return false;
  storageRequested = false;
  title.scrollIntoView({ block: 'start' });
  title.focus();
  return true;
}

/**
 * Section « Stockage » de la page Sources (administrateurs) : le stockage refuse-t-il les
 * écritures conditionnelles sur lesquelles le SDK fonde son bail par source ? Depuis le SDK 7.3.0,
 * Atlas refuse d'écrire sur un stockage qui les ignore (`ignored`) : sauvegardes et restaurations
 * y échouent. Rien si le serveur ne l'a pas dit (autre rôle, stockage non configuré).
 */
export function StorageCheck({ report }: { report: StatusReport }) {
  if (!report.storage) return null;
  return <StorageSection state={report.storage.conditionalWrites} />;
}

function StorageSection({
  state,
}: {
  state: NonNullable<StatusReport['storage']>['conditionalWrites'];
}) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    revealStorage(title.current);
  }, []);
  return (
    <section className="status-section" aria-labelledby={STORAGE_SECTION_ID}>
      <h2 id={STORAGE_SECTION_ID} ref={title} tabIndex={-1}>
        Stockage
      </h2>
      {state === 'supported' && (
        <p>
          <StatusPill status="compliant" /> {CONDITIONAL_WRITES.supported}
        </p>
      )}
      {/* Le bandeau d'en-tête dit déjà le titre et la conduite à tenir : ici, l'explication (#616). */}
      {state === 'ignored' && <Alert tone="error">{CONDITIONAL_WRITES.ignored}</Alert>}
      {state === 'not_probed' && (
        <Alert tone="info" title={CONDITIONAL_WRITES.notProbedTitle}>
          {CONDITIONAL_WRITES.notProbed}
        </Alert>
      )}
      {state === null && (
        <p>
          <StatusPill status="pending" label={CONDITIONAL_WRITES.unknownLabel} />{' '}
          {CONDITIONAL_WRITES.unknown}
        </p>
      )}
    </section>
  );
}
