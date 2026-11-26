import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Address, Alert, Button, DataTable, EmptyState, StatusPill, SubNav } from '../ui/index.js';
import type { Column } from '../ui/index.js';
import { dateTimeOf } from '../format.js';
import { fetchMailboxes, fetchPlans } from '../plans.js';
import { AUDIT_HASH } from '../routes.js';
import {
  RESULT_VIEW,
  RUNS_HASH,
  RUNS_MESSAGES,
  RUN_RESULTS,
  causeOf,
  countLabel,
  durationLabel,
  fetchRuns,
  volumeLabel,
  type RunItem,
  type RunResult,
  type RunsFilter,
  type RunsResponse,
} from './runs.js';

/** Vues de « Activités » : les exécutions des sauvegardes, puis le journal d'audit. */
export function ActivitiesNav({ current }: { current: 'runs' | 'audit' }) {
  return (
    <SubNav
      label="Vue des activités"
      links={[
        { href: RUNS_HASH, label: 'Sauvegardes', current: current === 'runs' },
        { href: AUDIT_HASH, label: 'Journal d’audit', current: current === 'audit' },
      ]}
    />
  );
}

function runColumns(names: ReadonlyMap<string, string>): Column<RunItem>[] {
  return [
    {
      header: 'Début (UTC)',
      className: 'nowrap',
      cell: (r) => <time dateTime={r.startedAt}>{dateTimeOf(r.startedAt) || '—'}</time>,
    },
    {
      header: 'Plan',
      className: 'keep-words card-title',
      cell: (r) => (
        <span>
          {r.planName}
          <span className="cell-secondary">
            <Address value={names.get(r.itemId) ?? r.itemId} />
          </span>
        </span>
      ),
    },
    {
      header: 'Résultat',
      className: 'card-wide run-result',
      cell: (r) => {
        const view = RESULT_VIEW[r.result];
        const cause = causeOf(r);
        return (
          <div>
            <StatusPill status={view.status} label={view.label} />
            {cause && (
              <>
                <span className="cell-secondary">{`Cause\u00a0: ${cause.cause}`}</span>
                <span className="cell-secondary">
                  {`À faire\u00a0: ${cause.todo}`}
                  {r.failureCause === 'unknown' && ` (exécution n° ${r.id})`}
                </span>
              </>
            )}
          </div>
        );
      },
    },
    { header: 'Durée', className: 'nowrap-wide', cell: (r) => durationLabel(r.durationMs) },
    {
      header: 'Éléments copiés',
      className: 'num',
      cell: (r) => (r.result === 'running' ? '—' : countLabel(r.itemsSaved)),
    },
    {
      header: 'Taille source',
      className: 'num',
      cell: (r) => {
        const size = volumeLabel(r.sourceBytes);
        if (size) return size;
        return (
          <span>
            <span aria-hidden="true">—</span>
            <span className="sr-only">{RUNS_MESSAGES.unknownSize}</span>
          </span>
        );
      },
    },
  ];
}

type State = RunsResponse | 'loading' | 'error';

/** Liste des exécutions et ses états (chargement, erreur, vide). */
export function RunsView({
  state,
  filter,
  names = new Map(),
  onRetry,
}: {
  state: State;
  filter: RunsFilter;
  names?: ReadonlyMap<string, string>;
  onRetry?: () => void;
}) {
  if (state === 'loading') {
    return (
      <p role="status" aria-busy="true">
        {RUNS_MESSAGES.loading}
      </p>
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
        {RUNS_MESSAGES.error}
      </Alert>
    );
  }
  if (state.items.length === 0) {
    const message = filter.result
      ? RUNS_MESSAGES.emptyFiltered
      : filter.planId
        ? RUNS_MESSAGES.emptyPlan
        : RUNS_MESSAGES.emptyAll;
    return <EmptyState>{message}</EmptyState>;
  }
  return (
    <>
      <DataTable
        caption="Dernières exécutions, de la plus récente à la plus ancienne"
        columns={runColumns(names)}
        rows={state.items}
        rowKey={(r) => r.id}
      />
      <p className="state-note">{RUNS_MESSAGES.footer(state.limit)}</p>
    </>
  );
}

/** Page « Activités › Sauvegardes » : exécutions des plans, filtrables par plan et par résultat. */
export function RunsPage({ planId = '' }: { planId?: string }) {
  const [filter, setFilter] = useState<RunsFilter>({ planId, result: '' });
  const [state, setState] = useState<State>('loading');
  const [attempt, setAttempt] = useState(0);
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    let current = true;
    setState('loading');
    fetchRuns(filter).then(
      (r) => current && setState(r),
      () => current && setState('error'),
    );
    return () => {
      current = false;
    };
  }, [filter, attempt]);

  useEffect(() => {
    fetchPlans().then(
      (list) => setPlans(list.map((p) => ({ id: p.id, name: p.name }))),
      () => undefined,
    );
    void fetchMailboxes().then(({ mailboxes }) =>
      setNames(new Map(mailboxes.map((m) => [m.id, m.displayName]))),
    );
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = String(form.get('result') ?? '');
    setFilter({
      planId: String(form.get('plan') ?? ''),
      result: (RUN_RESULTS as readonly string[]).includes(result) ? (result as RunResult) : '',
    });
  }

  return (
    <main tabIndex={-1}>
      <h1>Activités</h1>
      <ActivitiesNav current="runs" />
      <p>{RUNS_MESSAGES.intro}</p>
      <form onSubmit={submit} className="filters" key={plans.length}>
        <div className="field">
          <label htmlFor="runs-plan">Plan</label>
          <select id="runs-plan" name="plan" defaultValue={filter.planId}>
            <option value="">Tous les plans</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="runs-result">Résultat</label>
          <select id="runs-result" name="result" defaultValue={filter.result}>
            <option value="">Tous</option>
            {RUN_RESULTS.map((r) => (
              <option key={r} value={r}>
                {RESULT_VIEW[r].label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Filtrer</Button>
      </form>
      <RunsView state={state} filter={filter} names={names} onRetry={retry} />
    </main>
  );
}
