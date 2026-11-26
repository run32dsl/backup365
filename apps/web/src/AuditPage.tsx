import { useEffect, useState, type FormEvent } from 'react';
import { AUDIT_ACTIONS } from '@backup365/core';
import {
  AUDIT_PAGE_SIZE,
  DATE_HELP,
  FILTER_NOT_APPLIED,
  hasDateError,
  fetchAudit,
  queryFromForm,
  submitFilters,
  type DateRange,
  type AuditItem,
  type AuditQuery,
  type AuditResponse,
} from './audit.js';
import {
  ACTION_LABELS,
  NO_TARGET,
  actorLabel,
  auditDate,
  countLabel,
  detailLabel,
  reasonLabel,
  targetView,
} from './auditLabels.js';
import { fetchPlans } from './plans.js';
import { ActivitiesNav } from './activities/RunsPage.js';
import {
  Address,
  Alert,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Pager,
  type Column,
} from './ui/index.js';

/** État de la consultation du journal. */
export type AuditState = AuditResponse | 'loading' | 'error';

type Entry = AuditItem;

/** Colonnes du tableau ; l'empreinte n'y figure pas (elle reste dans l'infobulle du numéro et dans l'API). */
function columns(planNames: ReadonlyMap<string, string> | null): Column<Entry>[] {
  return [
    {
      header: 'N°',
      className: 'card-hidden',
      cell: (e) => <span title={`Empreinte : ${e.hash}`}>{e.seq}</span>,
    },
    {
      header: 'Date (UTC)',
      className: 'nowrap audit-date',
      cell: (e) => <span title={e.at}>{auditDate(e.at) || '—'}</span>,
    },
    { header: 'Acteur', className: 'keep-words audit-actor', cell: (e) => actorLabel(e.actor) },
    {
      header: 'Action',
      className: 'keep-words card-title',
      cell: (e) => {
        const detail = detailLabel(e.reason);
        const typed = reasonLabel(e.reason);
        return (
          <span>
            <span className="nowrap-wide">{ACTION_LABELS[e.action]}</span>
            {detail && <span className="cell-secondary">{detail}</span>}
            {typed && <span className="cell-secondary">{`Motif : ${typed}`}</span>}
          </span>
        );
      },
    },
    {
      header: 'Cible',
      className: 'keep-words address card-nolabel',
      cell: (e) => {
        const { name, secondary } = targetView(e, planNames);
        const count = countLabel(e.resource, e.count);
        // Sans cible ni nombre : cellule vide (la carte l'omet).
        if (name === NO_TARGET && !count) return null;
        return (
          <span>
            {name !== NO_TARGET && <Address value={name} />}
            {(secondary || count) && (
              <span className="cell-secondary">
                {secondary && <Address value={secondary} />}
                {secondary && count && ' · '}
                {count}
              </span>
            )}
          </span>
        );
      },
    },
  ];
}

/** Tableau des entrées du journal, du plus récent au plus ancien. */
export function AuditView({
  state,
  planNames = null,
  onPage,
  filterRefused = false,
}: {
  state: AuditState;
  /** Un filtre de date refusé n'a pas été appliqué : la liste affichée n'est pas filtrée. */
  filterRefused?: boolean;
  planNames?: ReadonlyMap<string, string> | null;
  onPage?: (offset: number) => void;
}) {
  if (state === 'loading') return <p role="status">Chargement du journal…</p>;
  if (state === 'error') return <Alert tone="error">Journal d’audit indisponible</Alert>;
  const notice = filterRefused && <Alert tone="info">{FILTER_NOT_APPLIED}</Alert>;
  if (state.items.length === 0)
    return (
      <>
        {notice}
        <EmptyState>Aucune entrée.</EmptyState>
      </>
    );
  return (
    <>
      {notice}
      <p role="status">
        {state.total === 1
          ? '1 entrée'
          : `Entrées ${state.offset + 1} à ${state.offset + state.items.length} sur ${state.total}`}
      </p>
      <div className="pager-top">
        <Pager offset={state.offset} limit={state.limit} total={state.total} onPage={onPage} />
      </div>
      <DataTable
        caption="Entrées du journal d’audit"
        hideCaption
        columns={columns(planNames)}
        rows={state.items}
        rowKey={(e) => e.seq}
      />
      <Pager offset={state.offset} limit={state.limit} total={state.total} onPage={onPage} />
    </>
  );
}

/** Écran de consultation du journal d'audit, avec filtres par date, acteur et action. */
export function AuditPage() {
  const [query, setQuery] = useState<AuditQuery>({ limit: AUDIT_PAGE_SIZE, offset: 0 });
  const [state, setState] = useState<AuditState>('loading');
  useEffect(() => {
    let current = true;
    setState('loading');
    fetchAudit(query).then(
      (r) => current && setState(r),
      () => current && setState('error'),
    );
    return () => {
      current = false;
    };
  }, [query]);

  const [planNames, setPlanNames] = useState<ReadonlyMap<string, string> | null>(null);
  useEffect(() => {
    fetchPlans().then(
      (plans) => setPlanNames(new Map(plans.map((p) => [p.id, p.name]))),
      () => undefined,
    );
  }, []);

  const [errors, setErrors] = useState<DateRange>({ from: '', to: '' });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const { errors, query } = submitFilters(form, 'from', 'to', queryFromForm);
    setErrors(errors);
    if (query) setQuery(query);
  }

  return (
    <main tabIndex={-1}>
      <h1>Activités</h1>
      <ActivitiesNav current="audit" />
      <p>
        Journal d’audit : la consultation de ce journal est elle-même inscrite au journal d’audit.
        Filtrez par action pour retrouver un export ou une restauration.
      </p>
      <form onSubmit={submit} className="filters">
        <FormField
          label="Du (UTC)"
          type="text"
          name="from"
          maxLength={10}
          help={DATE_HELP}
          error={errors.fromError}
        />
        <FormField
          label="Au (UTC)"
          type="text"
          name="to"
          maxLength={10}
          help={DATE_HELP}
          error={errors.toError}
        />
        <FormField label="Acteur" type="text" name="actor" maxLength={256} />
        <div className="field">
          <label htmlFor="audit-action">Action</label>
          <select id="audit-action" name="action" defaultValue="">
            <option value="">Toutes</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Filtrer</Button>
      </form>
      <AuditView
        state={state}
        planNames={planNames}
        filterRefused={hasDateError(errors)}
        onPage={(offset) => setQuery({ ...query, offset })}
      />
    </main>
  );
}
