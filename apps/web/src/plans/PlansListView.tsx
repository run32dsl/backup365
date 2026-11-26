import { type ReactNode } from 'react';
import {
  MESSAGES,
  NEW_PLAN_HASH,
  failureBanner,
  isFailed,
  type Mailbox,
  type PlanItem,
  type SourcesReport,
} from '../plans.js';
import { RUN_BLOCKED_TEXT } from '../ConfigurationBlock.js';
import { Alert, Button, DataTable, EmptyState } from '../ui/index.js';
import { goTo } from './goTo.js';
import { planColumns } from './planColumns.js';

export type PlansState = PlanItem[] | 'loading' | 'error';

/** Liste des plans et ses états (chargement, erreur, vide, non configuré, lecture seule). */
export function PlansListView({
  state,
  admin,
  configured,
  mailboxes = [],
  sources = null,
  failedOnly = false,
  runBlocked = false,
  onRetry,
  onRun,
  onDelete,
}: {
  state: PlansState;
  admin: boolean;
  /** Connexion Microsoft 365 interrompue : aucun « Lancer maintenant », une phrase à la place. */
  runBlocked?: boolean;
  /** Rapport d'état des sources : un plan en retard y nomme ses sources en retard. */
  sources?: SourcesReport | null;
  /** Réduit la liste aux plans en échec (s'il y en a) ; un lien rend la liste entière. */
  failedOnly?: boolean;
  mailboxes?: readonly Mailbox[];
  configured: boolean;
  onRetry: () => void;
  onRun: (p: PlanItem) => void;
  onDelete: (p: PlanItem) => void;
}) {
  if (state === 'loading') {
    return (
      <div aria-busy="true">
        <p role="status" aria-live="polite">
          {MESSAGES.loading}
        </p>
        <div className="skeleton" aria-hidden="true" />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <Alert
        tone="error"
        action={
          <Button variant="secondary" onClick={onRetry}>
            Réessayer
          </Button>
        }
      >
        {MESSAGES.loadError}
      </Alert>
    );
  }
  const notice: ReactNode = !configured && (
    <EmptyState
      action={
        admin ? (
          <Button
            variant="secondary"
            onClick={() => {
              goTo('#/');
            }}
          >
            Configurer la sauvegarde
          </Button>
        ) : undefined
      }
    >
      <strong>{MESSAGES.notConfigured}</strong>
      <br />
      {admin ? MESSAGES.notConfiguredHelp : MESSAGES.notConfiguredOperator}
    </EmptyState>
  );
  if (state.length === 0) {
    if (notice) return <>{notice}</>;
    return (
      <EmptyState
        action={
          admin ? (
            <Button
              onClick={() => {
                goTo(NEW_PLAN_HASH);
              }}
            >
              Créer un plan
            </Button>
          ) : undefined
        }
      >
        <strong>{MESSAGES.emptyTitle}</strong>
        <br />
        {admin ? MESSAGES.emptyAdmin : MESSAGES.emptyOperator}
      </EmptyState>
    );
  }
  const failed = state.filter(isFailed);
  const filtered = failedOnly && failed.length > 0;
  return (
    <>
      {notice}
      {!admin && <p>{MESSAGES.readOnly}</p>}
      {filtered && (
        <>
          {failed.map((p) => {
            const banner = failureBanner(p, admin, sources);
            const busy = p.running || p.queued;
            return (
              <Alert
                key={p.id}
                tone="error"
                title={banner.title}
                action={
                  admin && !runBlocked ? (
                    <Button
                      className="alert-run"
                      aria-label={`Lancer ${p.name} maintenant`}
                      aria-disabled={busy || undefined}
                      aria-describedby={busy ? `banner-run-hint-${p.id}` : undefined}
                      onClick={() => {
                        if (!busy) onRun(p);
                      }}
                    >
                      Lancer maintenant
                    </Button>
                  ) : undefined
                }
              >
                {[banner.cause, banner.consequence, banner.advice].filter(Boolean).join(' ')}
                {admin && runBlocked && <small className="state-note">{RUN_BLOCKED_TEXT}</small>}
                {busy && !runBlocked && (
                  <small className="state-note" id={`banner-run-hint-${p.id}`}>
                    {p.running ? MESSAGES.runBusy : MESSAGES.runAlreadyQueued}
                  </small>
                )}
              </Alert>
            );
          })}
        </>
      )}
      <DataTable
        caption="Plans de protection"
        hideCaption
        columns={planColumns(
          admin,
          mailboxes,
          state.find((p) => p.running)?.name,
          sources,
          { onRun, onDelete },
          filtered,
          runBlocked,
        )}
        rows={filtered ? failed : state}
        rowKey={(p) => p.id}
      />
    </>
  );
}
