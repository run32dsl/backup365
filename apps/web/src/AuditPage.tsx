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

/** État de la consultation du journal. */
export type AuditState = AuditResponse | 'loading' | 'error';

const ACTION_LABELS: Record<AuditAction, string> = {
  'list.view': 'Consultation d’une liste',
  'item.open': 'Ouverture d’une fiche',
  'item.export': 'Export',
  'access.denied': 'Échec d’accès',
};

/** Tableau des entrées du journal, du plus récent au plus ancien. */
export function AuditView({ state }: { state: AuditState }) {
  if (state === 'loading') return <p role="status">Chargement du journal…</p>;
  if (state === 'error') return <p role="alert">Journal d’audit indisponible</p>;
  if (state.items.length === 0) return <p role="status">Aucune entrée.</p>;
  return (
    <>
      <p role="status">
        {state.total} entrée(s), {state.offset + 1} à {state.offset + state.items.length}
      </p>
      <table>
        <thead>
          <tr>
            <th>N°</th>
            <th>Date (UTC)</th>
            <th>Acteur</th>
            <th>Action</th>
            <th>Ressource</th>
            <th>Cible</th>
            <th>Éléments</th>
            <th>Motif</th>
            <th>Empreinte</th>
          </tr>
        </thead>
        <tbody>
          {state.items.map((e) => (
            <tr key={e.seq}>
              <td>{e.seq}</td>
              <td>{e.at}</td>
              <td>{e.actor}</td>
              <td>{ACTION_LABELS[e.action]}</td>
              <td>{e.resource}</td>
              <td>{e.target ?? ''}</td>
              <td>{e.count ?? ''}</td>
              <td>{e.reason ?? ''}</td>
              <td title={e.hash}>
                <code>{e.hash.slice(0, 12)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
    <main>
      <h1>Journal d’audit</h1>
      <form onSubmit={submit}>
        <label>
          Du <input type="datetime-local" name="from" />
        </label>{' '}
        <label>
          Au (exclu) <input type="datetime-local" name="to" />
        </label>{' '}
        <label>
          Acteur <input type="text" name="actor" maxLength={256} />
        </label>{' '}
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
        </label>{' '}
        <button type="submit">Filtrer</button>
      </form>
      <AuditView state={state} />
      <p>
        <button
          type="button"
          disabled={pages.previous === null}
          onClick={() => {
            if (pages.previous !== null) setQuery({ ...query, offset: pages.previous });
          }}
        >
          Précédent
        </button>{' '}
        <button
          type="button"
          disabled={pages.next === null}
          onClick={() => {
            if (pages.next !== null) setQuery({ ...query, offset: pages.next });
          }}
        >
          Suivant
        </button>
      </p>
    </main>
  );
}
