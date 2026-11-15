import type { BackupState, SourceKind, StatusReport } from '@backup365/core';

/** État du chargement du tableau de bord. */
export type StatusState = StatusReport | 'loading' | 'error' | 'empty';

/** Badge d'état : icône et texte, jamais la couleur seule. */
const STATE_BADGES: Record<BackupState, { icon: string; label: string; tone: string }> = {
  ok: { icon: '✔', label: 'À jour', tone: 'ok' },
  stale: { icon: '⚠', label: 'Avertissement', tone: 'warn' },
  missing: { icon: '✖', label: 'Échec', tone: 'err' },
};

function StateBadge({ state }: { state: BackupState }) {
  const badge = STATE_BADGES[state];
  return (
    <span className={`badge badge-${badge.tone}`}>
      <span aria-hidden="true">{badge.icon}</span> {badge.label}
    </span>
  );
}

const KIND_LABELS: Record<SourceKind, string> = { mailbox: 'boîte', site: 'site SharePoint' };

/** Synthèse puis tableau par boîte ou site et par charge ; l'état est écrit en toutes lettres (pas la couleur seule). */
export function StatusView({ state }: { state: StatusState }) {
  if (state === 'loading') return <p role="status">Chargement de l’état des sauvegardes…</p>;
  if (state === 'empty')
    return <p role="status">Aucune sauvegarde trouvée : lancez une première sauvegarde Atlas.</p>;
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
          <caption className="sr-only">État par boîte, site et charge</caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Type</th>
              <th scope="col">Charge</th>
              <th scope="col">Dernier instantané (UTC)</th>
              <th scope="col">Âge (h)</th>
              <th scope="col">État</th>
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
                <td>
                  <StateBadge state={row.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
