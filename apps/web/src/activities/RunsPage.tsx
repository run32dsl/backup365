import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Address, Alert, Button, DataTable, EmptyState, StatusPill, SubNav } from '../ui/index.js';
import type { Column } from '../ui/index.js';
import { dateTimeOf } from '../format.js';
import { fetchMailboxes, fetchPlans } from '../plans.js';
import { AUDIT_HASH } from '../routes.js';
import { cardLine } from '../status/model.js';
import {
  RESULT_VIEW,
  RUNS_HASH,
  RUNS_MESSAGES,
  RUN_RESULTS,
  causeOf,
  copiedLabel,
  countLabel,
  durationLabel,
  completeRuns,
  fetchRuns,
  mailOnlyTypes,
  sourcesLabel,
  volumeLabel,
  type RunEvent,
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

/** « À faire » d'un échec, avec le numéro d'exécution quand la cause est inconnue. */
function todoOf(r: RunItem): string {
  const todo = causeOf(r)?.todo ?? '';
  return r.failureCause === 'unknown' ? `${todo} (exécution n° ${r.id})` : todo;
}

/** Sans « À faire : » devant, la consigne de la carte commence par une majuscule. */
const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function runColumns(
  names: ReadonlyMap<string, string>,
  boxPlans: ReadonlySet<string>,
): Column<RunEvent>[] {
  // La source n'est nommée que s'il n'y en a qu'une ; sinon « 5 boîtes » (#571).
  const sourceOf = (r: RunEvent) =>
    r.runs.length === 1
      ? (names.get(r.itemId) ?? r.itemId)
      : sourcesLabel(r.runs.length, boxPlans.has(r.planId));
  return [
    {
      header: 'Début (UTC)',
      className: 'nowrap card-hidden',
      cell: (r) => <time dateTime={r.startedAt}>{dateTimeOf(r.startedAt) || '—'}</time>,
    },
    {
      header: 'Plan',
      className: 'keep-words card-title run-plan',
      cell: (r) => (
        <span>
          <span className="run-plan-name">{r.planName}</span>
          <span className="cell-secondary table-only">
            {r.runs.length === 1 ? <Address value={sourceOf(r)} /> : sourceOf(r)}
          </span>
        </span>
      ),
    },
    {
      header: 'Résultat',
      className: 'card-nolabel run-result',
      cell: (r) => {
        const view = RESULT_VIEW[r.result];
        const cause = causeOf(r);
        return (
          <div>
            <StatusPill status={view.status} label={view.label} />
            {cause && (
              <span className="table-only">
                <span className="cell-secondary">{`Cause\u00a0: ${cause.cause}`}</span>
                <span className="cell-secondary">{`À faire\u00a0: ${todoOf(r)}`}</span>
              </span>
            )}
          </div>
        );
      },
    },
    {
      header: 'Durée',
      className: 'nowrap-wide card-hidden',
      cell: (r) => durationLabel(r.durationMs),
    },
    {
      header: 'Éléments copiés',
      className: 'num card-hidden',
      cell: (r) =>
        r.result === 'running'
          ? '—'
          : countLabel(r.result === 'success' ? (r.itemsSaved ?? 0) : r.itemsSaved),
    },
    {
      header: 'Taille source',
      className: 'num card-hidden',
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
    // Sous 900 px seulement : « boîte · 21/11/2026 02:00 UTC · 14 min · 1 284 éléments copiés · 3,4 Go »,
    // puis la cause et ce qu'il faut faire, sans libellé ; un compteur inconnu est omis.
    {
      header: 'Détail',
      className: 'card-only',
      cell: (r) => {
        const at = dateTimeOf(r.startedAt);
        const cause = causeOf(r);
        return (
          <>
            {cardLine([
              sourceOf(r),
              at === '' ? '' : `${at} UTC`,
              r.durationMs === null ? '' : durationLabel(r.durationMs),
              // Une réussite dit toujours ce qu'elle a copié, « 0 » compris (#571).
              r.result === 'running'
                ? ''
                : copiedLabel(r.result === 'success' ? (r.itemsSaved ?? 0) : r.itemsSaved),
              volumeLabel(r.sourceBytes) ?? '',
            ])}
            {cause && <span className="cell-secondary">{capitalized(cause.cause)}</span>}
            {cause && <span className="cell-secondary">{capitalized(todoOf(r))}</span>}
          </>
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
  boxPlans = new Set(),
  onRetry,
}: {
  state: State;
  filter: RunsFilter;
  names?: ReadonlyMap<string, string>;
  /** Plans qui ne sauvegardent que des boîtes mail : leurs sources se comptent en « boîtes ». */
  boxPlans?: ReadonlySet<string>;
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
      <div className="runs-list">
        <DataTable
          caption="Dernières exécutions, de la plus récente à la plus ancienne"
          // La phrase d'introduction dit déjà l'ordre : légende lue, pas affichée (#580).
          hideCaption
          columns={runColumns(names, boxPlans)}
          rows={completeRuns(state.items, state.limit)}
          rowKey={(r) => r.id}
        />
      </div>
      <p className="state-note">{RUNS_MESSAGES.footer(state.limit)}</p>
    </>
  );
}

/** Page « Activités › Sauvegardes » : exécutions des plans, filtrables par plan et par résultat. */
export function RunsPage({ planId = '' }: { planId?: string }) {
  const [filter, setFilter] = useState<RunsFilter>({ planId, result: '' });
  const [state, setState] = useState<State>('loading');
  const [attempt, setAttempt] = useState(0);
  const [plans, setPlans] = useState<{ id: string; name: string; mailOnly: boolean }[]>([]);
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
      (list) =>
        setPlans(
          list.map((p) => ({
            id: p.id,
            name: p.name,
            mailOnly: mailOnlyTypes(p.dataTypes),
          })),
        ),
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
      <form onSubmit={submit} className="filters filters-inline" key={plans.length}>
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
      <RunsView
        state={state}
        filter={filter}
        names={names}
        boxPlans={new Set(plans.filter((p) => p.mailOnly).map((p) => p.id))}
        onRetry={retry}
      />
    </main>
  );
}
