import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Address, Alert, Button, DataTable, EmptyState, StatusPill, SubNav } from '../ui/index.js';
import type { Column } from '../ui/index.js';
import { NBSP, dateTimeOf } from '../format.js';
import { FAILURE_TEXT } from '../failureText.js';
import { useAdmin } from '../role.js';
import { fetchMailboxes, fetchPlans } from '../plans.js';
import { AUDIT_HASH } from '../routes.js';
import { cardLine } from '../status/model.js';
import {
  RESULT_VIEW,
  RUNS_HASH,
  RUNS_MESSAGES,
  RUN_RESULTS,
  adviceRunIds,
  causeOf,
  copiedCell,
  copiedLabel,
  durationLabel,
  completeRuns,
  fetchRuns,
  mailOnlyTypes,
  sizeCell,
  sourcesLabel,
  volumeLabel,
  type CellText,
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

/**
 * Cause puis conduite à tenir d'un échec, chacune sur sa ligne, mêmes phrases que le bandeau de
 * Plans de protection (#602) ; la conduite à tenir seulement si `advice` (une fois par plan,
 * #642) ; le numéro d'exécution, à transmettre, quand la cause est inconnue.
 */
function failureLines(r: RunItem, admin: boolean, advice: boolean, dataTypes?: readonly string[]) {
  const text = causeOf(r, admin, dataTypes);
  if (!text) return null;
  return (
    <>
      <span className="cell-secondary">{text.cause}</span>
      {advice && <span className="cell-secondary">{text.advice}</span>}
      {r.result === 'failed' && text.cause === FAILURE_TEXT.unknown.cause && (
        <span className="cell-secondary">{`Exécution n°${NBSP}${r.id}.`}</span>
      )}
    </>
  );
}

/** Cellule « Éléments copiés » ou « Taille source », en texte secondaire si `muted` (#640). */
const cellText = ({ text, muted }: CellText) =>
  muted ? <span className="cell-muted">{text}</span> : text;

export function runColumns(
  names: ReadonlyMap<string, string>,
  boxPlans: ReadonlySet<string>,
  planTypes: ReadonlyMap<string, readonly string[]>,
  admin: boolean,
  /** Les exécutions affichées : la conduite à tenir n'est donnée qu'une fois par plan (#642). */
  rows: readonly RunEvent[],
): Column<RunEvent>[] {
  const adviceIds = adviceRunIds(rows, admin, planTypes);
  const linesOf = (r: RunEvent) =>
    failureLines(r, admin, adviceIds.has(r.id), planTypes.get(r.planId));
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
        const lines = linesOf(r);
        return (
          <div>
            <StatusPill status={view.status} label={view.label} />
            {lines && <span className="table-only">{lines}</span>}
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
      cell: (r) => cellText(copiedCell(r)),
    },
    {
      header: 'Taille source',
      className: 'num card-hidden',
      cell: (r) => cellText(sizeCell(r)),
    },
    // Sous 900 px seulement : « boîte · 21/11/2026 02:00 UTC · 14 min · 1 284 éléments copiés · 3,4 Go »,
    // puis la cause et ce qu'il faut faire, sans libellé ; un compteur inconnu est omis.
    {
      header: 'Détail',
      className: 'card-only',
      cell: (r) => {
        const at = dateTimeOf(r.startedAt);
        return (
          <>
            {cardLine([
              sourceOf(r),
              at === '' ? '' : `${at} UTC`,
              r.durationMs === null ? '' : durationLabel(r.durationMs),
              // Une réussite dit ce qu'elle a copié, « aucun nouvel élément » compris (#571, #640) ;
              // un échec laisse parler sa cause, une taille inconnue est omise.
              r.result === 'success' ? copiedLabel(r.itemsSaved ?? 0) : '',
              r.result === 'success' ? (volumeLabel(r.sourceBytes) ?? '') : '',
            ])}
            {linesOf(r)}
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
  planTypes = new Map(),
  onRetry,
}: {
  state: State;
  filter: RunsFilter;
  names?: ReadonlyMap<string, string>;
  /** Plans qui ne sauvegardent que des boîtes mail : leurs sources se comptent en « boîtes ». */
  boxPlans?: ReadonlySet<string>;
  /** Ce que sauvegarde chaque plan : la cause d'un échec nomme ce qui manque (#632). */
  planTypes?: ReadonlyMap<string, readonly string[]>;
  onRetry?: () => void;
}) {
  const admin = useAdmin();
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
  const rows = completeRuns(state.items, state.limit);
  const full = state.items.length >= state.limit;
  return (
    <>
      <div className="runs-list">
        <DataTable
          caption="Dernières exécutions, de la plus récente à la plus ancienne"
          // La phrase d'introduction dit déjà l'ordre : légende lue, pas affichée (#580).
          hideCaption
          columns={runColumns(names, boxPlans, planTypes, admin, rows)}
          rows={rows}
          rowKey={(r) => r.id}
        />
      </div>
      <p className="state-note">{RUNS_MESSAGES.footer(rows.length, full)}</p>
    </>
  );
}

/**
 * Page « Activités › Sauvegardes » : exécutions des plans, filtrables par plan et par résultat.
 * L'ancre fixe le filtre de départ (`runsHash`, `FAILED_RUNS_HASH`).
 */
export function RunsPage({
  planId = '',
  result = '',
}: {
  planId?: string;
  result?: RunsFilter['result'];
}) {
  const [filter, setFilter] = useState<RunsFilter>({ planId, result });
  const [state, setState] = useState<State>('loading');
  const [attempt, setAttempt] = useState(0);
  const [plans, setPlans] = useState<{ id: string; name: string; dataTypes: readonly string[] }[]>(
    [],
  );
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
            dataTypes: p.dataTypes,
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
        boxPlans={new Set(plans.filter((p) => mailOnlyTypes(p.dataTypes)).map((p) => p.id))}
        planTypes={new Map(plans.map((p) => [p.id, p.dataTypes]))}
        onRetry={retry}
      />
    </main>
  );
}
