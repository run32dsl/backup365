import type { StatusReport } from '@backup365/core';
import { Alert, StatusPill } from '../ui/index.js';

/**
 * Textes de la section « Stockage », en mots du produit : ce que le résultat de la vérification
 * change pour les données. Le terme technique reste dans la documentation de l'exploitant.
 */
export const CONDITIONAL_WRITES = {
  supported: 'Une sauvegarde et une restauration de la même source ne peuvent pas s’écraser.',
  ignoredTitle: 'Sauvegardes et restaurations bloquées sur ce stockage',
  ignored:
    'Le stockage ne bloque pas deux opérations lancées en même temps sur une même source. Pour ne pas risquer d’écraser des données, aucune sauvegarde ni restauration n’y est faite. Prévenez l’exploitant du serveur : le stockage est à faire corriger.',
  notProbedTitle: 'Stockage pas encore vérifié',
  notProbed:
    'La console n’a pas encore pu vérifier qu’une sauvegarde et une restauration de la même source ne peuvent pas s’écraser. Elle réessaie dans l’heure. D’ici là, ne restaurez pas une source pendant sa sauvegarde ; si ce message reste après la première sauvegarde, prévenez l’exploitant du serveur.',
  unknownLabel: 'Non vérifié',
  unknown: 'La vérification du stockage est impossible pour le moment.',
  /** Titre du bandeau de synthèse quand le stockage est le seul problème. */
  summaryTitle: 'Stockage à vérifier',
  /** Phrase du bandeau de synthèse quand le stockage ne protège pas les données. */
  summary: 'Stockage à vérifier : aucune sauvegarde ni restauration n’y est faite.',
  /** Même phrase, quand le titre dit déjà « Stockage à vérifier ». */
  summaryAlone:
    'Aucune sauvegarde ni restauration n’est faite sur ce stockage : voir la section « Stockage ».',
} as const;

/**
 * Section « Stockage » de la page Sources (administrateurs) : le stockage refuse-t-il les
 * écritures conditionnelles sur lesquelles le SDK fonde son bail par source ? Depuis le SDK 7.3.0,
 * Atlas refuse d'écrire sur un stockage qui les ignore (`ignored`) : sauvegardes et restaurations
 * y échouent. Rien si le serveur ne l'a pas dit (autre rôle, stockage non configuré).
 */
export function StorageCheck({ report }: { report: StatusReport }) {
  if (!report.storage) return null;
  const state = report.storage.conditionalWrites;
  return (
    <section className="status-section" aria-labelledby="storage-title">
      <h2 id="storage-title">Stockage</h2>
      {state === 'supported' && (
        <p>
          <StatusPill status="compliant" /> {CONDITIONAL_WRITES.supported}
        </p>
      )}
      {state === 'ignored' && (
        <Alert tone="warning" title={CONDITIONAL_WRITES.ignoredTitle}>
          {CONDITIONAL_WRITES.ignored}
        </Alert>
      )}
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
