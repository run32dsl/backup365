import { scheduleWindowLabel } from '@backup365/core';
import {
  MESSAGES,
  complianceView,
  editHash,
  lastRunLabel,
  planSummary,
  type Mailbox,
  type PlanItem,
  type SourcesReport,
} from '../plans.js';
import { Button, StatusPill, type Column } from '../ui/index.js';

export function planColumns(
  admin: boolean,
  mailboxes: readonly Mailbox[],
  runningName: string | undefined,
  sources: SourcesReport | null,
  actions: { onRun: (p: PlanItem) => void; onDelete: (p: PlanItem) => void },
  /** Vue « plans en échec » : le bandeau du plan porte « Lancer maintenant », pas la ligne. */
  runInBanner = false,
): Column<PlanItem>[] {
  const columns: Column<PlanItem>[] = [
    {
      header: 'Plan',
      className: 'card-title',
      cell: (p) => (
        <div>
          <span className="nowrap-wide">{p.name}</span>
          <small className="state-note plan-summary">{planSummary(p, mailboxes)}</small>
          {scheduleWindowLabel(p.rpoHours) && (
            <small className="state-note plan-summary">{scheduleWindowLabel(p.rpoHours)}</small>
          )}
        </div>
      ),
    },
    {
      header: 'État',
      className: 'compliance-cell card-nolabel',
      cell: (p) => {
        const view = complianceView(p, runningName, sources, mailboxes);
        return (
          <div>
            <StatusPill status={view.status} label={view.label} />
            {view.note && <small className="state-note">{view.note}</small>}
            {view.seeSources && (
              <a className="state-link" href="#/sources">
                Voir les sources
              </a>
            )}
          </div>
        );
      },
    },
    {
      header: 'Dernière exécution (UTC)',
      className: 'card-wide plan-last-run',
      cell: lastRunLabel,
    },
  ];
  if (admin) {
    columns.push({
      header: 'Actions',
      className: 'card-action',
      cell: (p) => (
        <div className={`button-row row-actions${runInBanner ? ' row-actions-no-run' : ''}`}>
          {!runInBanner && (
            <Button
              variant="secondary"
              aria-label={`Lancer ${p.name} maintenant`}
              aria-disabled={p.running || p.queued || undefined}
              aria-describedby={p.running || p.queued ? `run-hint-${p.id}` : undefined}
              onClick={() => {
                if (!p.running && !p.queued) actions.onRun(p);
              }}
            >
              Lancer maintenant
            </Button>
          )}
          {!runInBanner && (p.running || p.queued) && (
            <small className="state-note" id={`run-hint-${p.id}`}>
              {p.running ? MESSAGES.runBusy : MESSAGES.runAlreadyQueued}
            </small>
          )}
          <a
            className="btn btn-secondary action-half"
            href={editHash(p.id)}
            aria-label={`Modifier ${p.name}`}
          >
            Modifier
          </a>
          <Button
            variant="danger"
            className="action-half"
            aria-label={`Supprimer ${p.name}`}
            onClick={() => {
              actions.onDelete(p);
            }}
          >
            Supprimer
          </Button>
        </div>
      ),
    });
  }
  return columns;
}
