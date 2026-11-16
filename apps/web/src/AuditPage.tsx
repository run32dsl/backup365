import { useEffect, useState, type FormEvent } from 'react';
import { AUDIT_ACTIONS, type AuditAction } from '@backup365/core';
import {
  AUDIT_PAGE_SIZE,
  fetchAudit,
  pageOffsets,
  queryFromForm,
  type AuditQuery,
  type AuditResponse,
} from './audit.js';
import { Alert, Button, DataTable, EmptyState, FormField, type Column } from './ui/index.js';

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

type Entry = AuditResponse['items'][number];

const COLUMNS: Column<Entry>[] = [
  { header: 'N°', cell: (e) => e.seq },
  { header: 'Date (UTC)', cell: (e) => e.at },
  { header: 'Acteur', cell: (e) => e.actor },
  { header: 'Action', cell: (e) => ACTION_LABELS[e.action] },
  { header: 'Ressource', cell: (e) => e.resource },
  { header: 'Cible', cell: (e) => e.target ?? '' },
  { header: 'Éléments', cell: (e) => e.count ?? '' },
  { header: 'Motif', cell: (e) => e.reason ?? '' },
  {
    header: 'Empreinte',
    cell: (e) => (
      <span title={e.hash}>
        <code>{e.hash.slice(0, 12)}</code>
      </span>
    ),
  },
];

/** Tableau des entrées du journal, du plus récent au plus ancien. */
export function AuditView({ state }: { state: AuditState }) {
  if (state === 'loading') return <p role="status">Chargement du journal…</p>;
  if (state === 'error') return <Alert tone="error">Journal d’audit indisponible</Alert>;
  if (state.items.length === 0) return <EmptyState>Aucune entrée.</EmptyState>;
  return (
    <>
      <p role="status">
        {state.total} entrée(s), {state.offset + 1} à {state.offset + state.items.length}
      </p>
      <DataTable
        caption="Entrées du journal d’audit"
        hideCaption
        columns={COLUMNS}
        rows={state.items}
        rowKey={(e) => e.seq}
      />
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

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setQuery(queryFromForm(new FormData(e.currentTarget)));
  }

  const pages = pageOffsets(
    query.offset ?? 0,
    query.limit ?? AUDIT_PAGE_SIZE,
    typeof state === 'object' ? state.total : 0,
  );
  return (
    <main tabIndex={-1}>
      <h1>Journal d’audit</h1>
      <p>La consultation de ce journal est elle-même journalisée.</p>
      <form onSubmit={submit} className="form-row">
        <FormField label="Du" type="datetime-local" name="from" />
        <FormField label="Au (exclu)" type="datetime-local" name="to" />
        <FormField label="Acteur" type="text" name="actor" maxLength={256} />
        <label>
          Action{' '}
          <select name="action" defaultValue="">
            <option value="">Toutes</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Filtrer</Button>
      </form>
      <AuditView state={state} />
      <div className="button-row">
        <Button
          variant="secondary"
          disabled={pages.previous === null}
          onClick={() => {
            if (pages.previous !== null) setQuery({ ...query, offset: pages.previous });
          }}
        >
          Précédent
        </Button>
        <Button
          variant="secondary"
          disabled={pages.next === null}
          onClick={() => {
            if (pages.next !== null) setQuery({ ...query, offset: pages.next });
          }}
        >
          Suivant
        </Button>
      </div>
    </main>
  );
}
