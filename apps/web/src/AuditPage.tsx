import { useEffect, useState, type FormEvent } from 'react';
import { AUDIT_ACTIONS, type AuditAction } from '@backup365/core';
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
  NO_TARGET,
  actorLabel,
  auditDate,
  detailLabel,
  reasonLabel,
  targetView,
} from './auditLabels.js';
import { fetchPlans } from './plans.js';
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

const ACTION_LABELS: Record<AuditAction, string> = {
  'list.view': 'Consultation d’une liste',
  'item.open': 'Ouverture d’une fiche',
  'item.export': 'Export',
  'access.denied': 'Échec d’accès',
  'auth.login': 'Connexion',
  'auth.login_failed': 'Échec de connexion',
  'auth.logout': 'Déconnexion',
  'account.create': 'Création de compte',
  'account.update': 'Modification de compte',
  'plan.create': 'Création de plan',
  'plan.update': 'Modification de plan',
  'plan.delete': 'Suppression de plan',
  'plan.run': 'Lancement manuel d’un plan',
  'restore.request': 'Demande de restauration',
  'restore.result': 'Résultat de restauration',
};

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
      className: 'nowrap',
      cell: (e) => <span title={e.at}>{auditDate(e.at) || '—'}</span>,
    },
    { header: 'Acteur', className: 'keep-words', cell: (e) => actorLabel(e.actor) },
    {
      header: 'Action',
      className: 'keep-words',
      cell: (e) => {
        const detail = detailLabel(e.reason);
        return (
          <span>
            <span className="nowrap-wide">{ACTION_LABELS[e.action]}</span>
            {detail && <span className="cell-secondary">{detail}</span>}
          </span>
        );
      },
    },
    {
      header: 'Cible',
      className: 'keep-words address',
      cell: (e) => {
        const { name, secondary } = targetView(e, planNames);
        // Sans cible : cellule vide, comme Éléments et Motif (la carte l'omet).
        if (name === NO_TARGET) return null;
        return (
          <span>
            <Address value={name} />
            {secondary && (
              <span className="cell-secondary">
                <Address value={secondary} />
              </span>
            )}
          </span>
        );
      },
    },
    { header: 'Éléments', className: 'card-hidden num', cell: (e) => e.count ?? '' },
    {
      header: 'Motif',
      className: 'card-wide keep-words col-reason',
      cell: (e) => reasonLabel(e.reason),
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
      <h1>Journal d’audit</h1>
      <p>
        La consultation de ce journal est elle-même inscrite au journal d’audit. Filtrez par action
        pour retrouver un export ou une restauration.
      </p>
      <form onSubmit={submit} className="filters">
        <FormField
          label="Du"
          type="text"
          name="from"
          maxLength={10}
          help={DATE_HELP}
          error={errors.fromError}
        />
        <FormField
          label="Au"
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
