import type { StatusReport } from '@backup365/core';
import { Alert } from '../ui/index.js';

/** Libellé court de chaque résultat de la sonde, puis l'avertissement à afficher s'il y en a un. */
export const CONDITIONAL_WRITES = {
  supported: 'Écritures conditionnelles : acceptées par le stockage.',
  ignoredTitle: 'Le stockage ignore les écritures conditionnelles',
  ignored:
    'Il ne peut pas empêcher deux opérations simultanées sur une même source (une sauvegarde et une restauration, par exemple), et l’une pourrait écraser le travail de l’autre. Évitez de lancer une restauration pendant une sauvegarde, et demandez à l’exploitant un stockage S3 qui refuse les écritures conditionnelles en conflit.',
  notProbedTitle: 'Écritures conditionnelles non vérifiées',
  notProbed:
    'La vérification n’a pas pu écrire dans le stockage : aucune sauvegarde n’a encore créé le bucket, ou les identifiants n’ont que la lecture. Elle sera refaite dans l’heure.',
  unknown: 'Écritures conditionnelles : vérification impossible pour le moment.',
} as const;

/**
 * Section « Stockage » de la page Sources (administrateurs) : le stockage refuse-t-il les
 * écritures conditionnelles sur lesquelles le SDK 7.2.0 fonde son bail par source ? Rien si le
 * serveur ne l'a pas dit (autre rôle, stockage non configuré).
 */
export function StorageCheck({ report }: { report: StatusReport }) {
  if (!report.storage) return null;
  const state = report.storage.conditionalWrites;
  return (
    <section className="status-section" aria-labelledby="storage-title">
      <h2 id="storage-title">Stockage</h2>
      {state === 'supported' && <p>{CONDITIONAL_WRITES.supported}</p>}
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
      {state === null && <p>{CONDITIONAL_WRITES.unknown}</p>}
    </section>
  );
}
