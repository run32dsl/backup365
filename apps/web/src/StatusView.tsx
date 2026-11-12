import type { BackupState, SourceKind, StatusReport } from '@backup365/core';

/** État du chargement du tableau de bord. */
export type StatusState = StatusReport | 'loading' | 'error';

const STATE_LABELS: Record<BackupState, string> = {
  ok: 'ok',
  stale: 'ancien',
  missing: 'absent',
};

const KIND_LABELS: Record<SourceKind, string> = { mailbox: 'boîte', site: 'site SharePoint' };

/** Synthèse puis tableau par boîte ou site et par charge ; l'état est écrit en toutes lettres (pas la couleur seule). */
export function StatusView({ state }: { state: StatusState }) {
  if (state === 'loading') return <p role="status">Chargement de l’état des sauvegardes…</p>;
  if (state === 'error') return <p role="alert">État des sauvegardes indisponible</p>;
  return (
    <section aria-label="État des sauvegardes">
      <p role="status">
        {state.alertCount === 0 ? 'Aucune alerte' : `${state.alertCount} élément(s) en alerte`}{' '}
        (seuil : {state.maxAgeHours} h)
      </p>
      {state.rows.length === 0 ? (
        <p>Aucune boîte ni site sauvegardé.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Type</th>
              <th>Charge</th>
              <th>Dernier instantané (UTC)</th>
              <th>Âge (h)</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row) => (
              <tr key={`${row.kind}/${row.sourceId}/${row.workload}`}>
                <td>{row.displayName}</td>
                <td>{KIND_LABELS[row.kind]}</td>
                <td>{row.workload}</td>
                <td>{row.lastSnapshotAt ?? '—'}</td>
                <td>{row.ageHours ?? '—'}</td>
                <td>{STATE_LABELS[row.state]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
