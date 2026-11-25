import type { StatusReport } from '@backup365/core';
import { Alert, EmptyState } from './ui/index.js';
import { Backups } from './status/Backups.js';
import { PlansCompliance } from './status/PlansCompliance.js';
import { Services } from './status/Services.js';
import { Summary } from './status/Summary.js';

export { failureNote } from './status/Backups.js';
export { lateCause, scopeLabel, sortRows } from './status/model.js';

/** État du chargement du tableau de bord. */
export type StatusState = StatusReport | 'loading' | 'error' | 'empty';

/** Synthèse, plans, puis sauvegardes ; l'état est écrit en toutes lettres (pas la couleur seule). */
export function StatusView({ state }: { state: StatusState }) {
  if (state === 'loading') return <p role="status">Chargement de l’état des sauvegardes…</p>;
  if (state === 'empty')
    return (
      <EmptyState>
        Aucune sauvegarde pour l’instant. Elle apparaîtra ici après la première exécution d’un plan
        de protection.
      </EmptyState>
    );
  if (state === 'error') return <Alert tone="error">État des sauvegardes indisponible</Alert>;
  return (
    <>
      <Summary report={state} />
      <Services report={state} />
      <PlansCompliance report={state} />
      <Backups report={state} />
    </>
  );
}
